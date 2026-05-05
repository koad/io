// post-folder-projector.js — project folder-per-post directories into Mongo collections
//
// Handles indexer configs with format: post-folder
//
// Each post lives in a folder: <source>/<slug>/post.md (or main_file per declaration)
// Platform-specific adaptations are sibling files: substack.md, twitter.md, bluesky.md
// Asset files (images, etc.) are also enumerated as siblings
//
// Doc shape (canonical):
//   _id:             "<slug>"                    // folder name
//   slug:            "<folder name>"
//   entity:          "<entity>"                  // from yaml entity field
//   title:           string                      // from post.md frontmatter
//   date:            string                      // from post.md frontmatter
//   author:          string
//   tags:            string[]
//   ... (any frontmatter fields)
//   body:            "<markdown body>"            // post.md content after frontmatter
//   assets:          ["banner.png", ...]         // file siblings of post.md (non-.md)
//   platform_versions: {
//     substack:      "<contents of substack.md>",
//     twitter:       "<contents of twitter.md>",
//     bluesky:       "<contents of bluesky.md>",
//   }
//
// Watches the source dir for:
//   - New post folders
//   - Edits to post.md (or main_file)
//   - New sibling files
//
// Publication: indexed.<collectionName> — public by default

const fs   = Npm.require('fs');
const path = Npm.require('path');

// Track running projectors for reload
const _running = {}; // name → { config, watcher, collection }

// ---------------------------------------------------------------------------
// Minimal YAML frontmatter parser.
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
    // Skip blank lines and comments
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
// Read a single post folder and return a doc, or null if unparseable.
// ---------------------------------------------------------------------------

function readPostFolder(folderPath, slug, entity) {
  const mainFile = 'post.md'; // configurable per declaration, but we use post.md as default
  const postPath = path.join(folderPath, mainFile);

  let raw;
  try {
    raw = fs.readFileSync(postPath, 'utf8');
  } catch (_) {
    // post.md doesn't exist yet — folder stub, skip it
    return null;
  }

  const { frontmatter, body } = parseFrontmatter(raw);

  // Enumerate siblings
  let siblings;
  try {
    siblings = fs.readdirSync(folderPath);
  } catch (_) {
    siblings = [];
  }

  // Platform versions: substack.md, twitter.md, bluesky.md
  const platform_versions = {};
  const PLATFORM_FILES = ['substack.md', 'twitter.md', 'bluesky.md'];
  for (const pf of PLATFORM_FILES) {
    if (siblings.includes(pf)) {
      try {
        platform_versions[pf.replace('.md', '')] = fs.readFileSync(
          path.join(folderPath, pf), 'utf8'
        );
      } catch (_) { /* skip */ }
    }
  }

  // Assets: non-.md files (images, etc.)
  const assets = siblings.filter(f => {
    if (f === mainFile) return false;
    if (PLATFORM_FILES.includes(f)) return false;
    return !f.startsWith('.');
  });

  const doc = {
    _id: slug,
    slug,
    entity: frontmatter.entity || entity || null,
    ...frontmatter,
    body,
    assets,
    platform_versions,
  };

  // Normalize date: ensure it's a string
  if (doc.date && typeof doc.date !== 'string') {
    doc.date = String(doc.date);
  }

  return doc;
}

// ---------------------------------------------------------------------------
// Scan the source directory and return all valid post docs.
// ---------------------------------------------------------------------------

function scanAllPosts(sourceDir, entity, mainFile) {
  const docs = [];
  let entries;
  try {
    entries = fs.readdirSync(sourceDir, { withFileTypes: true });
  } catch (_) {
    return docs;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.')) continue;

    const folderPath = path.join(sourceDir, entry.name);
    const slug = entry.name;
    const doc = readPostFolder(folderPath, slug, entity);
    if (doc) docs.push(doc);
  }

  return docs;
}

// ---------------------------------------------------------------------------
// Project all posts into the collection (upsert by slug).
// ---------------------------------------------------------------------------

function projectAll(collection, sourceDir, entity) {
  const docs = scanAllPosts(sourceDir, entity);

  const existingIds = new Set(
    collection.find({}, { fields: { _id: 1 } }).fetch().map(d => d._id)
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
      collection.insert(doc);
      inserted++;
    }
  }

  // Remove stale docs (deleted post folders)
  for (const existingId of existingIds) {
    if (!seenIds.has(existingId)) {
      collection.remove(existingId);
      console.log(`[post-folder-projector] removed stale doc: ${existingId}`);
    }
  }

  return { inserted, updated, total: docs.length };
}

// ---------------------------------------------------------------------------
// Start a single post-folder projector.
// ---------------------------------------------------------------------------

function start(config) {
  const { name, collection: collectionName } = config;

  if (!collectionName) {
    console.warn(`[post-folder-projector] ${name}: no collection name — skipping`);
    return;
  }

  // Resolve source directory
  const sourceDir = config.sourcePath || config.source || null;
  if (!sourceDir) {
    console.warn(`[post-folder-projector] ${name}: no source path resolved — skipping`);
    return;
  }

  // Entity comes from the yaml entity field at the top level
  const entity = config.entity || null;

  // Create or reuse collection
  let collection;
  if (globalThis[collectionName] instanceof Mongo.Collection) {
    collection = globalThis[collectionName];
    console.log(`[post-folder-projector] ${name}: reusing existing collection ${collectionName}`);
  } else {
    collection = new Mongo.Collection(collectionName, { connection: null });
    globalThis[collectionName] = collection;
    console.log(`[post-folder-projector] ${name}: created collection ${collectionName}`);
  }

  // Register DDP publication (idempotent)
  const pubName = `indexed.${collectionName}`;
  try {
    Meteor.publish(pubName, function () {
      return collection.find();
    });
    console.log(`[post-folder-projector] ${name}: registered publication ${pubName}`);
  } catch (err) {
    if (!err.message || !err.message.includes('already registered')) {
      console.warn(`[post-folder-projector] ${name}: publish registration note:`, err.message);
    }
  }

  // Ensure source dir exists
  try {
    if (!fs.existsSync(sourceDir)) {
      fs.mkdirSync(sourceDir, { recursive: true });
    }
  } catch (err) {
    console.warn(`[post-folder-projector] ${name}: sourceDir setup error:`, err.message);
  }

  // Initial scan
  function refresh(reason) {
    console.log(`[post-folder-projector] ${name}: scanning (${reason})`);
    const { inserted, updated, total } = projectAll(collection, sourceDir, entity);
    console.log(`[post-folder-projector] ${name}: +${inserted} inserted, ~${updated} updated — ${total} posts in ${collectionName}`);
  }

  refresh('startup');

  // Watch the source directory for new/changed post folders
  // We watch at depth 1: new folders = new post, changed = re-scan that folder
  const debounces = {};
  let watcher = null;

  try {
    // Watch top-level dir for new folder creation
    watcher = fs.watch(sourceDir, { persistent: false }, (eventType, filename) => {
      if (!filename) return;

      // Debounce per folder name
      if (debounces[filename]) clearTimeout(debounces[filename]);
      debounces[filename] = Meteor.setTimeout(() => {
        delete debounces[filename];
        const folderPath = path.join(sourceDir, filename);

        let isDir = false;
        try { isDir = fs.statSync(folderPath).isDirectory(); } catch (_) {}

        if (isDir) {
          // New or changed post folder — re-scan it
          const slug = filename;
          const doc = readPostFolder(folderPath, slug, entity);
          if (doc) {
            const existing = collection.findOne(doc._id);
            if (existing) {
              collection.update(doc._id, { $set: doc });
              console.log(`[post-folder-projector] ${name}: updated ${slug}`);
            } else {
              collection.insert(doc);
              console.log(`[post-folder-projector] ${name}: inserted ${slug}`);
            }
          }
        }
      }, 200);
    });

    watcher.on('error', err => {
      console.warn(`[post-folder-projector] ${name}: watcher error:`, err.message);
    });

    console.log(`[post-folder-projector] ${name}: watching ${sourceDir}`);
  } catch (err) {
    console.warn(`[post-folder-projector] ${name}: could not watch ${sourceDir}:`, err.message);
  }

  // Also watch each existing post subfolder for post.md changes
  // This handles edits to existing posts
  function watchPostFolder(slug) {
    const folderPath = path.join(sourceDir, slug);
    let subWatcher = null;
    try {
      subWatcher = fs.watch(folderPath, { persistent: false }, (eventType, filename) => {
        if (!filename) return;
        const debKey = `${slug}/${filename}`;
        if (debounces[debKey]) clearTimeout(debounces[debKey]);
        debounces[debKey] = Meteor.setTimeout(() => {
          delete debounces[debKey];
          const doc = readPostFolder(folderPath, slug, entity);
          if (doc) {
            const existing = collection.findOne(doc._id);
            if (existing) {
              collection.update(doc._id, { $set: doc });
            } else {
              collection.insert(doc);
            }
            console.log(`[post-folder-projector] ${name}: refreshed ${slug}/${filename}`);
          }
        }, 200);
      });
      subWatcher.on('error', () => {}); // silently ignore watcher errors on subfolders
    } catch (_) { /* folder may not be watchable */ }
    return subWatcher;
  }

  // Set up watchers on existing post folders
  const _subWatchers = {};
  try {
    const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        _subWatchers[entry.name] = watchPostFolder(entry.name);
      }
    }
  } catch (_) {}

  _running[name] = { config, watcher, collection, _subWatchers };
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
  if (entry._subWatchers) {
    for (const w of Object.values(entry._subWatchers)) {
      if (w) try { w.close(); } catch (_) {}
    }
  }
  if (entry.collection) {
    try { entry.collection.remove({}); } catch (_) {}
  }

  delete _running[name];
  console.log(`[post-folder-projector] stopped projector: ${name}`);
}

// ---------------------------------------------------------------------------
// Reload — stop removed, start new, leave running unchanged.
// ---------------------------------------------------------------------------

function reload(newConfigs) {
  const postFolderConfigs = newConfigs.filter(c => c.format === 'post-folder');
  const newNames = new Set(postFolderConfigs.map(c => c.name));
  const oldNames = new Set(Object.keys(_running));

  for (const name of oldNames) {
    if (!newNames.has(name)) {
      console.log(`[post-folder-projector] reload: removing ${name}`);
      stop(name);
    }
  }

  for (const cfg of postFolderConfigs) {
    if (!oldNames.has(cfg.name)) {
      console.log(`[post-folder-projector] reload: starting new indexer ${cfg.name}`);
      start(cfg);
    } else {
      console.log(`[post-folder-projector] reload: ${cfg.name} already running — unchanged`);
    }
  }
}

// Export
globalThis.PostFolderProjector = { start, stop, reload };
