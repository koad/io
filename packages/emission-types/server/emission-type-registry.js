// emission-type-registry.js — per-entity emission type declaration and validation
//
// Each entity can declare emission types in ~/.<entity>/emissions/types.yaml:
//
//   emits:
//     - name: learner-returned
//       description: "Fires when a known learner re-engages after a gap"
//       meta_schema:
//         handle: string
//         level: integer
//         last_seen: ISO-date
//       example:
//         entity: alice
//         type: learner-returned
//         body: "learner @koad-belt-042 returned"
//         meta: { handle: koad-belt-042, level: 4, last_seen: "2026-04-23" }
//   listens:
//     - curriculum.level.complete
//     - error
//
// Registry indexed by "<entity>:<type-name>".
// Validation is warn-only in v1 — unregistered types log a warning but are not rejected.
//
// REST endpoints:
//   GET  /api/emissions/types          — full registry (supports ?entity=X filter)
//   POST /api/emissions/types/reload   — re-scan all entity dirs, hot reload

const fs   = Npm.require('fs');
const path = Npm.require('path');
const os   = Npm.require('os');
const { WebApp } = require('meteor/webapp');

const HOME = os.homedir();
const app  = WebApp.connectHandlers;

// ---------------------------------------------------------------------------
// YAML parser — handles types.yaml structure only.
// Supports:
//   - top-level "emits:" and "listens:" keys
//   - list items under emits: starting with "  - name: ..."
//   - sub-keys under emits items (description, meta_schema, example)
//   - list items under listens: (plain string values)
// Not a general YAML parser.
// ---------------------------------------------------------------------------

function parseTypesYaml(text, filePath) {
  const lines = text.split('\n');
  const result = { emits: [], listens: [] };

  let section = null;       // 'emits' | 'listens' | null
  let currentEmit = null;   // currently building emit object
  let subSection = null;    // 'meta_schema' | 'example' | null

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trimEnd();

    // Skip blank lines and comments
    if (!line.trim() || line.trim().startsWith('#')) continue;

    // Top-level keys
    if (/^emits\s*:/.test(line)) {
      if (currentEmit) { result.emits.push(currentEmit); currentEmit = null; }
      section = 'emits';
      subSection = null;
      continue;
    }

    if (/^listens\s*:/.test(line)) {
      if (currentEmit) { result.emits.push(currentEmit); currentEmit = null; }
      section = 'listens';
      subSection = null;
      continue;
    }

    if (!section) continue;

    if (section === 'listens') {
      // List items: "  - type.name" or "  - error"
      const m = line.match(/^\s+-\s+(.+)/);
      if (m) result.listens.push(m[1].replace(/['"]/g, '').trim());
      continue;
    }

    if (section === 'emits') {
      // New emit item starting with "  - name:"
      const newItem = line.match(/^\s+-\s+name\s*:\s*(.*)/);
      if (newItem) {
        if (currentEmit) result.emits.push(currentEmit);
        currentEmit = {
          name: newItem[1].replace(/['"]/g, '').trim(),
          _yamlFile: filePath,
        };
        subSection = null;
        continue;
      }

      if (!currentEmit) continue;

      // Sub-section headers (meta_schema:, example:)
      const subHeader = line.match(/^(\s+)(meta_schema|example)\s*:\s*$/);
      if (subHeader) {
        subSection = subHeader[2];
        if (!currentEmit[subSection]) currentEmit[subSection] = {};
        continue;
      }

      // Inline sub-section key: meta_schema: { ... } or example: { ... }
      const inlineSubHeader = line.match(/^(\s+)(meta_schema|example)\s*:\s*\{(.+)\}/);
      if (inlineSubHeader) {
        subSection = null; // inline, don't continue into sub-section mode
        try {
          // Best-effort: treat as loose JSON-ish
          const jsonStr = '{' + inlineSubHeader[3] + '}';
          currentEmit[inlineSubHeader[2]] = JSON.parse(jsonStr);
        } catch (_) {
          currentEmit[inlineSubHeader[2]] = inlineSubHeader[3];
        }
        continue;
      }

      // Inside a sub-section (meta_schema or example): key: value pairs
      if (subSection) {
        const kvMatch = line.match(/^(\s+)([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)/);
        if (kvMatch) {
          // Only treat as sub-section key if indented enough (> 4 spaces for sub-item)
          if (kvMatch[1].length >= 6) {
            currentEmit[subSection][kvMatch[2].trim()] = kvMatch[3].replace(/['"]/g, '').trim();
            continue;
          }
          // Otherwise fall through to top-level emit key handling
          subSection = null;
        }
      }

      // Top-level emit keys (description: ...)
      const kvMatch = line.match(/^\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)/);
      if (kvMatch) {
        const key = kvMatch[1].trim();
        const val = kvMatch[2].replace(/['"]/g, '').trim();
        // Don't overwrite nested objects already set
        if (!currentEmit[key] || typeof currentEmit[key] === 'string') {
          currentEmit[key] = val;
        }
      }
    }
  }

  if (currentEmit) result.emits.push(currentEmit);
  return result;
}

// ---------------------------------------------------------------------------
// Scan all entity dirs for emissions/types.yaml
// Scans: $HOME/.*/ and $HOME/.forge/*/
// ---------------------------------------------------------------------------

function findTypesYamlFiles() {
  const files = [];

  function tryDir(dir, entityHint) {
    const candidate = path.join(dir, 'emissions', 'types.yaml');
    try {
      fs.accessSync(candidate, fs.constants.R_OK);
      files.push({ file: candidate, entityHint });
    } catch (_) { /* not present */ }
  }

  // $HOME/.*/ directories — entity name is the dot-dir name without the dot
  try {
    const homeEntries = fs.readdirSync(HOME, { withFileTypes: true });
    for (const entry of homeEntries) {
      if (entry.isDirectory() && entry.name.startsWith('.') && entry.name.length > 1) {
        const entityName = entry.name.slice(1); // strip leading dot
        tryDir(path.join(HOME, entry.name), entityName);
      }
    }
  } catch (_) { /* HOME unreadable */ }

  return files;
}

// ---------------------------------------------------------------------------
// Build the in-memory registry from all discovered types.yaml files.
// Returns:
//   registry — Map from "<entity>:<type-name>" → { entity, type, ...metadata }
//   byEntity — Map from entity → { emits: [...], listens: [...] }
// ---------------------------------------------------------------------------

function buildRegistry() {
  const registry = new Map();
  const byEntity = {};

  const yamlFiles = findTypesYamlFiles();
  console.log(`[emission-type-registry] scanning: found ${yamlFiles.length} emissions/types.yaml file(s)`);

  for (const { file, entityHint } of yamlFiles) {
    try {
      const text = fs.readFileSync(file, 'utf8');
      const parsed = parseTypesYaml(text, file);

      const entity = entityHint;
      byEntity[entity] = { emits: [], listens: parsed.listens || [] };

      for (const emit of (parsed.emits || [])) {
        if (!emit.name) continue;
        const key = `${entity}:${emit.name}`;
        const record = {
          entity,
          type:        emit.name,
          description: emit.description || null,
          meta_schema: emit.meta_schema  || null,
          example:     emit.example      || null,
          _yamlFile:   file,
        };
        registry.set(key, record);
        byEntity[entity].emits.push(record);
      }

      console.log(
        `[emission-type-registry] ${entity}: ${(parsed.emits || []).length} emits, ` +
        `${(parsed.listens || []).length} listens registered`
      );
    } catch (err) {
      console.warn(`[emission-type-registry] failed to parse ${file}:`, err.message);
    }
  }

  console.log(`[emission-type-registry] total registered types: ${registry.size} across ${Object.keys(byEntity).length} entities`);
  return { registry, byEntity };
}

// ---------------------------------------------------------------------------
// Module-level state (hot-reloads via reload())
// ---------------------------------------------------------------------------

let _state = { registry: new Map(), byEntity: {} };

function load() {
  _state = buildRegistry();
  return _state;
}

// ---------------------------------------------------------------------------
// Validation — warn-only in v1. Called from emissions.js entity.emit path.
// Returns { registered: bool } so callers can log or act further.
// ---------------------------------------------------------------------------

function checkType(entity, type) {
  const key = `${entity}:${type}`;
  const registered = _state.registry.has(key);
  if (!registered) {
    console.warn(
      `[emission-type-registry] WARNING: unregistered type "${type}" from entity "${entity}" ` +
      `(key: ${key}). ` +
      `To register this type, add it to ~/.${entity}/emissions/types.yaml under "emits:". ` +
      `This is warn-only in v1 — the emission is still accepted.`
    );
  }
  return { registered };
}

// Expose globally for other modules
globalThis.EmissionTypeRegistry = { load, checkType, getState: () => _state };

// ---------------------------------------------------------------------------
// REST helpers (local — not shared with api.js to keep modules independent)
// ---------------------------------------------------------------------------

function jsonOk(res, payload) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.writeHead(200);
  res.end(JSON.stringify(payload));
}

function jsonErr(res, code, message) {
  res.setHeader('Content-Type', 'application/json');
  res.writeHead(code);
  res.end(JSON.stringify({ status: 'error', message }));
}

function parseQuery(url) {
  const q = {};
  const i = url.indexOf('?');
  if (i === -1) return q;
  const raw = url.slice(i + 1);
  for (const pair of raw.split('&')) {
    const [k, v] = pair.split('=');
    if (k) q[decodeURIComponent(k)] = v ? decodeURIComponent(v) : '';
  }
  return q;
}

function pathIs(req, target) {
  const url = req.originalUrl || req.url || '';
  const i = url.indexOf('?');
  const p = i === -1 ? url : url.slice(0, i);
  return p === target || p === target + '/';
}

// ---------------------------------------------------------------------------
// POST /api/emissions/types/reload — re-scan all entity dirs, hot reload
// Must be registered BEFORE /api/emissions/types (connect prefix-matches).
// ---------------------------------------------------------------------------

app.use('/api/emissions/types/reload', (req, res, next) => {
  if (req.method !== 'POST') return next();

  try {
    const newState = globalThis.EmissionTypeRegistry.load();
    const typeNames = [];
    newState.registry.forEach((v) => typeNames.push(`${v.entity}:${v.type}`));

    res.setHeader('Content-Type', 'application/json');
    res.writeHead(200);
    res.end(JSON.stringify({
      status: 'ok',
      registered: newState.registry.size,
      types: typeNames,
    }));
  } catch (err) {
    console.error('[emission-type-registry] reload error:', err.message);
    jsonErr(res, 500, err.message);
  }
});

// ---------------------------------------------------------------------------
// GET /api/emissions/types        — full registry
// GET /api/emissions/types?entity=X — filter to one entity
// ---------------------------------------------------------------------------

app.use('/api/emissions/types', (req, res, next) => {
  if (req.method !== 'GET' || !pathIs(req, '/api/emissions/types')) return next();

  try {
    const q = parseQuery(req.originalUrl || req.url);
    const state = globalThis.EmissionTypeRegistry.getState();
    const results = [];

    state.registry.forEach((record) => {
      if (!q.entity || record.entity === q.entity) {
        results.push(record);
      }
    });

    // Sort: entity asc, type asc
    results.sort((a, b) => {
      if (a.entity < b.entity) return -1;
      if (a.entity > b.entity) return 1;
      if (a.type < b.type) return -1;
      if (a.type > b.type) return 1;
      return 0;
    });

    jsonOk(res, {
      status: 'ok',
      count: results.length,
      types: results,
    });
  } catch (err) {
    console.error('[emission-type-registry] GET /api/emissions/types error:', err.message);
    jsonErr(res, 500, err.message);
  }
});

// ---------------------------------------------------------------------------
// Startup — load on first boot
// ---------------------------------------------------------------------------

Meteor.startup(() => {
  Meteor.setTimeout(() => {
    globalThis.EmissionTypeRegistry.load();
  }, 600); // slightly after pluggable-indexers (500ms) to avoid log interleave
});
