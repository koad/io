// Passengers indexer — live (fs.watch)
// Reads ~/.<entity>/passenger.json, indexes UI registration + outfit + buttons
// Avatar served from forge public folder as /<handle>.png — no base64 embedding
// Refactored from the original passenger-methods.js

const fs = Npm.require('fs');
const path = Npm.require('path');

globalThis.Passengers = new Mongo.Collection('Passengers', { connection: null });

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
  };
}

// Load passenger.json from an entity folder
function loadPassengerConfig(entityPath) {
  const passengerJsonPath = path.join(entityPath, 'passenger.json');

  try {
    const content = fs.readFileSync(passengerJsonPath, 'utf8');
    const config = JSON.parse(content);
    return config;
  } catch (e) {
    return null;
  }
}

// Normalize an outfit from passenger.json onto the Passengers wire shape.
//
// Two schemas are live on disk. The current one (VESTA-SPEC-099 / gestate) is
// h / s / bri (+ visual). The legacy one is hue / saturation, still carried by
// .astro and .jesus. Current wins; legacy is the fallback — never the reverse.
// This is the same precedence the Blaze layer uses (templating/client/helpers/
// outfit.js normalizeOutfit), so the daemon and the templates cannot disagree
// about which name owns the color.
//
// The 200/30 tail is the historical behaviour for an outfit object that carries
// neither name. Entities with no outfit key at all never reach here — they go
// through generateDefaultOutfit() — so their docs are unchanged.
function normalizeOutfit(rawOutfit) {
  const hue = rawOutfit.h != null ? rawOutfit.h
    : (rawOutfit.hue != null ? rawOutfit.hue : 200);
  const saturation = rawOutfit.s != null ? rawOutfit.s
    : (rawOutfit.saturation != null ? rawOutfit.saturation : 30);

  const outfit = { hue, saturation, visual: rawOutfit.visual || {} };

  // Brightness exists only under the current schema (bri). Carry it when the
  // source has one and add nothing when it does not, so legacy and outfit-less
  // entities produce byte-identical docs to before.
  //
  // Deliberately NOT falling back to the legacy `brightness` key: .astro and
  // .jesus are the two files carrying it (both `brightness: 30`), and reading
  // it would add a field to two existing passports that no consumer asked for.
  // Whoever owns SPEC-099 can decide whether legacy brightness should travel.
  if (rawOutfit.bri != null) outfit.brightness = rawOutfit.bri;

  return outfit;
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
      outfit: normalizeOutfit(rawOutfit),
      buttons: config.buttons || [],
      scannedAt: new Date(),
    };

    const existing = Passengers.findOne({ handle: doc.handle });
    if (existing) {
      Passengers.update(existing._id, { $set: doc, $unset: { avatar: '' } });
    } else {
      Passengers.insert(doc);
      log.debug(`[PASSENGERS] + ${doc.name || handle}`);
    }
  } else {
    const removed = Passengers.findOne({ handle });
    if (removed) {
      Passengers.remove({ handle });
      log.debug(`[PASSENGERS] - ${handle}`);
    }
  }
}

// Watch a single entity's passenger.json
function watchEntity(handle, entityPath) {
  if (watchers.has(handle)) return;

  const jsonPath = path.join(entityPath, 'passenger.json');
  try {
    const watcher = fs.watch(jsonPath, { persistent: false }, () => {
      Meteor.setTimeout(() => indexEntity(handle, entityPath), 300);
    });
    watchers.set(handle, watcher);
  } catch (e) {
    // File might not exist — that's fine
  }
}

// Full scan
function scanAll() {
  const entities = koad.library.entities.find().fetch();
  for (const entity of entities) {
    indexEntity(entity.handle, entity.path);
    watchEntity(entity.handle, entity.path);
  }
  log.debug(`[PASSENGERS] Indexed. Total: ${Passengers.find().count()}`);
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
      koad.library.entities.find().observeChanges({
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

    log.debug(`[INGEST] ${passenger.name} received URL: ${data.url}`);
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
