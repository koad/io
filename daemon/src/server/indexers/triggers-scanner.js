// triggers-scanner.js — reactive layer for emissions
//
// Scans every entity's `~/.<entity>/triggers/` dir for bash scripts that
// declare a JSON selector + lifecycle event in their header. When an
// emission matches, the daemon execs the script with the emission data
// on stdin and key fields as env vars. Fire-and-forget; timeout-bounded;
// never blocks emission flow.
//
// Trigger script convention:
//
//   #!/bin/bash
//   # trigger: { "type": "error" }
//   # event: any            (open | update | close | emit | any — default any)
//   # debounce: 5           (seconds — coalesce repeats — default 0)
//
//   echo "$EMISSION_ENTITY: $EMISSION_BODY" >> /tmp/error-log
//   # full doc available on stdin as JSON
//
// Selector matches against top-level emission fields. Use dot notation
// for nested (e.g. "meta.parentId"). Special key "bodyMatch" treats its
// value as a regex tested against `body`.
//
// Env vars set per fire:
//   EMISSION_ID, EMISSION_ENTITY, EMISSION_TYPE, EMISSION_BODY,
//   EMISSION_STATUS, EMISSION_EVENT, EMISSION_PARENT_ID, EMISSION_ROOT_ID
//
// Triggers are loaded on daemon startup and re-loaded when their dir
// changes (file watcher). New entities picked up via EntityScanner observer.

const fs = Npm.require('fs');
const path = Npm.require('path');
const os = Npm.require('os');
const child_process = Npm.require('child_process');

const TRIGGER_TIMEOUT_MS = 30 * 1000;

// In-memory trigger registry
const triggers = [];
const watchers = new Map();

function parseTriggerHeader(content) {
  const lines = content.split('\n').slice(0, 30);
  let selector = null;
  let event = 'any';
  let debounce = 0;
  for (const line of lines) {
    // Case-insensitive per VESTA-SPEC-136 §4.3 — headers canonized as # TRIGGER/EVENT/DEBOUNCE
    const m = line.match(/^#\s*trigger:\s*(.+)$/i);
    if (m) {
      try { selector = JSON.parse(m[1]); } catch (e) {}
    }
    const e = line.match(/^#\s*event:\s*(.+)$/i);
    if (e) event = e[1].trim();
    const d = line.match(/^#\s*debounce:\s*(\d+)/i);
    if (d) debounce = parseInt(d[1], 10);
  }
  return selector ? { selector, event, debounce } : null;
}

function loadTriggersFor(entityHandle, entityPath) {
  const triggerDir = path.join(entityPath, 'triggers');
  let files;
  try {
    files = fs.readdirSync(triggerDir).filter(f => f.endsWith('.sh') && !f.startsWith('.'));
  } catch (e) {
    // No triggers dir — just clear any existing for this entity
    for (let i = triggers.length - 1; i >= 0; i--) {
      if (triggers[i].entity === entityHandle) triggers.splice(i, 1);
    }
    return;
  }

  // Remove existing entries for this entity, re-add fresh
  for (let i = triggers.length - 1; i >= 0; i--) {
    if (triggers[i].entity === entityHandle) triggers.splice(i, 1);
  }

  let loaded = 0;
  for (const file of files) {
    const filePath = path.join(triggerDir, file);
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const parsed = parseTriggerHeader(content);
      if (parsed) {
        triggers.push({
          entity: entityHandle,
          file: filePath,
          name: file,
          selector: parsed.selector,
          event: parsed.event,
          debounce: parsed.debounce,
          lastFiredAt: 0,
        });
        loaded++;
      }
    } catch (e) {
      console.error(`[TRIGGERS] failed to read ${filePath}:`, e.message);
    }
  }
  if (loaded > 0) {
    console.log(`[TRIGGERS] loaded ${loaded} for ${entityHandle}`);
  }
}

function watchTriggersFor(entityHandle, entityPath) {
  if (watchers.has(entityHandle)) return;
  const triggerDir = path.join(entityPath, 'triggers');
  try {
    fs.accessSync(triggerDir);
  } catch (e) { return; }
  try {
    const watcher = fs.watch(triggerDir, { persistent: false }, () => {
      Meteor.setTimeout(() => loadTriggersFor(entityHandle, entityPath), 500);
    });
    watchers.set(entityHandle, watcher);
  } catch (e) {}
}

function getNested(obj, dottedKey) {
  const parts = dottedKey.split('.');
  let v = obj;
  for (const p of parts) {
    if (v == null) return undefined;
    v = v[p];
  }
  return v;
}

function matchesSelector(doc, selector) {
  for (const [key, value] of Object.entries(selector)) {
    if (key === 'bodyMatch') {
      try {
        if (!new RegExp(value).test(doc.body || '')) return false;
      } catch (e) { return false; }
      continue;
    }
    const actual = key.includes('.') ? getNested(doc, key) : doc[key];
    // Array value = "any of these" (OR semantics)
    if (Array.isArray(value)) {
      if (!value.includes(actual)) return false;
    } else if (actual !== value) {
      return false;
    }
  }
  return true;
}

function fireTrigger(trigger, doc, event) {
  const now = Date.now();
  if (trigger.debounce && (now - trigger.lastFiredAt < trigger.debounce * 1000)) return;
  trigger.lastFiredAt = now;

  // Owner context — the entity that authored/owns this trigger. Scripts
  // use ENTITY_DIR for entity-scoped paths; HOME stays as koad's so framework
  // helpers at $HOME/.koad-io/... remain resolvable.
  const ownerDir = path.join(process.env.HOME || '/home/koad', '.' + trigger.entity);

  const env = Object.assign({}, process.env, {
    ENTITY: trigger.entity,
    ENTITY_DIR: ownerDir,
    // Emission context — the event that fired the trigger
    EMISSION_ID: doc._id || '',
    EMISSION_ENTITY: doc.entity || '',
    EMISSION_TYPE: doc.type || '',
    EMISSION_BODY: doc.body || '',
    EMISSION_STATUS: doc.status || '',
    EMISSION_EVENT: event,
    EMISSION_PARENT_ID: (doc.meta && doc.meta.parentId) || '',
    EMISSION_ROOT_ID: (doc.meta && doc.meta.rootId) || '',
  });

  console.log(`[TRIGGERS] fire: ${trigger.entity}/${trigger.name} for ${doc.entity}/${doc.type}/${event}`);

  try {
    const child = child_process.spawn('bash', [trigger.file], {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: TRIGGER_TIMEOUT_MS,
      detached: false,
    });
    child.stdin.write(JSON.stringify(doc));
    child.stdin.end();
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d.toString().slice(0, 500); });
    child.on('error', (err) => {
      console.error(`[TRIGGERS] error firing ${trigger.file}:`, err.message);
    });
    child.on('exit', (code) => {
      if (code !== 0) {
        console.error(`[TRIGGERS] ${trigger.file} exited ${code}: ${stderr.trim()}`);
      }
    });
  } catch (e) {
    console.error(`[TRIGGERS] spawn failed for ${trigger.file}:`, e.message);
  }
}

function evaluateTriggers(doc, event) {
  for (const trigger of triggers) {
    if (trigger.event !== 'any' && trigger.event !== event) continue;
    if (!matchesSelector(doc, trigger.selector)) continue;
    fireTrigger(trigger, doc, event);
  }
}
globalThis.evaluateEmissionTriggers = evaluateTriggers;

// Inspection helpers — what's loaded right now?
globalThis.listEmissionTriggers = function () {
  return triggers.map(t => ({
    entity: t.entity,
    name: t.name,
    file: t.file,
    selector: t.selector,
    event: t.event,
    debounce: t.debounce,
  }));
};

Meteor.startup(() => {
  // Wait for EntityScanner to populate
  Meteor.setTimeout(() => {
    const entities = EntityScanner.Entities.find().fetch();
    for (const entity of entities) {
      loadTriggersFor(entity.handle, entity.path);
      watchTriggersFor(entity.handle, entity.path);
    }
    console.log(`[TRIGGERS] active — ${triggers.length} triggers across ${entities.length} entities`);

    EntityScanner.Entities.find().observeChanges({
      added(id, fields) {
        if (fields.path && fields.handle) {
          loadTriggersFor(fields.handle, fields.path);
          watchTriggersFor(fields.handle, fields.path);
        }
      },
    });

    if (!globalThis.indexerReady) globalThis.indexerReady = {};
    globalThis.indexerReady.triggers = new Date().toISOString();
  }, 3000);
});
