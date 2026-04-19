// Tickler indexer — worker (periodic re-scan)
// Scans ~/.<entity>/tickler/, indexes pending tickle filenames

const fs = Npm.require('fs');
const path = Npm.require('path');

const TicklerIndex = new Mongo.Collection('TicklerIndex', { connection: null });

// Recursively collect .md files from a directory (tickles can be nested)
function collectTickles(dir, prefix) {
  const results = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        results.push(...collectTickles(path.join(dir, entry.name), relative));
      } else if (entry.name.endsWith('.md')) {
        results.push(relative);
      }
    }
  } catch (e) {
    // Directory doesn't exist or not readable
  }
  return results;
}

// Scan a single entity's tickler/ directory
function indexEntity(handle, entityPath) {
  const ticklerDir = path.join(entityPath, 'tickler');
  try {
    fs.accessSync(ticklerDir);
  } catch (e) {
    TicklerIndex.remove({ handle });
    return;
  }

  const tickles = collectTickles(ticklerDir, '');
  const existing = TicklerIndex.findOne({ handle });
  const doc = { handle, tickles, count: tickles.length, scannedAt: new Date() };

  if (existing) {
    TicklerIndex.update(existing._id, { $set: doc });
  } else {
    TicklerIndex.insert(doc);
  }
}

// Full scan
function scanAll() {
  const entities = EntityScanner.Entities.find().fetch();
  for (const entity of entities) {
    indexEntity(entity.handle, entity.path);
  }
}

// Startup (gated on KOAD_IO_INDEX_TICKLER)
Meteor.startup(async () => {
  const mode = process.env.KOAD_IO_INDEX_TICKLER;
  if (!mode) return;

  if (mode === 'true') {
    if (typeof koad !== 'undefined' && koad.workers && typeof koad.workers.start === 'function') {
      await koad.workers.start({
        service: 'index-tickler',
        type: 'indexer',
        interval: 2,
        runImmediately: true,
        task: async () => {
          scanAll();
          console.log(`[TICKLER] Scan complete: ${TicklerIndex.find().count()} entities with tickles`);
          if (!globalThis.indexerReady) globalThis.indexerReady = {};
          if (!globalThis.indexerReady.tickler) globalThis.indexerReady.tickler = new Date().toISOString();
        }
      });
    } else {
      console.warn('[TICKLER] koad.workers unavailable (koad:io-worker-processes not resolved) — falling back to one-shot scan');
      scanAll();
      console.log(`[TICKLER] Initial scan complete: ${TicklerIndex.find().count()} entities with tickles`);
      if (!globalThis.indexerReady) globalThis.indexerReady = {};
      globalThis.indexerReady.tickler = new Date().toISOString();
    }
  } else {
    // One-shot scan only
    scanAll();
    console.log(`[TICKLER] Initial scan complete: ${TicklerIndex.find().count()} entities with tickles`);
    if (!globalThis.indexerReady) globalThis.indexerReady = {};
    globalThis.indexerReady.tickler = new Date().toISOString();
  }
});

// Publications
Meteor.publish('tickler', function () {
  return TicklerIndex.find();
});

Meteor.publish('tickler.entity', function (handle) {
  check(handle, String);
  return TicklerIndex.find({ handle });
});
