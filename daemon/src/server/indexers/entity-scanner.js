// Entity scanner — always on
// Detects ~/.<name> directories with .env containing KOAD_IO_* variables
// Publishes the canonical entity list that all other indexers depend on

const fs = Npm.require('fs');
const path = Npm.require('path');

const Entities = new Mongo.Collection('Entities', { connection: null });

const homePath = process.env.HOME;

// Check if a dot-folder is a koad:io entity with a passenger manifest
function isKoadIOEntity(folderName) {
  const entityPath = path.join(homePath, folderName);
  const envPath = path.join(entityPath, '.env');
  const passengerPath = path.join(entityPath, 'passenger.json');
  try {
    const content = fs.readFileSync(envPath, 'utf8');
    if (!content.includes('KOAD_IO_')) return false;
    // Entity must have passenger.json to be ingested into the daemon
    fs.accessSync(passengerPath, fs.constants.R_OK);
    return true;
  } catch (e) {
    return false;
  }
}

// Extract handle from folder name (strip leading dot)
function handleFromFolder(folderName) {
  return folderName.replace(/^\./, '');
}

// Scan home directory for entity folders
function scanEntities() {
  const found = [];
  try {
    const entries = fs.readdirSync(homePath);
    for (const entry of entries) {
      if (entry.startsWith('.') && isKoadIOEntity(entry)) {
        found.push(entry);
      }
    }
  } catch (e) {
    console.error('[ENTITIES] Error scanning home directory:', e.message);
  }
  return found;
}

// Sync the Entities collection with what's on disk
function syncEntities() {
  const folders = scanEntities();
  const knownHandles = new Set(Entities.find().fetch().map(e => e.handle));
  const foundHandles = new Set();

  for (const folder of folders) {
    const handle = handleFromFolder(folder);
    foundHandles.add(handle);

    if (!knownHandles.has(handle)) {
      Entities.insert({
        handle,
        folder,
        path: path.join(homePath, folder),
        detectedAt: new Date(),
      });
      console.log(`[ENTITIES] + ${handle}`);
    }
  }

  // Remove entities that disappeared from disk
  Entities.find().fetch().forEach(entity => {
    if (!foundHandles.has(entity.handle)) {
      Entities.remove(entity._id);
      console.log(`[ENTITIES] - ${entity.handle}`);
    }
  });
}

// Watch home directory for new/removed entity folders
function watchHome() {
  try {
    fs.watch(homePath, { persistent: false }, (eventType, filename) => {
      if (filename && filename.startsWith('.')) {
        // Debounce: small delay so filesystem settles
        Meteor.setTimeout(() => syncEntities(), 500);
      }
    });
    console.log('[ENTITIES] Watching home directory for changes');
  } catch (e) {
    console.error('[ENTITIES] Could not watch home directory:', e.message);
  }
}

// Startup
Meteor.startup(() => {
  syncEntities();
  watchHome();
  const count = Entities.find().count();
  console.log(`[ENTITIES] Initial scan complete: ${count} entities`);
});

// Publications
Meteor.publish('entities', function () {
  return Entities.find();
});

// Export for other indexers
EntityScanner = { Entities, scanEntities, syncEntities };
