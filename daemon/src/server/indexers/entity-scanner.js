// Entity scanner — always on
// Detects ~/.<name> directories with .env containing KOAD_IO_* variables
// Publishes the canonical entity list that all other indexers depend on

const fs = Npm.require('fs');
const path = Npm.require('path');
const { execFileSync } = Npm.require('child_process');

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
const entityMdWatchers = new Map();

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

    // Baseline lastActivity = max(last git commit, ENTITY.md mtime, .env mtime).
    // Flights and emissions push it forward to their own timestamps if newer.
    // Without this baseline, dormant entities (no flights, no emissions) show
    // "never seen" — with it, at least we know when their config last changed
    // or a commit landed in their repo.
    const gitDate = lastGitCommitDate(entityPath);
    let mdDate = null, envDate = null;
    try { mdDate = fs.statSync(path.join(entityPath, 'ENTITY.md')).mtime; } catch (e) {}
    try { envDate = fs.statSync(entityEnvPath).mtime; } catch (e) {}
    const baseline = maxDate(gitDate, maxDate(mdDate, envDate));

    if (!knownHandles.has(handle)) {
      Entities.insert({
        handle,
        folder,
        path: entityPath,
        role,
        homeMachine,
        harness,
        tagline,
        entityMd,
        lastActivity: baseline,
        detectedAt: new Date(),
      });
      console.log(`[ENTITIES] + ${handle} (${role || 'no role'})`);
    } else {
      const existing = Entities.findOne({ handle });
      const existingActivity = existing && existing.lastActivity ? new Date(existing.lastActivity) : null;
      // Only update lastActivity if the baseline is newer (don't regress a live stamp)
      const set = { role, homeMachine, harness, tagline, entityMd };
      if (baseline && (!existingActivity || baseline > existingActivity)) {
        set.lastActivity = baseline;
      }
      Entities.update({ handle }, { $set: set });
    }

    // Watch ENTITY.md for live edits
    if (!entityMdWatchers.has(handle)) {
      const mdPath = path.join(entityPath, 'ENTITY.md');
      try {
        const watcher = fs.watch(mdPath, { persistent: false }, () => {
          Meteor.setTimeout(() => {
            const updated = readEntityMd(entityPath);
            Entities.update({ handle }, { $set: { tagline: updated.tagline, entityMd: updated.entityMd } });
          }, 300);
        });
        entityMdWatchers.set(handle, watcher);
      } catch (e) { /* ENTITY.md might not exist */ }
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
  if (!globalThis.indexerReady) globalThis.indexerReady = {};
  globalThis.indexerReady.entities = new Date().toISOString();
});

// Publications
Meteor.publish('entities', function () {
  return Entities.find();
});

Meteor.publish('entities.byRole', function (role) {
  check(role, String);
  return Entities.find({ role });
});

// Export for other indexers
EntityScanner = { Entities, scanEntities, syncEntities };
