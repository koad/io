// json-folder-projector.js — project per-item JSON files into a Mongo collection
//
// Handles indexer configs with format: json-folder
//
// Pattern: <source>/<handle>/profile.json  (one JSON file per sub-directory)
// The projector walks source/ for immediate subdirectories, reads profile.json
// from each, and upserts into the target collection keyed by config.key.
//
// Used by: InsiderProfiles (VESTA-SPEC-185 §9.1)
//
// Directory layout expected:
//   <source>/
//     <handle>/
//       profile.json    ← one JSON object per insider
//
// The doc _id is set to the key field value (e.g. fingerprint).
// Watches: the source directory for new subdirs; each subdir for profile.json changes.
//
// Publication: indexed.<collectionName> — public by default

const fs   = Npm.require('fs');
const path = Npm.require('path');

// Track running projectors for reload support
const _running = {}; // name → { config, watcher, subdirWatchers, collection }

// ---------------------------------------------------------------------------
// Read profile.json from a handle subdirectory. Returns parsed object or null.
// ---------------------------------------------------------------------------

function readProfileJson(handleDir) {
  const filePath = path.join(handleDir, 'profile.json');
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`[json-folder-projector] failed to read/parse ${filePath}:`, err.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Upsert one profile document into the collection.
// _id = the key field value (e.g. fingerprint).
// ---------------------------------------------------------------------------

function upsertProfile(collection, profile, keyField) {
  const keyValue = profile[keyField];
  if (!keyValue) {
    console.warn(`[json-folder-projector] profile missing key field "${keyField}":`, JSON.stringify(profile).slice(0, 80));
    return;
  }

  const docId = String(keyValue);
  const doc = Object.assign({}, profile, { _id: docId });

  const existing = collection.findOne(docId);
  if (existing) {
    collection.update(docId, { $set: doc });
  } else {
    collection.insert(doc);
  }
}

// ---------------------------------------------------------------------------
// Full scan: walk all immediate subdirectories of sourceDir,
// read profile.json from each, upsert into collection.
// Also remove docs whose source directories no longer exist.
// ---------------------------------------------------------------------------

function scanAll(collection, sourceDir, keyField) {
  let entries = [];
  try {
    if (!fs.existsSync(sourceDir)) return;
    entries = fs.readdirSync(sourceDir, { withFileTypes: true });
  } catch (err) {
    console.warn(`[json-folder-projector] scanAll error reading ${sourceDir}:`, err.message);
    return;
  }

  const liveKeys = new Set();

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.')) continue; // skip .gitkeep, .archive, etc.

    const handleDir = path.join(sourceDir, entry.name);
    const profile = readProfileJson(handleDir);
    if (!profile) continue;

    const keyValue = profile[keyField];
    if (!keyValue) continue;

    liveKeys.add(String(keyValue));
    upsertProfile(collection, profile, keyField);
  }

  // Remove stale docs (handle directories that no longer exist)
  collection.find().forEach(function (doc) {
    if (!liveKeys.has(doc._id)) {
      console.log(`[json-folder-projector] removing stale doc ${doc._id}`);
      collection.remove(doc._id);
    }
  });

  console.log(`[json-folder-projector] scan complete: ${liveKeys.size} profile(s) in ${sourceDir}`);
}

// ---------------------------------------------------------------------------
// Start watching a single handle subdirectory for profile.json changes.
// Returns the watcher (or null if dir doesn't exist).
// ---------------------------------------------------------------------------

function watchHandleDir(collection, handleDir, keyField) {
  try {
    return fs.watch(handleDir, function (eventType, filename) {
      if (filename !== 'profile.json') return;
      // Debounce via setTimeout to avoid double-fire on some platforms
      Meteor.setTimeout(function () {
        const profile = readProfileJson(handleDir);
        if (profile) {
          upsertProfile(collection, profile, keyField);
        }
      }, 150);
    });
  } catch (err) {
    console.warn(`[json-folder-projector] cannot watch ${handleDir}:`, err.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Start a json-folder projector.
// ---------------------------------------------------------------------------

function start(config) {
  const { name, collection: collectionName, key: keyField = 'fingerprint' } = config;

  if (!collectionName) {
    console.warn(`[json-folder-projector] ${name}: no collection name — skipping`);
    return;
  }

  const sourceDir = config.sourcePath || config.source;
  if (!sourceDir) {
    console.warn(`[json-folder-projector] ${name}: no source path — skipping`);
    return;
  }

  if (_running[name]) {
    console.log(`[json-folder-projector] ${name}: already running — skipping`);
    return;
  }

  // Create in-memory collection and publish it
  const collection = new Mongo.Collection(collectionName, { connection: null });
  globalThis[collectionName] = collection;

  Meteor.publish(`indexed.${collectionName}`, function () {
    return collection.find();
  });

  console.log(`[json-folder-projector] ${name}: starting on ${sourceDir} → ${collectionName} (key=${keyField})`);

  // Initial scan
  scanAll(collection, sourceDir, keyField);

  // Track per-handle watchers so we can clean up on reload
  const subdirWatchers = {};

  // Watch existing handle subdirs
  try {
    if (fs.existsSync(sourceDir)) {
      const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        const handleDir = path.join(sourceDir, entry.name);
        const w = watchHandleDir(collection, handleDir, keyField);
        if (w) subdirWatchers[entry.name] = w;
      }
    }
  } catch (err) {
    console.warn(`[json-folder-projector] ${name}: failed to set up subdir watchers:`, err.message);
  }

  // Watch the source directory itself for new handle subdirs appearing
  let dirWatcher = null;
  try {
    if (!fs.existsSync(sourceDir)) {
      fs.mkdirSync(sourceDir, { recursive: true });
    }

    dirWatcher = fs.watch(sourceDir, function (eventType, filename) {
      if (!filename || filename.startsWith('.')) return;

      Meteor.setTimeout(function () {
        const handleDir = path.join(sourceDir, filename);
        try {
          const stat = fs.statSync(handleDir);
          if (stat.isDirectory() && !subdirWatchers[filename]) {
            // New handle dir appeared — watch it and scan it
            const w = watchHandleDir(collection, handleDir, keyField);
            if (w) subdirWatchers[filename] = w;
            const profile = readProfileJson(handleDir);
            if (profile) upsertProfile(collection, profile, keyField);
          }
        } catch (_) {
          // Dir was removed — do a full rescan to remove stale docs
          if (subdirWatchers[filename]) {
            try { subdirWatchers[filename].close(); } catch (_) {}
            delete subdirWatchers[filename];
          }
          scanAll(collection, sourceDir, keyField);
        }
      }, 250);
    });
  } catch (err) {
    console.warn(`[json-folder-projector] ${name}: cannot watch source dir ${sourceDir}:`, err.message);
  }

  _running[name] = { config, watcher: dirWatcher, subdirWatchers, collection };
  console.log(`[json-folder-projector] ${name}: ready`);
}

// ---------------------------------------------------------------------------
// Stop a running projector.
// ---------------------------------------------------------------------------

function stop(name) {
  const running = _running[name];
  if (!running) return;

  if (running.watcher) {
    try { running.watcher.close(); } catch (_) {}
  }
  for (const w of Object.values(running.subdirWatchers || {})) {
    try { w.close(); } catch (_) {}
  }

  delete _running[name];
  console.log(`[json-folder-projector] stopped: ${name}`);
}

// ---------------------------------------------------------------------------
// Reload: start new, stop removed, leave unchanged.
// ---------------------------------------------------------------------------

function reload(configs) {
  const incoming = new Set(configs.map(c => c.name));

  // Stop removed projectors
  for (const name of Object.keys(_running)) {
    if (!incoming.has(name)) stop(name);
  }

  // Start new or restart on config change
  for (const cfg of configs) {
    if (!_running[cfg.name]) {
      start(cfg);
    } else {
      const hashFn = globalThis.IndexerRegistry && globalThis.IndexerRegistry.configHash;
      const oldConfig = _running[cfg.name] && _running[cfg.name].config;
      const oldHash = oldConfig && (oldConfig._configHash || (hashFn && hashFn(oldConfig)));
      const newHash = cfg._configHash || (hashFn && hashFn(cfg));
      if (newHash && oldHash && newHash !== oldHash) {
        console.log(`[json-folder-projector] reload: ${cfg.name} config changed — restarting`);
        stop(cfg.name);
        start(cfg);
      }
      // else: same hash or hash unavailable — no-op, watcher stays active
    }
  }
}

// Attach to globalThis for startup dispatcher
globalThis.JsonFolderProjector = { start, stop, reload };
