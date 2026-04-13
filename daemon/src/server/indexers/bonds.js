// Bonds indexer — worker (periodic re-scan)
// Scans ~/.<entity>/trust/bonds/, indexes bond filenames and types
// Never reads file contents beyond what's needed for type detection

const fs = Npm.require('fs');
const path = Npm.require('path');

const BondsIndex = new Mongo.Collection('BondsIndex', { connection: null });

// Scan a single entity's trust/bonds/ directory
function indexEntity(handle, entityPath) {
  const bondsDir = path.join(entityPath, 'trust', 'bonds');
  try {
    const files = fs.readdirSync(bondsDir);
    const bonds = files
      .filter(f => !f.startsWith('.'))
      .map(filename => {
        const ext = path.extname(filename);
        const base = path.basename(filename, ext);
        return {
          filename,
          type: ext === '.asc' ? 'signed' : ext === '.md' ? 'bond' : 'other',
          base,
        };
      });

    const existing = BondsIndex.findOne({ handle });
    const doc = { handle, bonds, count: bonds.length, scannedAt: new Date() };

    if (existing) {
      BondsIndex.update(existing._id, { $set: doc });
    } else {
      BondsIndex.insert(doc);
    }
  } catch (e) {
    // No bonds directory — remove stale entry if any
    BondsIndex.remove({ handle });
  }
}

// Full scan
function scanAll() {
  const entities = EntityScanner.Entities.find().fetch();
  for (const entity of entities) {
    indexEntity(entity.handle, entity.path);
  }
}

// Startup (gated on KOAD_IO_INDEX_BONDS)
Meteor.startup(async () => {
  const mode = process.env.KOAD_IO_INDEX_BONDS;
  if (!mode) return;

  if (mode === 'true') {
    await koad.workers.start({
      service: 'index-bonds',
      type: 'indexer',
      interval: 2,
      runImmediately: true,
      task: async () => {
        scanAll();
        console.log(`[BONDS] Scan complete: ${BondsIndex.find().count()} entities with bonds`);
      }
    });
  } else {
    // One-shot scan only
    scanAll();
    console.log(`[BONDS] Initial scan complete: ${BondsIndex.find().count()} entities with bonds`);
  }
});

// Publications
Meteor.publish('bonds', function () {
  return BondsIndex.find();
});

Meteor.publish('bonds.entity', function (handle) {
  check(handle, String);
  return BondsIndex.find({ handle });
});
