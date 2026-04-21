// jsonl-projector.js — project JSONL files into Mongo collections + DDP publications
//
// For each indexer config:
//   - Create the target Mongo.Collection (in-memory, connection: null)
//   - Read file on startup, project entries per mode
//   - fs.watch() the file; on change, re-read and update
//   - Register a DDP publication: indexed.<collectionName>
//
// Modes:
//   current-per-key — last entry per key is the canonical doc (e.g. announcement surface)
//   append-only     — every entry is a doc; uses entry._id or generates one
//
// Publications: indexed.<collectionName> — public by default (anonymous forge visitors)

const fs   = Npm.require('fs');
const path = Npm.require('path');
const crypto = Npm.require('crypto');

// Track running projectors so reload can stop removed ones
const _running = {}; // name → { config, watcher, collection }

// ---------------------------------------------------------------------------
// Read all JSONL entries from a file. Returns [] if missing or unreadable.
// ---------------------------------------------------------------------------

function readJsonl(filePath) {
  try {
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, 'utf8');
    return raw
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        try { return JSON.parse(line); } catch (_) { return null; }
      })
      .filter(Boolean);
  } catch (err) {
    console.warn(`[jsonl-projector] readJsonl error (${filePath}):`, err.message);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Project entries into a collection according to mode.
// ---------------------------------------------------------------------------

function project(collection, entries, config) {
  const mode = config.mode || 'append-only';
  const key  = config.key  || '_id';

  if (mode === 'current-per-key') {
    // Build a map: keyValue → last entry with that key
    const latest = {};
    for (const entry of entries) {
      const kv = entry[key];
      if (kv !== undefined && kv !== null) {
        latest[kv] = entry;
      }
    }
    // Upsert each latest entry, remove stale docs no longer in latest map
    const latestIds = new Set(Object.keys(latest));

    for (const [kv, entry] of Object.entries(latest)) {
      const docId = String(kv);
      const doc = Object.assign({}, entry, { _id: docId });
      const existing = collection.findOne(docId);
      if (existing) {
        collection.update(docId, { $set: doc });
      } else {
        collection.insert(doc);
      }
    }

    // Remove stale docs
    collection.find().forEach(doc => {
      if (!latestIds.has(doc._id)) {
        collection.remove(doc._id);
      }
    });

  } else {
    // append-only — every entry is a distinct doc
    // On re-read, we upsert by _id (if present) or by a hash of the line content
    const existing = new Set(collection.find({}, { fields: { _id: 1 } }).fetch().map(d => d._id));
    const seen = new Set();

    for (const entry of entries) {
      const docId = entry._id
        ? String(entry._id)
        : crypto.createHash('md5').update(JSON.stringify(entry)).digest('hex').slice(0, 16);
      const doc = Object.assign({}, entry, { _id: docId });
      seen.add(docId);

      if (existing.has(docId)) {
        collection.update(docId, { $set: doc });
      } else {
        collection.insert(doc);
      }
    }

    // In append-only mode we do NOT remove docs no longer in file — they are archive.
    // (If you need purge semantics, use current-per-key mode.)
  }
}

// ---------------------------------------------------------------------------
// Start a single projector.
// ---------------------------------------------------------------------------

function start(config) {
  const { name, collection: collectionName, sourcePath, mode } = config;

  if (!collectionName) {
    console.warn(`[jsonl-projector] ${name}: no collection name — skipping`);
    return;
  }

  if (!sourcePath) {
    console.warn(`[jsonl-projector] ${name}: no source path resolved — skipping`);
    return;
  }

  // Ensure parent directory exists so fs.watch can be set up even if file absent yet
  const sourceDir = path.dirname(sourcePath);

  // Create or reuse collection
  let collection;
  if (globalThis[collectionName] instanceof Mongo.Collection) {
    collection = globalThis[collectionName];
    console.log(`[jsonl-projector] ${name}: reusing existing collection ${collectionName}`);
  } else {
    collection = new Mongo.Collection(collectionName, { connection: null });
    globalThis[collectionName] = collection;
    console.log(`[jsonl-projector] ${name}: created collection ${collectionName}`);
  }

  // Register DDP publication (idempotent — Meteor throws if name already registered)
  const pubName = `indexed.${collectionName}`;
  try {
    Meteor.publish(pubName, function () {
      return collection.find();
    });
    console.log(`[jsonl-projector] ${name}: registered publication ${pubName}`);
  } catch (err) {
    // Already registered on hot reload — fine
    if (!err.message || !err.message.includes('already registered')) {
      console.warn(`[jsonl-projector] ${name}: publish registration note:`, err.message);
    }
  }

  // Initial projection
  function refresh(reason) {
    console.log(`[jsonl-projector] ${name}: refreshing (${reason})`);
    const entries = readJsonl(sourcePath);
    project(collection, entries, config);
    console.log(`[jsonl-projector] ${name}: projected ${entries.length} entries → ${collection.find().count()} docs in ${collectionName}`);
  }

  refresh('startup');

  // File watcher — watch the directory in case file doesn't exist yet
  let debounce = null;
  let watcher = null;

  function setupWatcher() {
    try {
      // Watch the directory so we catch file creation too
      watcher = fs.watch(sourceDir, { persistent: false }, (eventType, filename) => {
        if (filename && path.basename(sourcePath) !== filename) return;
        if (debounce) return;
        debounce = Meteor.setTimeout(() => {
          debounce = null;
          refresh(`fs.watch ${eventType}`);
        }, 200);
      });
      watcher.on('error', err => {
        console.warn(`[jsonl-projector] ${name}: watcher error:`, err.message);
      });
      console.log(`[jsonl-projector] ${name}: watching ${sourceDir}`);
    } catch (err) {
      console.warn(`[jsonl-projector] ${name}: could not watch ${sourceDir}:`, err.message);
    }
  }

  // Ensure dir exists
  try {
    if (!fs.existsSync(sourceDir)) {
      fs.mkdirSync(sourceDir, { recursive: true });
    }
    setupWatcher();
  } catch (err) {
    console.warn(`[jsonl-projector] ${name}: dir setup error:`, err.message);
  }

  _running[name] = { config, watcher, collection };
}

// ---------------------------------------------------------------------------
// Stop a named projector (close watcher, clear collection).
// ---------------------------------------------------------------------------

function stop(name) {
  const entry = _running[name];
  if (!entry) return;

  if (entry.watcher) {
    try { entry.watcher.close(); } catch (_) {}
  }
  if (entry.collection) {
    try { entry.collection.remove({}); } catch (_) {}
  }

  delete _running[name];
  console.log(`[jsonl-projector] stopped projector: ${name}`);
}

// ---------------------------------------------------------------------------
// Hot reload — diff configs, stop removed, start new, leave running unchanged.
// ---------------------------------------------------------------------------

function reload(newConfigs) {
  const newNames = new Set(newConfigs.map(c => c.name));
  const oldNames = new Set(Object.keys(_running));

  // Stop removed
  for (const name of oldNames) {
    if (!newNames.has(name)) {
      console.log(`[jsonl-projector] reload: removing ${name}`);
      stop(name);
    }
  }

  // Start new (skip already running)
  for (const cfg of newConfigs) {
    if (!oldNames.has(cfg.name)) {
      console.log(`[jsonl-projector] reload: starting new indexer ${cfg.name}`);
      start(cfg);
    } else {
      console.log(`[jsonl-projector] reload: ${cfg.name} already running — unchanged`);
    }
  }
}

// Export
globalThis.JsonlProjector = { start, stop, reload };
