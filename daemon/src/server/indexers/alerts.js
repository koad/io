// Alerts indexer — live (fs.watch), always on (no env-var gate)
// Watches ~/.<entity>/notifications.json and ~/.<entity>/alerts.json
// Surfaces alert/notification data to the widget via DDP

const fs = Npm.require('fs');
const path = Npm.require('path');

const Alerts = new Mongo.Collection('Alerts', { connection: null });

// Active watchers: key = `${handle}:${source}`, value = fs.FSWatcher
const watchers = new Map();

// Read and parse a JSON file, return array or null on failure
function readJsonArray(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) return parsed;
  } catch (e) {
    // File doesn't exist, isn't readable, or isn't valid JSON
  }
  return null;
}

// Update the Alerts collection for a given entity + source
function updateAlerts(handle, source, filePath) {
  const items = readJsonArray(filePath);
  const existing = Alerts.findOne({ entity: handle, source });

  if (items && items.length > 0) {
    const doc = { entity: handle, source, items, updatedAt: new Date() };
    if (existing) {
      Alerts.update(existing._id, { $set: doc });
    } else {
      Alerts.insert(doc);
    }
  } else {
    // File gone, empty, or invalid — remove the record
    if (existing) {
      Alerts.remove(existing._id);
    }
  }
}

// Set up fs.watch on a single file for an entity
function watchFile(handle, source, filePath) {
  const key = `${handle}:${source}`;

  // Don't double-watch
  if (watchers.has(key)) return;

  try {
    const watcher = fs.watch(filePath, { persistent: false }, (eventType) => {
      // Debounce filesystem events
      Meteor.setTimeout(() => updateAlerts(handle, source, filePath), 300);
    });

    watcher.on('error', () => {
      // File was deleted or became unwatchable — clean up
      watchers.delete(key);
      const existing = Alerts.findOne({ entity: handle, source });
      if (existing) Alerts.remove(existing._id);
    });

    watchers.set(key, watcher);
  } catch (e) {
    // File doesn't exist yet — that's fine
  }
}

// Index a single entity: read current state + set up watches
function indexEntity(handle, entityPath) {
  const files = [
    { source: 'alerts', filename: 'alerts.json' },
    { source: 'notifications', filename: 'notifications.json' },
  ];

  for (const { source, filename } of files) {
    const filePath = path.join(entityPath, filename);
    updateAlerts(handle, source, filePath);
    watchFile(handle, source, filePath);
  }
}

// Full scan of all entities
function scanAll() {
  const entities = EntityScanner.Entities.find().fetch();
  for (const entity of entities) {
    indexEntity(entity.handle, entity.path);
  }
}

// Watch for new entities appearing and index them too
function watchEntityChanges() {
  EntityScanner.Entities.find().observeChanges({
    added(id, fields) {
      const entityPath = fields.path;
      const handle = fields.handle;
      if (entityPath && handle) {
        indexEntity(handle, entityPath);
      }
    },
    removed(id) {
      // Clean up watchers and collection entries for removed entities
      // We don't have the handle from the id alone, so scan watchers
    },
  });
}

// Startup — always on
Meteor.startup(() => {
  // Small delay to ensure EntityScanner has completed its initial scan
  Meteor.setTimeout(() => {
    scanAll();
    watchEntityChanges();
    const count = Alerts.find().count();
    console.log(`[ALERTS] Initial scan complete: ${count} active alert/notification sources`);
  }, 1000);
});

// Publications
Meteor.publish('alerts', function () {
  return Alerts.find();
});

Meteor.publish('alerts.entity', function (handle) {
  check(handle, String);
  return Alerts.find({ entity: handle });
});

// DDP method to clear alerts
Meteor.methods({
  'alerts.clear'(entity, source) {
    check(entity, String);
    if (source) {
      check(source, String);
      Alerts.remove({ entity, source });
    } else {
      Alerts.remove({ entity });
    }
  },

  'alerts.dismiss'(data) {
    check(data, { entity: String, source: String, index: Match.Integer });
    const homePath = process.env.HOME;
    if (!homePath) return;
    const filePath = path.join(homePath, '.' + data.entity, data.source + '.json');

    const items = readJsonArray(filePath);
    if (!items || data.index < 0 || data.index >= items.length) return;

    items.splice(data.index, 1);

    if (items.length === 0) {
      // Remove the file — fs.watch will fire and clean up the collection
      try { fs.unlinkSync(filePath); } catch (e) { /* already gone */ }
    } else {
      // Write back — fs.watch will fire and update the collection
      fs.writeFileSync(filePath, JSON.stringify(items, null, 2), 'utf8');
    }
  },
});
