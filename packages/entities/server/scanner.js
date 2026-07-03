// Entity scanner — runs only in scanner mode (KOAD_IO_ENTITY_SCANNER or _LIST)
// Detects ~/.<name> directories with .env containing KOAD_IO_* variables
// Populates koad.library.entities — the canonical disk-truth inventory.
//
// If not in scanner mode, this entire file is a no-op — entities come from
// remote DDP subscription instead (server/remote.js).

if (!EntityPackage || !EntityPackage.isScanner) {
  return; // Not in scanner mode — remote.js or off-mode handles readiness
}

const fs = Npm.require('fs');
const path = Npm.require('path');
const { execFileSync } = Npm.require('child_process');

const Entities = koad.library.entities;
const homePath = process.env.HOME;

// Read the last git commit timestamp for an entity dir, or null if not a git
// repo / git unavailable. Used as a baseline for lastActivity so dormant
// entities don't all collapse to "never seen" after a daemon restart — if
// they have any commit history, we can show their last-activity meaningfully.
function lastGitCommitDate(entityPath) {
  try {
    const ts = execFileSync('git', ['-C', entityPath, 'log', '-1', '--format=%ct'], {
      encoding: 'utf8',
      timeout: 500,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const epoch = parseInt(ts, 10);
    if (!epoch || isNaN(epoch)) return null;
    return new Date(epoch * 1000);
  } catch (e) {
    return null; // not a git repo, git missing, timeout, empty repo — fine
  }
}

// Take the max of two dates (either can be null). Returns null if both null.
function maxDate(a, b) {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}


// Check if a dot-folder is a koad:io entity with a passenger manifest
function isEntity(folderName) {
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

// Identity sections — these are the public-facing parts of ENTITY.md.
// Operational sections (Session Start, Key Files, Tech Stack, etc.) belong
// in the roles/context layer at the harness level, not in the public profile.
const IDENTITY_SECTIONS = new Set([
  'Identity', 'Custodianship', 'Role', 'Personality',
  'Core Principles', 'Team Position', 'Team',
  'Behavioral Constraints', 'Behavioral Principles',
  'Communication Protocol', 'The Deeper Purpose',
  'Sovereignty Model', 'Who I Am', 'Who I Serve',
  'My Place in the Team', 'Kingdom Memberships',
  'Design Principles', 'Core Responsibilities',
  'Philosophy', 'Principles', 'Summary',
]);

// Extract identity-only sections from ENTITY.md.
// Keeps: title, tagline, and sections whose ## heading is in IDENTITY_SECTIONS.
// Drops: Session Start, Key Files, Tech Stack, Products I Watch, etc.
function extractIdentitySections(content) {
  const lines = content.split('\n');
  const out = [];
  let include = true;

  for (const line of lines) {
    const h2Match = line.match(/^## (.+)/);
    if (h2Match) {
      include = IDENTITY_SECTIONS.has(h2Match[1].trim());
    }
    if (include) out.push(line);
  }

  return out.join('\n').trim();
}

// Read entity fingerprint from id/entity.fingerprint (40-hex, one line)
function readEntityFingerprint(entityPath) {
  try {
    const fp = fs.readFileSync(path.join(entityPath, 'id', 'entity.fingerprint'), 'utf8').trim();
    if (/^[0-9A-Fa-f]{40}$/.test(fp)) return fp.toUpperCase();
  } catch (e) {}
  return null;
}

// Check if entity has a PGP public key (id/entity.public.asc)
function hasPublicKey(entityPath) {
  try {
    return fs.statSync(path.join(entityPath, 'id', 'entity.public.asc')).isFile();
  } catch (e) {
    return false;
  }
}

// Read operator sigchain index — builds handle → { genesisCid, leafCid, fingerprint } map.
// Cached; rebuilt when metadata.json mtime changes.
let _sigchainIndex = null;
let _sigchainMtime = 0;

function readOperatorSigchain() {
  const sigchainDir = path.join(homePath, '.koad-io', 'me', 'sigchain');
  const metaPath = path.join(sigchainDir, 'metadata.json');

  let mtime = 0;
  try { mtime = fs.statSync(metaPath).mtimeMs; } catch (e) { return _sigchainIndex || {}; }
  if (_sigchainIndex && mtime === _sigchainMtime) return _sigchainIndex;

  const index = {};
  const entriesDir = path.join(sigchainDir, 'entries');
  try {
    const files = fs.readdirSync(entriesDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const entry = JSON.parse(fs.readFileSync(path.join(entriesDir, file), 'utf8'));
        const handle = entry.payload && entry.payload.entity_handle;
        if (!handle) continue;
        const cid = file.replace('.json', '');
        if (entry.type === 'koad.entity.genesis') {
          if (!index[handle]) index[handle] = {};
          index[handle].genesisCid = cid;
          index[handle].fingerprint = entry.payload.entity_key_fingerprint || null;
        } else if (entry.type === 'koad.entity.leaf-authorize') {
          if (!index[handle]) index[handle] = {};
          index[handle].leafCid = cid;
          index[handle].leafFingerprint = entry.payload.leaf_fingerprint || null;
        }
      } catch (e) {}
    }
  } catch (e) {}

  // Read the chain head CID from metadata
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    index._chainHead = meta.sigchainHeadCID || null;
  } catch (e) {}

  _sigchainIndex = index;
  _sigchainMtime = mtime;
  return index;
}

// Read ENTITY.md — returns { entityMd (identity-only), tagline } or nulls
function readEntityMd(entityPath) {
  const mdPath = path.join(entityPath, 'ENTITY.md');
  try {
    const content = fs.readFileSync(mdPath, 'utf8');
    const taglineMatch = content.match(/^>\s*(.+)$/m);
    const tagline = taglineMatch ? taglineMatch[1].trim() : null;
    const entityMd = extractIdentitySections(content);
    return { entityMd, tagline };
  } catch (e) {
    return { entityMd: null, tagline: null };
  }
}

// Active ENTITY.md watchers
const entityMdWatchers = new Map(); // handle -> { path, watcher }

function closeEntityMdWatcher(handle) {
  const record = entityMdWatchers.get(handle);
  if (!record) return;
  try { record.watcher.close(); } catch (e) {}
  entityMdWatchers.delete(handle);
}

// Read passenger.json — the entity's public-facing manifest (buttons, outfit, dispatch config)
function readPassengerJson(entityPath) {
  const p = path.join(entityPath, 'passenger.json');
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    return null;
  }
}

// Read outfit.json — standalone outfit definition (may not exist yet; falls back to passenger.outfit)
function readOutfitJson(entityPath) {
  const p = path.join(entityPath, 'outfit.json');
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    return null;
  }
}

// Read contents.jsonl — manifest of entity directory sections (one JSON object per line)
function readContentsJsonl(entityPath) {
  const p = path.join(entityPath, 'contents.jsonl');
  try {
    const raw = fs.readFileSync(p, 'utf8');
    return raw.split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
  } catch (e) {
    return null;
  }
}

// Scan home directory for entity folders.
// In curated mode (KOAD_IO_ENTITY_SCANNER_LIST), only those dirs.
// In greedy mode (KOAD_IO_ENTITY_SCANNER=true), all dot-dirs with passenger.json.
function scanEntities() {
  const list = EntityPackage.scannerList;
  if (list) {
    // Curated — only the named dirs, prefixed with dot if needed
    return list
      .map(h => h.startsWith('.') ? h : '.' + h)
      .filter(entry => {
        try {
          return isEntity(entry);
        } catch (e) {
          return false;
        }
      });
  }

  // Greedy — scan all dot-dirs
  const found = [];
  try {
    const entries = fs.readdirSync(homePath);
    for (const entry of entries) {
      if (entry.startsWith('.') && isEntity(entry)) {
        found.push(entry);
      }
    }
  } catch (e) {
    log.error('Error scanning home directory:', e.message);
  }
  return found;
}

// Sync the Entities collection with what's on disk
function syncEntities() {
  const folders = scanEntities();
  const knownHandles = new Set(Entities.find().fetch().map(e => e.handle));
  const foundHandles = new Set();
  const sigchainIndex = readOperatorSigchain();
  const origin = readOriginIdentity(); // from server/origin.js
  const firstHop = { id: origin.id, url: origin.url, at: new Date().toISOString() };

  for (const folder of folders) {
    const handle = handleFromFolder(folder);
    foundHandles.add(handle);
    const entityPath = path.join(homePath, folder);

    // Extract the PUBLIC-SAFE fields from .env. We do NOT index the full
    // .env anymore — that's the env-indexer's job and it's been deprecated
    // to keep secrets out of the daemon entirely. Here we only grep specific
    // non-sensitive keys: role, home machine, harness preference.
    const entityEnvPath = path.join(entityPath, '.env');
    let role = null, homeMachine = null, harness = null;
    try {
      const envContent = fs.readFileSync(entityEnvPath, 'utf8');
      const roleMatch = envContent.match(/^KOAD_IO_ENTITY_ROLE=(.+)$/m);
      if (roleMatch) role = roleMatch[1].trim();
      const hostMatch = envContent.match(/^KOAD_IO_HOME_MACHINE=(.+)$/m);
      if (hostMatch) homeMachine = hostMatch[1].trim();
      const harnessMatch = envContent.match(/^KOAD_IO_DEFAULT_HARNESS=(.+)$/m);
      if (harnessMatch) harness = harnessMatch[1].trim();
    } catch (e) { /* no .env or unreadable — fields stay null */ }

    // Read ENTITY.md
    const { entityMd, tagline } = readEntityMd(entityPath);

    // Read passenger.json and outfit.json
    const passenger = readPassengerJson(entityPath);
    const outfit = readOutfitJson(entityPath) || (passenger && passenger.outfit) || null;
    const contents = readContentsJsonl(entityPath);

    // Read identity — fingerprint from disk, sigchain from operator chain
    const fingerprint = readEntityFingerprint(entityPath);
    const hasKey = hasPublicKey(entityPath);
    const sigchainData = sigchainIndex[handle] || {};

    // Baseline lastActivity = max(last git commit, ENTITY.md mtime, .env mtime).
    // Flights and emissions push it forward to their own timestamps if newer.
    // Without this baseline, dormant entities (no flights, no emissions) show
    // "never seen" — with it, at least we know when their config last changed
    // or a commit landed in their repo.
    const gitDate = lastGitCommitDate(entityPath);
    let mdDate = null, envDate = null, passengerDate = null, outfitDate = null, contentsDate = null;
    try { mdDate = fs.statSync(path.join(entityPath, 'ENTITY.md')).mtime; } catch (e) {}
    try { envDate = fs.statSync(entityEnvPath).mtime; } catch (e) {}
    try { passengerDate = fs.statSync(path.join(entityPath, 'passenger.json')).mtime; } catch (e) {}
    try { outfitDate = fs.statSync(path.join(entityPath, 'outfit.json')).mtime; } catch (e) {}
    try { contentsDate = fs.statSync(path.join(entityPath, 'contents.jsonl')).mtime; } catch (e) {}
    const baseline = maxDate(gitDate, maxDate(mdDate, maxDate(envDate, maxDate(passengerDate, maxDate(outfitDate, contentsDate)))));

    const entityId = koad.generate.cid(handle);

    if (!knownHandles.has(handle)) {
      Entities.insert({
        _id: entityId,
        handle,
        folder,
        path: entityPath,
        role,
        homeMachine,
        harness,
        tagline,
        entityMd,
        passenger,
        outfit,
        contents,
        fingerprint,
        hasPublicKey: hasKey,
        genesisCid: sigchainData.genesisCid || null,
        leafCid: sigchainData.leafCid || null,
        sigchainTip: sigchainIndex._chainHead || null,
        lastActivity: baseline,
        detectedAt: new Date(),
        source: [firstHop],  // first hop — chain of custody starts here
      });
      log.debug(`+ ${handle} (${role || 'no role'})`);
    } else {
      const existing = Entities.findOne({ _id: entityId });
      const existingActivity = existing && existing.lastActivity ? new Date(existing.lastActivity) : null;
      // Only update lastActivity if the baseline is newer (don't regress a live stamp)
      const set = {
        _id: entityId,
        role, homeMachine, harness, tagline, entityMd,
        passenger, outfit,
        contents,
        fingerprint,
        hasPublicKey: hasKey,
        genesisCid: sigchainData.genesisCid || null,
        leafCid: sigchainData.leafCid || null,
        sigchainTip: sigchainIndex._chainHead || null,
      };
      if (baseline && (!existingActivity || baseline > existingActivity)) {
        set.lastActivity = baseline;
      }
      set.source = [firstHop];  // re-stamp first hop on update
      Entities.update({ _id: entityId }, { $set: set });
    }

    // Watch ENTITY.md for live edits
    const mdPath = path.join(entityPath, 'ENTITY.md');
    const existingWatcher = entityMdWatchers.get(handle);
    if (existingWatcher && existingWatcher.path !== mdPath) {
      closeEntityMdWatcher(handle);
    }
    if (!entityMdWatchers.has(handle)) {
      try {
        const watcher = fs.watch(mdPath, { persistent: false }, () => {
          Meteor.setTimeout(() => {
            const updated = readEntityMd(entityPath);
            Entities.update({ handle }, { $set: { tagline: updated.tagline, entityMd: updated.entityMd } });
          }, 300);
        });
        watcher.on('error', () => closeEntityMdWatcher(handle));
        entityMdWatchers.set(handle, { path: mdPath, watcher });
      } catch (e) { /* ENTITY.md might not exist */ }
    }
  }

  // Remove entities that disappeared from disk
  Entities.find().fetch().forEach(entity => {
    if (!foundHandles.has(entity.handle)) {
      closeEntityMdWatcher(entity.handle);
      Entities.remove(entity._id);
      log.debug(`- ${entity.handle}`);
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
    log.debug('Watching home directory for changes');
  } catch (e) {
    log.error('Could not watch home directory:', e.message);
  }
}

// Startup
Meteor.startup(() => {
  koad.ready.register('entities');
  syncEntities();
  watchHome();
  const count = Entities.find().count();
  log.debug(`Initial scan complete: ${count} entities`);
  if (!globalThis.indexerReady) globalThis.indexerReady = {};
  globalThis.indexerReady.entities = new Date().toISOString();
  koad.ready.signal('entities');
  log.debug('entities scanner coimplete.')
});

// Publications — all named, no null pub
Meteor.publish('entities', async function () {
  const count = koad.library.entities.find().count();
  log.debug(`publish entities: ${count} docs in koad.library.entities`);
  return koad.library.entities.find();
});

Meteor.publish('entities.byRole', async function (role) {
  check(role, String);
  await koad.ready.await('entities');
  return koad.library.entities.find({ role });
});

Meteor.publish('bonds', async function () {
  await koad.ready.await('entities');
  return koad.library.bonds.find();
});

Meteor.publish('keys', async function () {
  await koad.ready.await('entities');
  return koad.library.keys.find();
});

// ── Bond scanner — reads trust/bonds/*.md from each entity dir ──────────

function scanBonds() {
  const count = { inserted: 0, updated: 0 };
  const entities = koad.library.entities.find({}, { fields: { handle: 1, path: 1 } }).fetch();
  const existingBonds = new Set(koad.library.bonds.find().fetch().map(b => b._id));

  for (const entity of entities) {
    const bondsDir = path.join(entity.path, 'trust', 'bonds');
    let files = [];
    try { files = fs.readdirSync(bondsDir).filter(f => f.endsWith('.md') && !f.startsWith('PRIMER') && !f.startsWith('README')); } catch (e) { continue; }

    for (const file of files) {
      const bondPath = path.join(bondsDir, file);
      try {
        const raw = fs.readFileSync(bondPath, 'utf8');
        const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
        if (!fmMatch) continue;

        // Parse simple YAML-like frontmatter (key: value)
        const fm = {};
        for (const line of fmMatch[1].split('\n')) {
          const m = line.match(/^([a-zA-Z_]+):\s*(.+)$/);
          if (m) fm[m[1]] = m[2].trim();
        }

        const id = `${entity.handle}:${file.replace('.md', '')}`;
        const doc = {
          _id: id,
          handle: entity.handle,
          from: fm.from || '',
          to: fm.to || '',
          type: fm.type || '',
          status: fm.status || 'ACTIVE',
          created: fm.created || '',
          renewal: fm.renewal || '',
          file: bondPath,
          count: 1,
        };

        if (existingBonds.has(id)) {
          koad.library.bonds.update({ _id: id }, { $set: doc });
          count.updated++;
        } else {
          koad.library.bonds.insert(doc);
          count.inserted++;
        }
      } catch (e) { /* skip unreadable */ }
    }
  }

  // Remove bonds for entities that no longer exist
  const validIds = new Set();
  koad.library.bonds.find().forEach(b => {
    if (entities.find(e => e.handle === b.handle)) validIds.add(b._id);
  });
  koad.library.bonds.find().forEach(b => {
    if (!validIds.has(b._id)) koad.library.bonds.remove(b._id);
  });

  return count;
}

function runBondScan() {
  koad.ready.await('entities').then(() => {
    const c = scanBonds();
    log.debug(`Bond scan complete: ${c.inserted} inserted, ${c.updated} updated`);
  });
}

// ── Key indexer — derives from entity fingerprints ──────────────────────

function syncKeys() {
  const entities = koad.library.entities.find({}, { fields: { handle: 1, fingerprint: 1, hasPublicKey: 1 } }).fetch();
  for (const e of entities) {
    if (!e.hasPublicKey && !e.fingerprint) continue;
    koad.library.keys.upsert({ _id: e.handle }, {
      _id: e.handle,
      handle: e.handle,
      fingerprint: e.fingerprint || '',
      hasPublicKey: !!e.hasPublicKey,
      count: e.fingerprint ? 1 : 0,
    });
  }
  // Remove keys for entities that no longer exist
  const validHandles = new Set(entities.map(e => e.handle));
  koad.library.keys.find().forEach(k => {
    if (!validHandles.has(k.handle)) koad.library.keys.remove(k._id);
  });
}

Meteor.startup(() => {
  koad.ready.await('entities').then(() => syncKeys());
});

Meteor.startup(() => {
  runBondScan();
});

// Export for other indexers
EntityScanner = { Entities, scanEntities, syncEntities };
