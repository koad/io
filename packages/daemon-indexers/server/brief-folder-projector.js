// brief-folder-projector.js — project flat brief files into Mongo collections
//
// Handles indexer configs with format: brief-folder
//
// Each brief lives at: <source>/<slug>.md   (flat, not folder-per-item)
// Archived briefs live at: <source>/.archive/<slug>.md
//
// PRIMER.md at the root is documentation, not a brief — skipped.
// Files starting with '.' are skipped.
//
// Doc shape (canonical):
//   _id:        "<entity>--<slug>"          // stable, collision-safe
//   entity:     "<entity>"                   // from yaml entity field
//   slug:       "<filename without .md>"
//   path:       "<full path on disk>"
//   archived:   <true if in .archive/ subdir, else false>
//
//   // All frontmatter fields pass through (title, date, status, type,
//   // audience, entities, tags, relates-to, priority, …)
//
//   body:       "<markdown body after frontmatter>"
//   mtime:      "<ISO string>"
//   scanned_at: "<ISO string>"
//
// Watches source dir and .archive/ subdir for changes.
// Initial scan on startup; re-scan on file events.
//
// Publication: indexed.Briefs — public by default

const fs     = Npm.require('fs');
const path   = Npm.require('path');

// Track running projectors for reload
const _running = {}; // name → { config, watcher, archiveWatcher, collection }

// ---------------------------------------------------------------------------
// Minimal YAML frontmatter parser — same logic as post-folder-projector.
// Returns { frontmatter: {}, body: '' }
// ---------------------------------------------------------------------------

function parseFrontmatter(raw) {
  if (!raw || typeof raw !== 'string') return { frontmatter: {}, body: '' };

  const lines = raw.split('\n');
  if (lines[0].trim() !== '---') return { frontmatter: {}, body: raw };

  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      end = i;
      break;
    }
  }

  if (end === -1) return { frontmatter: {}, body: raw };

  const fmLines = lines.slice(1, end);
  const body = lines.slice(end + 1).join('\n').trim();

  const frontmatter = {};
  for (const line of fmLines) {
    if (!line.trim() || line.trim().startsWith('#')) continue;

    const colon = line.indexOf(':');
    if (colon === -1) continue;

    const key = line.slice(0, colon).trim();
    let val = line.slice(colon + 1).trim();

    // Handle YAML arrays: [item1, item2, item3]
    if (val.startsWith('[') && val.endsWith(']')) {
      val = val.slice(1, -1).split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
    } else {
      // Strip surrounding quotes
      if ((val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
    }

    frontmatter[key] = val;
  }

  return { frontmatter, body };
}

// ---------------------------------------------------------------------------
// Read a single brief file and return a doc, or null if unparseable.
// ---------------------------------------------------------------------------

function readBriefFile(filePath, slug, entity, archived) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (_) {
    return null;
  }

  let mtime = null;
  try {
    const stat = fs.statSync(filePath);
    mtime = stat.mtime.toISOString();
  } catch (_) {}

  const { frontmatter, body } = parseFrontmatter(raw);

  // Derive _id: entity--slug (stable, cross-entity safe)
  const _id = `${entity}--${slug}`;

  const doc = {
    _id,
    entity: frontmatter.entity || entity,
    slug,
    path: filePath,
    archived: archived || false,
    ...frontmatter,
    body,
    mtime,
    scanned_at: new Date().toISOString(),
  };

  // Normalize date field to string if present
  if (doc.date && typeof doc.date !== 'string') {
    doc.date = String(doc.date);
  }

  return doc;
}

// ---------------------------------------------------------------------------
// Check if a filename should be indexed.
// ---------------------------------------------------------------------------

function shouldIndex(filename) {
  if (!filename.endsWith('.md')) return false;
  if (filename.startsWith('.')) return false;
  if (filename === 'PRIMER.md') return false;
  if (filename === 'README.md') return false;
  return true;
}

// ---------------------------------------------------------------------------
// Scan a directory of brief .md files.
// Returns array of docs.
// ---------------------------------------------------------------------------

function scanBriefDir(dirPath, entity, archived) {
  const docs = [];
  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (_) {
    return docs;
  }

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!shouldIndex(entry.name)) continue;

    const filePath = path.join(dirPath, entry.name);
    const slug = entry.name.slice(0, -3); // strip .md
    const doc = readBriefFile(filePath, slug, entity, archived);
    if (doc) docs.push(doc);
  }

  return docs;
}

// ---------------------------------------------------------------------------
// Project all briefs (source + .archive) into the collection.
// Scoped to this entity's slice — does not disturb other entities' docs.
// ---------------------------------------------------------------------------

function projectAll(collection, sourceDir, entity) {
  const archiveDir = path.join(sourceDir, '.archive');

  const docs = [
    ...scanBriefDir(sourceDir, entity, false),
    ...scanBriefDir(archiveDir, entity, true),
  ];

  // Scope to this entity only
  const selector = entity ? { entity } : {};
  const existingIds = new Set(
    collection.find(selector, { fields: { _id: 1 } }).fetch().map(d => d._id)
  );

  let inserted = 0;
  let updated = 0;
  const seenIds = new Set();

  for (const doc of docs) {
    seenIds.add(doc._id);
    if (existingIds.has(doc._id)) {
      collection.update(doc._id, { $set: doc });
      updated++;
    } else {
      try {
        collection.insert(doc);
        inserted++;
      } catch (err) {
        // Guard against concurrent scans: if insert fails due to duplicate _id,
        // fall back to update (watcher fires before initial scan completes).
        if (err.message && err.message.includes('Duplicate _id')) {
          collection.update(doc._id, { $set: doc });
          updated++;
        } else {
          throw err;
        }
      }
    }
  }

  // Remove stale docs (deleted brief files)
  for (const existingId of existingIds) {
    if (!seenIds.has(existingId)) {
      collection.remove(existingId);
      console.log(`[brief-folder-projector] removed stale doc: ${existingId}`);
    }
  }

  return { inserted, updated, total: docs.length };
}

// ---------------------------------------------------------------------------
// Start a single brief-folder projector.
// ---------------------------------------------------------------------------

function start(config) {
  const { name, collection: collectionName } = config;

  if (!collectionName) {
    console.warn(`[brief-folder-projector] ${name}: no collection name — skipping`);
    return;
  }

  const sourceDir = config.sourcePath || config.source || null;
  if (!sourceDir) {
    console.warn(`[brief-folder-projector] ${name}: no source path resolved — skipping`);
    return;
  }

  const entity = config.entity || null;
  const archiveDir = path.join(sourceDir, '.archive');

  // Create or reuse collection (shared Briefs collection, connection: null)
  let collection;
  if (globalThis[collectionName] instanceof Mongo.Collection) {
    collection = globalThis[collectionName];
    console.log(`[brief-folder-projector] ${name}: reusing existing collection ${collectionName}`);
  } else {
    collection = new Mongo.Collection(collectionName, { connection: null });
    globalThis[collectionName] = collection;
    console.log(`[brief-folder-projector] ${name}: created collection ${collectionName}`);
  }

  // Register DDP publication (idempotent — only registers once per collection name)
  const pubName = `indexed.${collectionName}`;
  try {
    Meteor.publish(pubName, function () {
      return collection.find();
    });
    console.log(`[brief-folder-projector] ${name}: registered publication ${pubName}`);
  } catch (err) {
    if (!err.message || !err.message.includes('already registered')) {
      console.warn(`[brief-folder-projector] ${name}: publish registration note:`, err.message);
    }
  }

  // Ensure source dir exists
  try {
    if (!fs.existsSync(sourceDir)) {
      fs.mkdirSync(sourceDir, { recursive: true });
    }
  } catch (err) {
    console.warn(`[brief-folder-projector] ${name}: sourceDir setup error:`, err.message);
  }

  // Initial scan
  function refresh(reason) {
    console.log(`[brief-folder-projector] ${name}: scanning (${reason})`);
    const { inserted, updated, total } = projectAll(collection, sourceDir, entity);
    console.log(`[brief-folder-projector] ${name}: +${inserted} inserted, ~${updated} updated — ${total} briefs in ${collectionName}`);
  }

  refresh('startup');

  // ---------------------------------------------------------------------------
  // File watcher helper — shared debounce map, re-scans full entity slice on change.
  // Brief files are flat; any change to the dir means re-project the whole entity.
  // ---------------------------------------------------------------------------
  const debounces = {};

  function watchDir(dirPath, label) {
    let watcher = null;
    try {
      if (!fs.existsSync(dirPath)) {
        // Dir may not exist yet (e.g. no .archive yet) — skip watching for now
        console.log(`[brief-folder-projector] ${name}: ${label} absent, not watching`);
        return null;
      }
      watcher = fs.watch(dirPath, { persistent: false }, (eventType, filename) => {
        if (!filename) return;
        if (!shouldIndex(filename)) return;

        const debKey = `${label}/${filename}`;
        if (debounces[debKey]) clearTimeout(debounces[debKey]);
        debounces[debKey] = Meteor.setTimeout(() => {
          delete debounces[debKey];
          console.log(`[brief-folder-projector] ${name}: change detected in ${label} (${filename})`);
          refresh(`file-change:${label}/${filename}`);
        }, 200);
      });

      watcher.on('error', err => {
        console.warn(`[brief-folder-projector] ${name}: watcher error on ${label}:`, err.message);
      });

      console.log(`[brief-folder-projector] ${name}: watching ${dirPath}`);
    } catch (err) {
      console.warn(`[brief-folder-projector] ${name}: could not watch ${dirPath}:`, err.message);
    }
    return watcher;
  }

  const watcher        = watchDir(sourceDir,  'briefs');
  const archiveWatcher = watchDir(archiveDir, '.archive');

  _running[name] = { config, watcher, archiveWatcher, collection };
}

// ---------------------------------------------------------------------------
// Stop a named projector.
// ---------------------------------------------------------------------------

function stop(name) {
  const entry = _running[name];
  if (!entry) return;

  if (entry.watcher) {
    try { entry.watcher.close(); } catch (_) {}
  }
  if (entry.archiveWatcher) {
    try { entry.archiveWatcher.close(); } catch (_) {}
  }
  if (entry.collection && entry.config.entity) {
    try { entry.collection.remove({ entity: entry.config.entity }); } catch (_) {}
  } else if (entry.collection) {
    try { entry.collection.remove({}); } catch (_) {}
  }

  delete _running[name];
  console.log(`[brief-folder-projector] stopped projector: ${name}`);
}

// ---------------------------------------------------------------------------
// Reload — stop removed, start new, leave running unchanged.
// ---------------------------------------------------------------------------

function reload(newConfigs) {
  const briefFolderConfigs = newConfigs.filter(c => c.format === 'brief-folder');
  const newNames = new Set(briefFolderConfigs.map(c => c.name));
  const oldNames = new Set(Object.keys(_running));

  for (const name of oldNames) {
    if (!newNames.has(name)) {
      console.log(`[brief-folder-projector] reload: removing ${name}`);
      stop(name);
    }
  }

  for (const cfg of briefFolderConfigs) {
    if (!oldNames.has(cfg.name)) {
      console.log(`[brief-folder-projector] reload: starting new indexer ${cfg.name}`);
      start(cfg);
    } else {
      console.log(`[brief-folder-projector] reload: ${cfg.name} already running — unchanged`);
    }
  }
}

// Export
globalThis.BriefFolderProjector = { start, stop, reload };
