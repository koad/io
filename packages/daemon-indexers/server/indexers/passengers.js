// Passengers indexer — live (fs.watch)
// Reads ~/.<entity>/passenger.json, indexes UI registration + outfit + buttons
// Avatar served from forge public folder as /<handle>.png — no base64 embedding
// Refactored from the original passenger-methods.js
//
// VESTA-SPEC-001 §5.1 — runtime write isolation:
// passenger.json is the tracked identity record (never written by daemon).
// passenger.runtime.json (gitignored) holds daemon-writable ephemeral values
// (outfit.h, hue, and similar). At read time both files are overlaid —
// runtime values win for any field they define.

const fs = Npm.require('fs');
const path = Npm.require('path');

const Passengers = new Mongo.Collection('Passengers', { connection: null });

const watchers = new Map();

// Generate default outfit from entity name hash
function generateDefaultOutfit(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return {
    hue: Math.abs(hash % 360),
    saturation: 30 + (Math.abs(hash) % 50),
    brightness: 20 + (Math.abs(hash) % 30),
  };
}

// Load passenger.json overlaid with passenger.runtime.json (VESTA-SPEC-001 §5.1).
// passenger.json is the tracked identity source; passenger.runtime.json holds
// daemon-written ephemeral state (outfit.h, hue, etc.). Runtime fields win.
function loadPassengerConfig(entityPath) {
  const passengerJsonPath = path.join(entityPath, 'passenger.json');
  const runtimeJsonPath   = path.join(entityPath, 'passenger.runtime.json');

  let base;
  try {
    const content = fs.readFileSync(passengerJsonPath, 'utf8');
    base = JSON.parse(content);
  } catch (e) {
    return null;
  }

  // Overlay runtime file if present — top-level and nested outfit fields merged.
  try {
    const runtimeContent = fs.readFileSync(runtimeJsonPath, 'utf8');
    const runtime = JSON.parse(runtimeContent);
    // Shallow merge at top level; for `outfit`, merge one level deeper so that
    // runtime can override individual outfit fields without wiping tracked ones.
    const merged = Object.assign({}, base, runtime);
    if (base.outfit || runtime.outfit) {
      merged.outfit = Object.assign({}, base.outfit || {}, runtime.outfit || {});
    }
    return merged;
  } catch (e) {
    // runtime file absent or unreadable — use tracked file as-is
    return base;
  }
}

// Index a single entity's passenger.json
function indexEntity(handle, entityPath) {
  const config = loadPassengerConfig(entityPath);

  if (config) {
    const rawOutfit = config.outfit || generateDefaultOutfit(handle);
    const doc = {
      handle: config.handle || handle,
      name: config.name,
      image: `/${handle}.png`,
      outfit: {
        hue: rawOutfit.hue != null ? rawOutfit.hue : (rawOutfit.h != null ? rawOutfit.h : 200),
        saturation: rawOutfit.saturation != null ? rawOutfit.saturation : (rawOutfit.s != null ? rawOutfit.s : 30),
        brightness: rawOutfit.brightness != null ? rawOutfit.brightness : (rawOutfit.b != null ? rawOutfit.b : 30),
        visual: rawOutfit.visual || {},
      },
      buttons: config.buttons || [],
      scannedAt: new Date(),
    };

    const existing = Passengers.findOne({ handle: doc.handle });
    if (existing) {
      Passengers.update(existing._id, { $set: doc, $unset: { avatar: '' } });
    } else {
      Passengers.insert(doc);
      console.log(`[PASSENGERS] + ${doc.name || handle}`);
    }
  } else {
    const removed = Passengers.findOne({ handle });
    if (removed) {
      Passengers.remove({ handle });
      console.log(`[PASSENGERS] - ${handle}`);
    }
  }
}

// Watch a single entity's passenger.json AND passenger.runtime.json.
// Either file changing triggers a re-index (the overlay read handles the merge).
function watchEntity(handle, entityPath) {
  if (watchers.has(handle)) return;

  const reindex = () => Meteor.setTimeout(() => indexEntity(handle, entityPath), 300);

  const jsonPath    = path.join(entityPath, 'passenger.json');
  const runtimePath = path.join(entityPath, 'passenger.runtime.json');

  try {
    const watcher = fs.watch(jsonPath, { persistent: false }, reindex);
    watchers.set(handle, watcher);
  } catch (e) {
    // File might not exist — that's fine
  }

  // Watch runtime file if present; if it doesn't exist yet, we'll pick it up
  // on the next scanAll cycle once it appears (entity-scanner home-dir watch
  // covers newly-created files in entity dirs).
  try {
    const runtimeWatcherKey = `${handle}:runtime`;
    if (!watchers.has(runtimeWatcherKey)) {
      const runtimeWatcher = fs.watch(runtimePath, { persistent: false }, reindex);
      watchers.set(runtimeWatcherKey, runtimeWatcher);
    }
  } catch (e) {
    // runtime file not yet created — watcher added when file appears
  }
}

// Full scan
function scanAll() {
  const entities = EntityScanner.Entities.find().fetch();
  for (const entity of entities) {
    indexEntity(entity.handle, entity.path);
    watchEntity(entity.handle, entity.path);
  }
  console.log(`[PASSENGERS] Indexed. Total: ${Passengers.find().count()}`);
  if (!globalThis.indexerReady) globalThis.indexerReady = {};
  globalThis.indexerReady.passengers = new Date().toISOString();
  koad.ready.signal('passengers');
}

// Startup (gated on KOAD_IO_INDEX_PASSENGERS)
Meteor.startup(() => {
  koad.ready.register('passengers');
  const mode = process.env.KOAD_IO_INDEX_PASSENGERS;
  if (!mode) {
    koad.ready.signal('passengers');
    return;
  }

  Meteor.setTimeout(() => {
    scanAll();

    if (mode === 'true') {
      EntityScanner.Entities.find().observeChanges({
        added: (id, fields) => {
          const entityPath = path.join(process.env.HOME, fields.folder);
          indexEntity(fields.handle, entityPath);
          watchEntity(fields.handle, entityPath);
        },
      });
    }
  }, 1000);
});

// DDP methods — preserve existing passenger interaction API
Meteor.methods({
  'passenger.check.in'(passengerName) {
    // Desktop app sometimes passes the koad object instead of a string handle
    if (passengerName && typeof passengerName === 'object') {
      passengerName = passengerName.handle || passengerName.name || passengerName.entity;
    }
    check(passengerName, String);
    const passenger = Passengers.findOne({ name: passengerName });
    if (!passenger) return Meteor.Error('not-found', 'Passenger not found');

    Passengers.update({}, { $unset: { selected: '' } }, { multi: true });
    Passengers.update(passenger._id, { $set: { selected: new Date() } });
    return { _id: passenger._id };
  },

  'passenger.ingest.url'(data) {
    check(data, {
      url: String,
      title: String,
      timestamp: String,
      domain: String,
      favicon: Match.Optional(String),
    });

    const passenger = Passengers.findOne({ selected: { $exists: 1 } });
    if (!passenger) return { success: false, reason: 'No passenger selected' };

    console.log(`[INGEST] ${passenger.name} received URL: ${data.url}`);
    return { success: true, passenger: passenger.name };
  },

  'passenger.resolve.identity'(data) {
    check(data, {
      domain: String,
      url: Match.Optional(String),
    });

    const passenger = Passengers.findOne({ selected: { $exists: 1 } });
    if (!passenger) return { found: false, reason: 'No passenger selected' };

    return { found: false, message: 'Identity resolution not implemented' };
  },

  'passenger.check.url'(data) {
    check(data, {
      domain: String,
      url: Match.Optional(String),
    });

    const passenger = Passengers.findOne({ selected: { $exists: 1 } });
    if (!passenger) return { warning: false, safe: true };

    return { warning: false, safe: true, message: 'URL check not implemented' };
  },

  'passenger.reload'() {
    Passengers.remove({});
    scanAll();
    return { success: true };
  },
});

// Publications
Meteor.publish('passengers', async function () {
  await koad.ready.await('passengers');
  return Passengers.find();
});

Meteor.publish('current', async function () {
  await koad.ready.await('passengers');
  return Passengers.find({ selected: { $exists: 1 } }, { sort: { selected: 1 } });
});

// Keep legacy 'all' publication for backward compat
Meteor.publish('all', async function () {
  await koad.ready.await('passengers');
  return Passengers.find();
});
