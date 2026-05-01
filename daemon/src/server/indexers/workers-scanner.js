// workers-scanner.js — entity shell-worker scheduler
//
// Scans every entity's `~/.<entity>/workers/*/worker.sh` at daemon startup
// and on filewatch reload. Reads schedule from the file header or a sibling
// manifest.json, then registers each worker via koad.workers.start so it
// fires on its declared interval.
//
// Worker script convention (header comments, case-insensitive):
//
//   #!/usr/bin/env bash
//   # INTERVAL: 1440     (minutes between runs — required)
//   # DELAY: 0           (minutes offset after interval boundary — default 0)
//   # RUN_IMMEDIATELY: false  (run on first load — default false)
//
// Alternatively, a sibling manifest.json with the same keys (camelCase):
//   { "interval": 1440, "delay": 0, "runImmediately": false }
//
// Header comments take precedence over manifest.json when both are present.
//
// Env vars set per execution:
//   ENTITY, ENTITY_DIR, KOAD_IO_EMIT=1, HOME
//
// Lifecycle: worker execution emits via the entity's shell helpers
// (koad_io_emit_open/update/close), not via the daemon JS layer directly —
// the shell script is responsible for its own lifecycle emissions.
//
// Daemon logs show:
//   [ENTITY-WORKERS] loaded N workers for <entity>
//   [ENTITY-WORKERS] total: N workers across M entities
//
// New entities picked up via EntityScanner observer (no daemon restart).
// Changed worker.sh files picked up via filewatch on the workers/ dir.

const fs = Npm.require('fs');
const path = Npm.require('path');
const child_process = Npm.require('child_process');

const WORKER_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes per worker run
const HOME = process.env.HOME || '/home/koad';

// In-memory registry: service → { entity, workerPath, interval, delay, runImmediately, control }
const registry = new Map();
// File watchers per entity
const watchers = new Map();

// ---------------------------------------------------------------------------
// Header + manifest parsing
// ---------------------------------------------------------------------------

function parseWorkerHeader(content) {
  const lines = content.split('\n').slice(0, 30);
  let interval = null;
  let delay = 0;
  let runImmediately = false;

  for (const line of lines) {
    const iMatch = line.match(/^#\s*INTERVAL:\s*(\d+)/i);
    if (iMatch) interval = parseInt(iMatch[1], 10);

    const dMatch = line.match(/^#\s*DELAY:\s*(\d+)/i);
    if (dMatch) delay = parseInt(dMatch[1], 10);

    const rMatch = line.match(/^#\s*RUN_IMMEDIATELY:\s*(true|false|1|0)/i);
    if (rMatch) runImmediately = /true|1/i.test(rMatch[1]);
  }

  return interval ? { interval, delay, runImmediately } : null;
}

function parseManifest(manifestPath) {
  try {
    const raw = fs.readFileSync(manifestPath, 'utf8');
    const m = JSON.parse(raw);
    if (typeof m.interval !== 'number' || m.interval <= 0) return null;
    return {
      interval: m.interval,
      delay: typeof m.delay === 'number' ? m.delay : 0,
      runImmediately: !!m.runImmediately,
    };
  } catch (e) {
    return null;
  }
}

function parseWorkerConfig(workerPath) {
  let fromHeader = null;
  try {
    const content = fs.readFileSync(workerPath, 'utf8');
    fromHeader = parseWorkerHeader(content);
  } catch (e) {
    return null;
  }

  // Header wins; fall back to manifest
  if (fromHeader) return fromHeader;

  const manifestPath = path.join(path.dirname(workerPath), 'manifest.json');
  return parseManifest(manifestPath);
}

// ---------------------------------------------------------------------------
// Worker execution
// ---------------------------------------------------------------------------

function makeTask(entityHandle, entityPath, workerPath, workerName) {
  return function runWorker() {
    return new Promise((resolve, reject) => {
      const env = Object.assign({}, process.env, {
        ENTITY: entityHandle,
        ENTITY_DIR: entityPath,
        KOAD_IO_EMIT: '1',
        HOME: HOME,
      });

      console.log(`[ENTITY-WORKERS] exec: ${entityHandle}/${workerName}`);

      const child = child_process.spawn('bash', [workerPath], {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: WORKER_TIMEOUT_MS,
        detached: false,
      });

      let stderr = '';
      child.stderr.on('data', (d) => { stderr += d.toString().slice(0, 1000); });

      child.on('error', (err) => {
        console.error(`[ENTITY-WORKERS] spawn error ${entityHandle}/${workerName}:`, err.message);
        reject(err);
      });

      child.on('exit', (code) => {
        if (code !== 0) {
          console.error(`[ENTITY-WORKERS] ${entityHandle}/${workerName} exited ${code}: ${stderr.trim()}`);
          reject(new Error(`worker exited ${code}`));
        } else {
          resolve();
        }
      });
    });
  };
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

async function registerWorker(entityHandle, entityPath, workerName, workerPath) {
  const config = parseWorkerConfig(workerPath);
  if (!config) {
    console.error(`[ENTITY-WORKERS] no valid INTERVAL for ${entityHandle}/${workerName} — skipping`);
    return false;
  }

  const service = `${entityHandle}-${workerName}`;

  // Stop previous registration for this service if reloading
  if (registry.has(service)) {
    const prev = registry.get(service);
    if (prev.control && typeof prev.control.stop === 'function') {
      try { await prev.control.stop(); } catch (e) {}
    }
    registry.delete(service);
  }

  const task = makeTask(entityHandle, entityPath, workerPath, workerName);

  try {
    const control = await koad.workers.start({
      service,
      type: 'worker',
      interval: config.interval,
      delay: config.delay,
      runImmediately: config.runImmediately,
      task,
    });

    if (!control) {
      console.error(`[ENTITY-WORKERS] koad.workers.start returned false for ${service}`);
      return false;
    }

    registry.set(service, { entityHandle, entityPath, workerName, workerPath, control });
    return true;
  } catch (e) {
    console.error(`[ENTITY-WORKERS] failed to start ${service}:`, e.message);
    return false;
  }
}

async function loadWorkersFor(entityHandle, entityPath) {
  const workersRoot = path.join(entityPath, 'workers');
  let workerDirs;
  try {
    workerDirs = fs.readdirSync(workersRoot, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
  } catch (e) {
    // No workers/ dir — remove any existing registrations for this entity
    for (const [service, entry] of registry.entries()) {
      if (entry.entityHandle === entityHandle) {
        if (entry.control && typeof entry.control.stop === 'function') {
          try { await entry.control.stop(); } catch (_) {}
        }
        registry.delete(service);
      }
    }
    return 0;
  }

  let loaded = 0;
  for (const workerName of workerDirs) {
    const workerPath = path.join(workersRoot, workerName, 'worker.sh');
    try {
      fs.accessSync(workerPath, fs.constants.R_OK | fs.constants.X_OK);
    } catch (e) {
      // worker.sh missing or not executable — skip
      continue;
    }
    const ok = await registerWorker(entityHandle, entityPath, workerName, workerPath);
    if (ok) loaded++;
  }

  if (loaded > 0) {
    console.log(`[ENTITY-WORKERS] loaded ${loaded} workers for ${entityHandle}`);
  }
  return loaded;
}

function watchWorkersFor(entityHandle, entityPath) {
  if (watchers.has(entityHandle)) return;
  const workersRoot = path.join(entityPath, 'workers');
  try { fs.accessSync(workersRoot); } catch (e) { return; }

  try {
    const watcher = fs.watch(workersRoot, { persistent: false, recursive: true }, () => {
      Meteor.setTimeout(() => {
        loadWorkersFor(entityHandle, entityPath);
      }, 500);
    });
    watchers.set(entityHandle, watcher);
  } catch (e) {
    console.error(`[ENTITY-WORKERS] watch failed for ${entityHandle}:`, e.message);
  }
}

// ---------------------------------------------------------------------------
// Inspection
// ---------------------------------------------------------------------------

globalThis.listEntityWorkers = function () {
  return Array.from(registry.entries()).map(([service, entry]) => ({
    service,
    entity: entry.entityHandle,
    worker: entry.workerName,
    file: entry.workerPath,
  }));
};

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

Meteor.startup(() => {
  // Wait for EntityScanner and koad.workers to be ready
  Meteor.setTimeout(async () => {
    const entities = EntityScanner.Entities.find().fetch();
    let totalLoaded = 0;

    for (const entity of entities) {
      const count = await loadWorkersFor(entity.handle, entity.path);
      totalLoaded += count;
      watchWorkersFor(entity.handle, entity.path);
    }

    console.log(`[ENTITY-WORKERS] active — ${totalLoaded} workers across ${entities.length} entities`);

    if (!globalThis.indexerReady) globalThis.indexerReady = {};
    globalThis.indexerReady.entityWorkers = new Date().toISOString();

    // Pick up new entities as they're discovered
    EntityScanner.Entities.find().observeChanges({
      added(id, fields) {
        if (fields.handle && fields.path) {
          Meteor.defer(async () => {
            await loadWorkersFor(fields.handle, fields.path);
            watchWorkersFor(fields.handle, fields.path);
          });
        }
      },
    });
  }, 4000); // after triggers-scanner (3s) to avoid startup race
});
