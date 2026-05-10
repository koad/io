// PRIMER indexer — periodic full-scan
// Walks ~/.forge/, ~/.koad-io/, ~/.ecoincore/ recursively
// Finds every PRIMER.md with `type: primer` atlas frontmatter
// Projects into a Primers Mongo collection (in-memory, connection: null)
//
// Runs: initial scan on Meteor.startup(), then every 5 minutes
// Gated on: KOAD_IO_INDEX_PRIMERS env var

const fs = Npm.require('fs');
const path = Npm.require('path');
const yaml = Npm.require('js-yaml');

const Primers = new Mongo.Collection('Primers', { connection: null });

// Directories to skip during recursive walk
const SKIP_DIRS = new Set([
  'node_modules',
  '.npm',
  '.git',
  '.meteor',
  '.claude',
  '.opencode',
  'dist',
  'builds',
  '.archive',
  '.trash',
]);

// Resolve ~ paths at scan time using process.env.HOME
const SCAN_PATHS = [
  path.join(process.env.HOME, '.forge'),
  path.join(process.env.HOME, '.koad-io'),
  path.join(process.env.HOME, '.ecoincore'),
];

// Stable _id for a PRIMER: md5-ish hash of path → base64url slug
// Simple djb2 hash is sufficient — collision probability across O(1000) files is negligible
function stableId(filePath) {
  let h = 5381;
  for (let i = 0; i < filePath.length; i++) {
    h = (Math.imul(h, 33) ^ filePath.charCodeAt(i)) >>> 0;
  }
  return 'primer_' + h.toString(36);
}

// Extract and parse YAML frontmatter from a PRIMER.md file
// Returns { fm, body } or null if no valid frontmatter block
function parsePrimerFile(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    console.warn(`[PRIMERS] cannot read ${filePath}: ${e.message}`);
    return null;
  }

  // Must start with ---
  if (!content.startsWith('---')) return null;

  // Find closing ---
  const end = content.indexOf('\n---', 3);
  if (end === -1) return null;

  const block = content.slice(3, end).trim();
  const body = content.slice(end + 4).trim();

  let fm;
  try {
    fm = yaml.load(block);
  } catch (e) {
    console.warn(`[PRIMERS] malformed YAML in ${filePath}: ${e.message}`);
    return null;
  }

  if (!fm || typeof fm !== 'object') return null;

  return { fm, body };
}

// Recursively walk a directory, yielding PRIMER.md paths
// Skips directories in SKIP_DIRS
function* walkForPrimers(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    // Permission error or missing dir — skip silently
    return;
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      // Also skip hidden dirs that start with '.' (except we allow .koad-io etc via explicit SCAN_PATHS)
      yield* walkForPrimers(path.join(dir, entry.name));
    } else if (entry.isFile() && entry.name === 'PRIMER.md') {
      yield path.join(dir, entry.name);
    }
  }
}

// Build a Primers collection record from a file path
// Returns the doc or null if the file should be skipped
function buildRecord(filePath) {
  const parsed = parsePrimerFile(filePath);
  if (!parsed) return null;

  const { fm } = parsed;

  // Only index atlas-format PRIMERs (type: primer)
  if (fm.type !== 'primer') return null;

  let mtime = null;
  try {
    const stat = fs.statSync(filePath);
    mtime = stat.mtime;
  } catch (e) {
    // Non-critical — leave null
  }

  return {
    _id: stableId(filePath),
    path: filePath,
    folder: fm.folder || null,
    parents: Array.isArray(fm.parents) ? fm.parents : (fm.parents ? [fm.parents] : []),
    children: Array.isArray(fm.children) ? fm.children : [],
    features: Array.isArray(fm.features) ? fm.features : [],
    'relates-to': Array.isArray(fm['relates-to']) ? fm['relates-to'] : (fm['relates-to'] ? [fm['relates-to']] : []),
    entities: Array.isArray(fm.entities) ? fm.entities : (fm.entities ? [fm.entities] : []),
    last_walked: fm['last-walked'] ? new Date(fm['last-walked']) : null,
    as_of: fm['as-of'] || null,
    scanned_at: new Date(),
    mtime,
  };
}

// Full scan across all three scan paths
function scanAll() {
  const seenIds = new Set();
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const scanRoot of SCAN_PATHS) {
    for (const filePath of walkForPrimers(scanRoot)) {
      const doc = buildRecord(filePath);
      if (!doc) {
        skipped++;
        continue;
      }

      seenIds.add(doc._id);

      const existing = Primers.findOne({ _id: doc._id });
      if (existing) {
        Primers.update(doc._id, { $set: doc });
        updated++;
      } else {
        Primers.insert(doc);
        console.log(`[PRIMERS] + ${doc.path}`);
        inserted++;
      }
    }
  }

  // Remove stale records (PRIMERs that were deleted from disk)
  Primers.find().fetch().forEach(rec => {
    if (!seenIds.has(rec._id)) {
      Primers.remove(rec._id);
      console.log(`[PRIMERS] - ${rec.path} (stale)`);
    }
  });

  const total = Primers.find().count();
  console.log(`[PRIMERS] Scan complete: ${total} indexed (+${inserted} new, ${updated} updated, ${skipped} skipped)`);
  return total;
}

// Startup — gated on KOAD_IO_INDEX_PRIMERS
Meteor.startup(async () => {
  koad.ready.register('primers');

  const mode = process.env.KOAD_IO_INDEX_PRIMERS;
  if (!mode) {
    koad.ready.signal('primers');
    return;
  }

  // Initial scan
  const count = scanAll();

  if (!globalThis.indexerReady) globalThis.indexerReady = {};
  globalThis.indexerReady.primers = new Date().toISOString();
  koad.ready.signal('primers');

  // Periodic re-scan every 5 minutes (300 000 ms)
  if (mode === 'true') {
    Meteor.setInterval(() => {
      scanAll();
    }, 5 * 60 * 1000);
  }
});

// Publication — null-pub for storefront bridge consumption when ready
Meteor.publish('primers', async function () {
  await koad.ready.await('primers');
  return Primers.find();
});

Meteor.publish('primers.path', async function (filePath) {
  check(filePath, String);
  await koad.ready.await('primers');
  return Primers.find({ path: filePath });
});

// Expose collection on globalThis so other server files can reference it without re-declaring
globalThis.PrimersCollection = Primers;
