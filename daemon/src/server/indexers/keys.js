// Keys indexer — worker (periodic re-scan)
// Scans ~/.<entity>/id/, indexes key PRESENCE and filenames only
// NEVER reads key file contents

const fs = Npm.require('fs');
const path = Npm.require('path');

const KeysIndex = new Mongo.Collection('KeysIndex', { connection: null });

// Scan a single entity's id/ directory
function indexEntity(handle, entityPath) {
  const idDir = path.join(entityPath, 'id');
  try {
    const files = fs.readdirSync(idDir);
    const keys = files
      .filter(f => !f.startsWith('.'))
      .map(filename => ({
        filename,
        type: path.extname(filename).replace('.', '') || 'unknown',
      }));

    const existing = KeysIndex.findOne({ handle });
    const doc = { handle, keys, count: keys.length, scannedAt: new Date() };

    if (existing) {
      KeysIndex.update(existing._id, { $set: doc });
    } else {
      KeysIndex.insert(doc);
    }
  } catch (e) {
    KeysIndex.remove({ handle });
  }
}

// Full scan
function scanAll() {
  const entities = EntityScanner.Entities.find().fetch();
  for (const entity of entities) {
    indexEntity(entity.handle, entity.path);
  }
}

// Startup (gated on KOAD_IO_INDEX_KEYS)
Meteor.startup(async () => {
  const mode = process.env.KOAD_IO_INDEX_KEYS;
  if (!mode) return;

  if (mode === 'true') {
    await koad.workers.start({
      service: 'index-keys',
      type: 'indexer',
      interval: 2,
      runImmediately: true,
      task: async () => {
        scanAll();
        console.log(`[KEYS] Scan complete: ${KeysIndex.find().count()} entities with keys`);
      }
    });
  } else {
    // One-shot scan only
    scanAll();
    console.log(`[KEYS] Initial scan complete: ${KeysIndex.find().count()} entities with keys`);
  }
});

// Publications
Meteor.publish('keys', function () {
  return KeysIndex.find();
});

Meteor.publish('keys.entity', function (handle) {
  check(handle, String);
  return KeysIndex.find({ handle });
});
