// Passengers indexer — live (fs.watch)
// Reads ~/.<entity>/passenger.json, indexes UI registration + outfit + buttons + avatar
// Refactored from the original passenger-methods.js

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

// Load passenger.json from an entity folder and embed avatar
function loadPassengerConfig(entityPath) {
  const passengerJsonPath = path.join(entityPath, 'passenger.json');
  const avatarPath = path.join(entityPath, 'avatar.png');

  try {
    const content = fs.readFileSync(passengerJsonPath, 'utf8');
    const config = JSON.parse(content);

    // Embed avatar as base64 data URL if it's a file reference
    if (config.avatar && !config.avatar.startsWith('data:')) {
      try {
        const imageBuffer = fs.readFileSync(avatarPath);
        config.avatar = `data:image/png;base64,${imageBuffer.toString('base64')}`;
      } catch (e) {
        config.avatar = `/${config.handle}/avatar.png`;
      }
    }

    return config;
  } catch (e) {
    return null;
  }
}

// Index a single entity's passenger.json
function indexEntity(handle, entityPath) {
  const config = loadPassengerConfig(entityPath);

  if (config) {
    const doc = {
      handle: config.handle || handle,
      name: config.name,
      image: config.avatar || `/${handle}/avatar.png`,
      outfit: config.outfit || generateDefaultOutfit(handle),
      buttons: config.buttons || [],
      scannedAt: new Date(),
    };

    const existing = Passengers.findOne({ handle: doc.handle });
    if (existing) {
      Passengers.update(existing._id, { $set: doc });
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
  const entities = EntityScanner.Entities.find().fetch();
  for (const entity of entities) {
    indexEntity(entity.handle, entity.path);
    watchEntity(entity.handle, entity.path);
  }
  console.log(`[PASSENGERS] Indexed. Total: ${Passengers.find().count()}`);
}

// Startup (gated on KOAD_IO_INDEX_PASSENGERS)
Meteor.startup(() => {
  const mode = process.env.KOAD_IO_INDEX_PASSENGERS;
  if (!mode) return;

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
Meteor.publish('passengers', function () {
  return Passengers.find();
});

Meteor.publish('current', function () {
  return Passengers.find({ selected: { $exists: 1 } }, { sort: { selected: 1 } });
});

// Keep legacy 'all' publication for backward compat
Meteor.publish('all', function () {
  return Passengers.find();
});
