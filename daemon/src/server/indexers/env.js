// Env indexer — live (fs.watch)
// Reads ~/.<entity>/.env, parses key=value pairs, indexes identity/config

const fs = Npm.require('fs');
const path = Npm.require('path');

const EnvIndex = new Mongo.Collection('EnvIndex', { connection: null });

const watchers = new Map();

// Parse a .env file into key-value pairs
function parseEnvFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const vars = {};
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;
      const key = trimmed.substring(0, eqIndex).trim();
      let value = trimmed.substring(eqIndex + 1).trim();
      // Strip surrounding quotes
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      vars[key] = value;
    }
    return vars;
  } catch (e) {
    return null;
  }
}

// Index a single entity's .env
function indexEntity(handle, entityPath) {
  const envPath = path.join(entityPath, '.env');
  const vars = parseEnvFile(envPath);

  if (vars) {
    const existing = EnvIndex.findOne({ handle });
    const doc = {
      handle,
      vars,
      scannedAt: new Date(),
    };
    if (existing) {
      EnvIndex.update(existing._id, { $set: doc });
    } else {
      EnvIndex.insert(doc);
    }
  } else {
    EnvIndex.remove({ handle });
  }
}

// Watch a single entity's .env file
function watchEntity(handle, entityPath) {
  if (watchers.has(handle)) return;

  const envPath = path.join(entityPath, '.env');
  try {
    const watcher = fs.watch(envPath, { persistent: false }, () => {
      Meteor.setTimeout(() => indexEntity(handle, entityPath), 300);
    });
    watchers.set(handle, watcher);
  } catch (e) {
    // File might not exist yet — that's fine
  }
}

// Full scan: index all known entities
function scanAll() {
  const entities = EntityScanner.Entities.find().fetch();
  for (const entity of entities) {
    indexEntity(entity.handle, entity.path);
    watchEntity(entity.handle, entity.path);
  }
  console.log(`[ENV] Indexed ${entities.length} entities`);
}

// Startup (gated on KOAD_IO_INDEX_ENV)
Meteor.startup(() => {
  const mode = process.env.KOAD_IO_INDEX_ENV;
  if (!mode) return;

  // Wait briefly for entity scanner to finish
  Meteor.setTimeout(() => {
    scanAll();

    if (mode === 'true') {
      // Re-scan when entities change
      EntityScanner.Entities.find().observeChanges({
        added: (id, fields) => {
          const entityPath = path.join(process.env.HOME, fields.folder);
          indexEntity(fields.handle, entityPath);
          watchEntity(fields.handle, entityPath);
        },
        removed: (id) => {
          // Cleanup handled by collection removal
        },
      });
    }
  }, 1000);
});

// Publications
Meteor.publish('env', function () {
  return EnvIndex.find();
});

Meteor.publish('env.entity', function (handle) {
  check(handle, String);
  return EnvIndex.find({ handle });
});
