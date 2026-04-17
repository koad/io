// Kingdoms indexer — reads kingdoms.json config, seeds the Kingdoms collection
// Backwards compatible: if kingdoms.json is absent, operates in flat-namespace mode (no-op)
// Per VESTA-SPEC-115: kingdom as sovereign participation unit

const fs = Npm.require('fs');
const path = Npm.require('path');

const KINGDOMS_CONFIG = path.join(process.env.HOME, '.koad-io', 'daemon', 'kingdoms.json');

let configWatcher = null;

// Parse and validate kingdoms.json
function loadConfig() {
  try {
    const raw = fs.readFileSync(KINGDOMS_CONFIG, 'utf8');
    const data = JSON.parse(raw);
    // Accept both array format and object with kingdoms key
    const kingdoms = Array.isArray(data) ? data : (data.kingdoms || []);
    return kingdoms;
  } catch (e) {
    if (e.code === 'ENOENT') {
      return null; // File absent — flat namespace mode
    }
    console.error('[KINGDOMS] Failed to parse kingdoms.json:', e.message);
    return null;
  }
}

// Upsert a single kingdom record into the Kingdoms collection
function upsertKingdom(k) {
  const id = k.id || k.slug;
  if (!id) {
    console.warn('[KINGDOMS] Kingdom entry missing id/slug — skipping:', JSON.stringify(k));
    return;
  }

  const memberHandles = Array.isArray(k.members) ? k.members : [];

  const doc = {
    name: k.name || id,
    domain: k.domain || null,
    sovereign: k.sovereign || null,
    sovereigntyModel: k.sovereigntyModel || k.sovereignty_model || null,
    memberHandles,
    memberCount: memberHandles.length,
    rootSigchainCid: k.rootSigchainCid || k.root_sigchain_cid || null,
    updatedAt: new Date(),
  };

  const existing = Kingdoms.findOne(id);
  if (existing) {
    Kingdoms.update(id, { $set: doc });
  } else {
    Kingdoms.insert(Object.assign({ _id: id, createdAt: new Date() }, doc));
    console.log(`[KINGDOMS] + ${id} (${doc.sovereign || 'no sovereign'}, ${doc.sovereigntyModel || 'no model'})`);
  }
}

// Build lookup maps from kingdoms config for entity stamping
// Returns { memberToKingdomId, sovereignMap } or null if no config
function buildKingdomMaps(kingdoms) {
  if (!kingdoms || kingdoms.length === 0) return null;

  const memberToKingdomId = {}; // handle → kingdomId
  const sovereignMap = {};      // handle → kingdomId (for sovereigns only)

  for (const k of kingdoms) {
    const id = k.id || k.slug;
    if (!id) continue;
    if (k.sovereign) {
      sovereignMap[k.sovereign] = id;
    }
    const members = Array.isArray(k.members) ? k.members : [];
    for (const member of members) {
      memberToKingdomId[member] = id;
    }
    // Sovereign is implicitly a member
    if (k.sovereign && !memberToKingdomId[k.sovereign]) {
      memberToKingdomId[k.sovereign] = id;
    }
  }

  return { memberToKingdomId, sovereignMap };
}

// Stamp kingdomId and sovereignKingdom onto all Entities records
// Called after kingdoms are loaded so Entities already exist
function stampEntities(kingdoms) {
  const maps = buildKingdomMaps(kingdoms);
  if (!maps) {
    // No kingdoms configured — ensure fields are present with defaults
    EntityScanner.Entities.find().fetch().forEach(entity => {
      if (entity.kingdomId === undefined || entity.sovereignKingdom === undefined) {
        EntityScanner.Entities.update(entity._id, {
          $set: { kingdomId: null, sovereignKingdom: null }
        });
      }
    });
    return;
  }

  const { memberToKingdomId, sovereignMap } = maps;
  let stamped = 0;

  EntityScanner.Entities.find().fetch().forEach(entity => {
    const kingdomId = memberToKingdomId[entity.handle] || null;
    const sovereignKingdom = sovereignMap[entity.handle] || null;

    const current = {
      kingdomId: entity.kingdomId,
      sovereignKingdom: entity.sovereignKingdom,
    };

    // Only update if something changed (avoid noisy writes)
    if (current.kingdomId !== kingdomId || current.sovereignKingdom !== sovereignKingdom) {
      EntityScanner.Entities.update(entity._id, {
        $set: { kingdomId, sovereignKingdom }
      });
      stamped++;
    }
  });

  if (stamped > 0) {
    console.log(`[KINGDOMS] Stamped ${stamped} entity record(s) with kingdom fields`);
  }
}

// Full scan: read config, upsert all kingdoms, stamp entities
function scanAll() {
  const kingdoms = loadConfig();

  if (kingdoms === null) {
    console.log('[KINGDOMS] no kingdoms configured — operating in flat namespace mode');
    stampEntities(null);
    return;
  }

  if (kingdoms.length === 0) {
    console.log('[KINGDOMS] kingdoms.json present but empty — no kingdoms to index');
    stampEntities(null);
    return;
  }

  // Track IDs seen in this scan for stale-removal
  const seenIds = new Set();

  for (const k of kingdoms) {
    upsertKingdom(k);
    const id = k.id || k.slug;
    if (id) seenIds.add(id);
  }

  // Remove kingdoms no longer in config
  Kingdoms.find().fetch().forEach(existing => {
    if (!seenIds.has(existing._id)) {
      Kingdoms.remove(existing._id);
      console.log(`[KINGDOMS] - ${existing._id} (removed from config)`);
    }
  });

  console.log(`[KINGDOMS] Scan complete: ${Kingdoms.find().count()} kingdom(s)`);

  // Stamp entities with kingdom membership data
  stampEntities(kingdoms);
}

// Start watching kingdoms.json for hot-reload
function watchConfig() {
  if (configWatcher) return;
  try {
    configWatcher = fs.watch(KINGDOMS_CONFIG, { persistent: false }, () => {
      Meteor.setTimeout(() => {
        console.log('[KINGDOMS] kingdoms.json changed — reloading');
        scanAll();
      }, 300);
    });
    console.log('[KINGDOMS] Watching kingdoms.json for changes');
  } catch (e) {
    // File may not exist yet — that's fine; scanner already logged flat-namespace mode
  }
}

// Startup (gated on KOAD_IO_INDEX_KINGDOMS)
Meteor.startup(async () => {
  const mode = process.env.KOAD_IO_INDEX_KINGDOMS;
  if (!mode) return;

  if (mode === 'true') {
    if (typeof koad !== 'undefined' && koad.workers && typeof koad.workers.start === 'function') {
      await koad.workers.start({
        service: 'index-kingdoms',
        type: 'indexer',
        interval: 5,
        runImmediately: true,
        task: async () => {
          scanAll();
        }
      });
    } else {
      console.warn('[KINGDOMS] koad.workers unavailable — falling back to one-shot scan');
      scanAll();
    }
  } else {
    // One-shot scan only (mode is a non-'true' truthy value)
    scanAll();
  }

  // Always watch for hot-reload when mode is active
  watchConfig();
});

// Publications
Meteor.publish('kingdoms.all', function () {
  return Kingdoms.find();
});

Meteor.publish('kingdoms.byId', function (id) {
  check(id, String);
  return Kingdoms.find({ _id: id });
});

// Entities scoped to a specific kingdom
Meteor.publish('kingdoms.entities', function (kingdomId) {
  check(kingdomId, String);
  return EntityScanner.Entities.find({ kingdomId });
});

// Export for other indexers
KingdomsIndexer = { Kingdoms, scanAll, loadConfig, buildKingdomMaps, stampEntities };
