// post-folder-projector.js — project folder-per-post directories into Mongo collections
//
// Handles indexer configs with format: post-folder
//
// Each post lives in a folder: <source>/<slug>/post.md (or main_file per declaration)
// Platform-specific adaptations are sibling files in the source entity's post folder.
// Mercury deposits platform content in-place — no Mercury-owned folder.
//
// Platform file naming:
//   <platform>.md              — first/canonical version
//   <platform>-YYYY-MM-DD.md  — subsequent versions over time
//
// Known platforms: x, substack, bluesky, blog, mastodon, threads, linkedin
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
//   assets:          ["banner.png", ...]         // file siblings (non-.md, non-platform)
//   platform_versions: {
//     x:        [{ file: "x.md", date: null }, { file: "x-2026-05-20.md", date: "2026-05-20" }],
//     substack: [{ file: "substack.md", date: null }],
//   }
//   platform_count:       number  // distinct platforms with ≥1 file
//   platform_files_count: number  // total platform files
//   platforms_config: {           // from platforms.yaml (if present)
//     primary: "x",
//     secondary: ["substack", "blog"],
//     adaptation_notes: "...",
//     voice_guide: "..."
//   }
//
// Watches the source dir for:
//   - New post folders
//   - Edits to post.md (or main_file)
//   - New sibling files
//
// Publication: indexed.<collectionName> — public by default

const fs     = Npm.require('fs');
const path   = Npm.require('path');
const crypto = Npm.require('crypto');

// Track running projectors for reload
const _running = {}; // name → { config, watcher, collection }

// ---------------------------------------------------------------------------
// SHA-256 helper — content hash, not GPG verification.
// ---------------------------------------------------------------------------

function sha256(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

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

  // ---------------------------------------------------------------------------
  // Platform version detection — dynamic, pattern-based.
  // Known platform prefixes (order matters only for display; detection is prefix-based).
  // ---------------------------------------------------------------------------

  const KNOWN_PLATFORMS = ['x', 'substack', 'bluesky', 'blog', 'mastodon', 'threads', 'linkedin'];

  // Regex: <platform>.md  or  <platform>-YYYY-MM-DD.md
  // Returns { platform, date } or null.
  function classifyPlatformFile(filename) {
    if (!filename.endsWith('.md')) return null;
    const base = filename.slice(0, -3); // strip .md
    for (const p of KNOWN_PLATFORMS) {
      if (base === p) {
        return { platform: p, date: null };
      }
      const prefix = p + '-';
      if (base.startsWith(prefix)) {
        const rest = base.slice(prefix.length);
        // Accept YYYY-MM-DD (10 chars) or any non-empty suffix
        return { platform: p, date: rest || null };
      }
    }
    return null;
  }

  // Build platform_versions: { x: [{file, date}, ...], substack: [...], ... }
  const platform_versions = {};
  const detectedPlatformFiles = new Set(); // track filenames for asset exclusion

  for (const f of siblings) {
    const classified = classifyPlatformFile(f);
    if (!classified) continue;
    detectedPlatformFiles.add(f);
    const { platform, date } = classified;
    if (!platform_versions[platform]) platform_versions[platform] = [];
    platform_versions[platform].push({ file: f, date });
  }

  // Sort each platform's files: canonical first (date: null), then chronological
  for (const p of Object.keys(platform_versions)) {
    platform_versions[p].sort((a, b) => {
      if (a.date === null) return -1;
      if (b.date === null) return 1;
      return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
    });
  }

  const platform_count       = Object.keys(platform_versions).length;
  const platform_files_count = [...detectedPlatformFiles].length;

  // ---------------------------------------------------------------------------
  // Read platforms.yaml if present
  // ---------------------------------------------------------------------------

  let platforms_config = null;
  if (siblings.includes('platforms.yaml')) {
    try {
      const yamlRaw = fs.readFileSync(path.join(folderPath, 'platforms.yaml'), 'utf8');
      // Minimal YAML parse — just top-level scalar + list keys
      const pcfg = {};
      for (const line of yamlRaw.split('\n')) {
        if (!line.trim() || line.trim().startsWith('#')) continue;
        const colon = line.indexOf(':');
        if (colon === -1) continue;
        const key = line.slice(0, colon).trim();
        let val = line.slice(colon + 1).trim();
        if (val.startsWith('[') && val.endsWith(']')) {
          val = val.slice(1, -1).split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
        } else {
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
        }
        if (val !== '') pcfg[key] = val;
      }
      platforms_config = pcfg;
    } catch (_) { /* platforms.yaml unreadable — leave null */ }
  }

  // Assets: non-.md files (images, etc.)
  // Also handle an assets/ subfolder
  let assetFiles = siblings.filter(f => {
    if (f === mainFile) return false;
    if (detectedPlatformFiles.has(f)) return false; // exclude all detected platform files
    if (f === 'brief.md') return false;
    if (f === 'platforms.yaml') return false;
    if (f === 'manifest.json') return false;
    if (f === 'signature.asc') return false;
    if (f === 'assets') return false; // exclude the dir entry itself
    return !f.startsWith('.');
  });

  // Check assets/ subfolder
  let assetsDirFiles = [];
  const assetsDirPath = path.join(folderPath, 'assets');
  try {
    const assetsDirEntries = fs.readdirSync(assetsDirPath);
    assetsDirFiles = assetsDirEntries.filter(f => !f.startsWith('.'));
  } catch (_) { /* no assets/ dir */ }

  const assets = [...assetFiles, ...assetsDirFiles.map(f => `assets/${f}`)];

  // ---------------------------------------------------------------------------
  // Completeness fields
  // ---------------------------------------------------------------------------

  const has_brief     = siblings.includes('brief.md');
  const has_platforms = siblings.includes('platforms.yaml');
  const has_signature = siblings.includes('signature.asc');
  const has_manifest  = siblings.includes('manifest.json');
  const has_assets    = assetsDirFiles.length > 0 || assetFiles.length > 0;

  // signed_valid: content-hash check only (no GPG — too expensive in projector)
  let signed_valid = false;
  if (has_signature && has_manifest) {
    try {
      const manifestRaw = fs.readFileSync(path.join(folderPath, 'manifest.json'), 'utf8');
      const manifest = JSON.parse(manifestRaw);
      if (manifest && manifest.post_sha256) {
        const currentHash = sha256(raw);
        signed_valid = currentHash === manifest.post_sha256;
      }
    } catch (_) { /* manifest unreadable or bad JSON */ }
  }

  // Completeness score (0-100):
  //   post.md         = required (always present if we got here)
  //   brief.md        = 20pts
  //   platforms.yaml  = 20pts
  //   signature+manifest = 40pts
  //   assets          = 20pts (if referenced in frontmatter or present)
  let completeness = 20; // post.md baseline — if we're here, it exists
  if (has_brief)     completeness += 20;
  if (has_platforms) completeness += 20;
  if (has_signature && has_manifest) completeness += 20;
  if (signed_valid)  completeness += 20;

  const missing = [];
  if (!has_brief)     missing.push('brief.md');
  if (!has_platforms) missing.push('platforms.yaml');
  if (!has_signature) missing.push('signature.asc');
  if (!has_manifest)  missing.push('manifest.json');

  const doc = {
    _id: slug,
    slug,
    entity: frontmatter.entity || entity || null,
    ...frontmatter,
    body,
    assets,
    platform_versions,
    platform_count,
    platform_files_count,
    platforms_config,
    // Completeness
    has_brief,
    has_platforms,
    has_signature,
    has_manifest,
    has_assets,
    signed_valid,
    completeness,
    missing,
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

  // Scope the existing-ids query to THIS entity's slice only.
  // All 9 entity indexers share the same Posts collection; without scoping,
  // each indexer treats the other entities' posts as "stale" and deletes them.
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
  if (entry.collection && entry.config.entity) {
    // Scope removal to this entity's slice only — shared collection.
    try { entry.collection.remove({ entity: entry.config.entity }); } catch (_) {}
  } else if (entry.collection) {
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
