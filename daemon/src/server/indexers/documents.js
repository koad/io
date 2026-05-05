// Documents indexer — file-watching, 500ms debounce
// Indexes ~/.<entity>/<corpus>/**/*.md into two in-memory collections:
//   Documents    — one record per markdown file, with parsed frontmatter + body_excerpt
//   DocumentRefs — one record per (source, ref_key, target_raw) reference tuple
//
// Publishes: documents.atlas (all Documents), documents.refs (all DocumentRefs)
// Gate: KOAD_IO_INDEX_DOCUMENTS env var
//
// Lifted from ~/.juno/drift/walker.js — same corpus, same ref extraction,
// same 4-pass resolution. No postgres, no psql, no business logic.

const fs   = Npm.require('fs');
const path = Npm.require('path');
const os   = Npm.require('os');

const HOME = process.env.HOME || os.homedir();

// ---------------------------------------------------------------------------
// Corpus classification — same order and shape as walker.js
// ---------------------------------------------------------------------------
const CORPUS = [
  { dir: 'briefs',       kind: 'brief' },
  { dir: 'memories',     kind: 'memory' },
  { dir: 'tickler',      kind: 'tickle' },
  { dir: 'posts',        kind: 'post' },
  { dir: 'assessments',  kind: 'assessment' },
  { dir: 'reviews',      kind: 'review' },
  { dir: 'reports',      kind: 'report' },
  { dir: 'heals',        kind: 'heal' },
  { dir: 'specs',        kind: 'spec' },
  { dir: 'horizons',     kind: 'horizon' },
  { dir: 'queues',       kind: 'queue' },
  { dir: 'control',      kind: 'control' },
  { dir: 'devices',      kind: 'device' },
  { dir: 'trust/bonds',  kind: 'bond' },
];

const TOPLEVEL = [
  { file: 'ENTITY.md', kind: 'identity' },
  { file: 'PRIMER.md', kind: 'primer' },
  { file: 'README.md', kind: 'readme' },
];

const EXCLUDE_DIRS = new Set([
  '.git', 'node_modules', '.meteor', '.npm', '.claude', '.opencode',
  'packages', 'dist', 'id', 'builds', '.trash', '.archive',
  'screenshots', 'projects',
]);

// Ref frontmatter keys — same as walker.js
const REF_KEYS = [
  'relates-to', 'related', 'related-to', 'see-also',
  'related-specs', 'depends-on', 'supersedes', 'superseded-by',
];

// Sentinel target values to skip
const SENTINELS = new Set(['—', 'null', 'none', '-', 'tbd', 'TBD', '']);

// ---------------------------------------------------------------------------
// Collections — connection: null → in-memory (daemon runs MONGO_URL=false)
// ---------------------------------------------------------------------------
const Documents    = new Mongo.Collection('Documents',    { connection: null });
const DocumentRefs = new Mongo.Collection('DocumentRefs', { connection: null });

if (!globalThis.indexerReady) globalThis.indexerReady = {};

// ---------------------------------------------------------------------------
// Frontmatter parser — lifted verbatim from walker.js
// ---------------------------------------------------------------------------
function parseFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { fm: {}, body: text };

  const fmText = m[1];
  const body   = m[2] || '';
  const fm     = {};

  let key = null;
  let arr = null;

  for (const line of fmText.split('\n')) {
    if (!line.trim()) continue;

    if (line.match(/^\s*-\s+/)) {
      if (arr === null) continue;
      arr.push(line.replace(/^\s*-\s+/, '').trim().replace(/^["']|["']$/g, ''));
      continue;
    }

    const km = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!km) continue;

    if (key !== null && arr !== null) {
      fm[key] = arr;
      arr = null;
    }

    key      = km[1];
    const val = km[2].trim();

    if (val === '') {
      arr = [];
      continue;
    }

    if (val.startsWith('[') && val.endsWith(']')) {
      fm[key] = val.slice(1, -1).split(',').map(s =>
        s.trim().replace(/^["']|["']$/g, '')
      ).filter(Boolean);
      key = null;
      continue;
    }

    fm[key] = val.replace(/^["']|["']$/g, '');
    key = null;
  }

  if (key !== null && arr !== null) fm[key] = arr;
  return { fm, body };
}

// ---------------------------------------------------------------------------
// Walk a directory for .md files, honoring EXCLUDE_DIRS
// ---------------------------------------------------------------------------
function walkMd(dir) {
  const out = [];
  function walk(d) {
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); }
    catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (EXCLUDE_DIRS.has(e.name)) continue;
        walk(p);
      } else if (e.isFile() && e.name.endsWith('.md')) {
        out.push(p);
      }
    }
  }
  walk(dir);
  return out;
}

// ---------------------------------------------------------------------------
// Build a Document record from a file path
// ---------------------------------------------------------------------------
function buildDoc(entity, entityDir, kind, fullPath) {
  let text;
  try { text = fs.readFileSync(fullPath, 'utf8'); }
  catch { return null; }

  const { fm, body }   = parseFrontmatter(text);
  let stat;
  try { stat = fs.statSync(fullPath); }
  catch { return null; }

  return {
    _id:          fullPath,
    entity,
    kind,
    filename:     path.basename(fullPath),
    rel_path:     path.relative(entityDir, fullPath),
    frontmatter:  fm,
    body_excerpt: body.slice(0, 500),
    word_count:   body.split(/\s+/).filter(Boolean).length,
    size_bytes:   stat.size,
    mtime:        stat.mtime,
    asof:         new Date(),
  };
}

// ---------------------------------------------------------------------------
// Upsert a Document record
// ---------------------------------------------------------------------------
function upsertDoc(doc) {
  if (!doc) return;
  const existing = Documents.findOne({ _id: doc._id });
  if (existing) {
    Documents.update(doc._id, { $set: doc });
  } else {
    Documents.insert(doc);
  }
}

// ---------------------------------------------------------------------------
// Index a single file (called on file-change events)
// ---------------------------------------------------------------------------
function indexFile(entity, entityDir, kind, fullPath) {
  const doc = buildDoc(entity, entityDir, kind, fullPath);
  if (doc) {
    upsertDoc(doc);
    // Re-extract refs for this source
    rebuildRefsForSource(fullPath, doc.frontmatter);
  } else {
    // File gone — remove it
    Documents.remove({ _id: fullPath });
    DocumentRefs.remove({ source_path: fullPath });
  }
}

// ---------------------------------------------------------------------------
// Extract refs from a single document's frontmatter
// ---------------------------------------------------------------------------
function extractRefsFromDoc(sourcePath, fm) {
  const refs = [];
  for (const key of REF_KEYS) {
    const v = fm[key];
    if (!v) continue;
    const items = Array.isArray(v) ? v : [v];
    for (const target of items) {
      if (!target || typeof target !== 'string') continue;
      const t = target.trim();
      if (!t) continue;
      refs.push({ source_path: sourcePath, ref_key: key, target_raw: t });
    }
  }
  return refs;
}

// ---------------------------------------------------------------------------
// Deterministic _id for a ref tuple
// ---------------------------------------------------------------------------
function refId(source_path, ref_key, target_raw) {
  // Simple stable hash: base36 of a polynomial hash of the joined string
  const s = source_path + '\0' + ref_key + '\0' + target_raw;
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
    h = h >>> 0;
  }
  return h.toString(36) + '_' + s.length.toString(36);
}

// ---------------------------------------------------------------------------
// Rebuild refs for a single source path
// ---------------------------------------------------------------------------
function rebuildRefsForSource(sourcePath, fm) {
  // Remove old refs for this source
  DocumentRefs.remove({ source_path: sourcePath });

  // Extract new refs
  const refs = extractRefsFromDoc(sourcePath, fm);
  for (const r of refs) {
    if (SENTINELS.has(r.target_raw)) continue;
    const id  = refId(r.source_path, r.ref_key, r.target_raw);
    const doc = {
      _id:         id,
      source_path: r.source_path,
      ref_key:     r.ref_key,
      target_raw:  r.target_raw,
      target_path: null,
      target_kind: null,
      resolved:    false,
      asof:        new Date(),
    };
    try { DocumentRefs.insert(doc); }
    catch (e) {
      // May already exist from a concurrent scan — update instead
      DocumentRefs.update(id, { $set: doc });
    }
  }
}

// ---------------------------------------------------------------------------
// 4-pass resolution — same logic as walker.js SQL passes, in JS
// ---------------------------------------------------------------------------
function resolveAllRefs() {
  const unresolved = DocumentRefs.find({ resolved: false }).fetch();
  if (!unresolved.length) return;

  for (const ref of unresolved) {
    const t = ref.target_raw;
    if (!t || SENTINELS.has(t)) continue;

    let found = null;

    // Pass 1: exact path match (handles ~/ prefix too)
    const expanded = t.replace(/^~\//, HOME + '/');
    found = Documents.findOne({
      $or: [
        { _id: t },
        { _id: expanded },
        { _id: t + '.md' },
        { _id: expanded + '.md' },
      ],
    });

    // Pass 2: filename / slug match
    if (!found) {
      found = Documents.findOne({
        $or: [
          { filename: t + '.md' },
          { filename: t },
        ],
      });
      // ilike fallback: check if any filename starts with t (case-insensitive)
      if (!found) {
        const tl = t.toLowerCase();
        found = Documents.findOne({
          filename: { $regex: new RegExp('^' + tl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
        });
      }
    }

    // Pass 3: SPEC-NNN pattern
    if (!found) {
      const specMatch = t.match(/^(VESTA|ROOTY|CACULA|LIVY|JUNO)-SPEC-([0-9]+)/i);
      if (specMatch) {
        const prefix = specMatch[0].toUpperCase();
        found = Documents.findOne({
          kind: 'spec',
          filename: { $regex: new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
        });
      }
    }

    // Pass 4: path-fragment match (loose)
    if (!found && t.length > 10) {
      const fragment = t.replace(/^~\//, '');
      // Search in _id (which is the full path)
      const all = Documents.find({}).fetch();
      for (const d of all) {
        if (d._id.includes(fragment)) {
          found = d;
          break;
        }
      }
    }

    if (found) {
      DocumentRefs.update(ref._id, {
        $set: {
          target_path: found._id,
          target_kind: found.kind,
          resolved:    true,
          asof:        new Date(),
        },
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Full scan of all entities
// ---------------------------------------------------------------------------
function fullScan() {
  const t0 = Date.now();
  console.log('[DOCUMENTS] Starting full scan...');

  const entities = EntityScanner.Entities.find().fetch();
  let docCount = 0;

  for (const entity of entities) {
    const eDir = entity.path;

    // Top-level identity files
    for (const tl of TOPLEVEL) {
      const f = path.join(eDir, tl.file);
      if (fs.existsSync(f)) {
        const doc = buildDoc(entity.handle, eDir, tl.kind, f);
        if (doc) { upsertDoc(doc); docCount++; }
      }
    }

    // Corpus dirs
    for (const c of CORPUS) {
      const cd = path.join(eDir, c.dir);
      if (!fs.existsSync(cd)) continue;
      const files = walkMd(cd);
      for (const f of files) {
        const doc = buildDoc(entity.handle, eDir, c.kind, f);
        if (doc) { upsertDoc(doc); docCount++; }
      }
    }
  }

  // Re-extract all refs from fresh Documents
  DocumentRefs.remove({});
  const allDocs = Documents.find({}).fetch();
  for (const doc of allDocs) {
    rebuildRefsForSource(doc._id, doc.frontmatter);
  }

  // Resolve refs
  resolveAllRefs();

  const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
  const refCount = DocumentRefs.find({ resolved: true }).count();
  console.log(`[DOCUMENTS] Scan complete: ${docCount} docs, ${DocumentRefs.find().count()} refs (${refCount} resolved) in ${elapsed}s`);

  globalThis.indexerReady.documents = new Date().toISOString();
}

// ---------------------------------------------------------------------------
// File-watching — debounce per entity dir
// ---------------------------------------------------------------------------
const _debounceTimers = new Map();
const _watchers       = new Map();

function debounce(key, fn, delay) {
  if (_debounceTimers.has(key)) {
    Meteor.clearTimeout(_debounceTimers.get(key));
  }
  _debounceTimers.set(key, Meteor.setTimeout(() => {
    _debounceTimers.delete(key);
    fn();
  }, delay));
}

// Given a changed file path, find its entity + kind and re-index it.
// Iterates EntityScanner.Entities to resolve entity ownership.
function reindexPath(changedPath) {
  if (!changedPath || !changedPath.endsWith('.md')) return;

  const entities = EntityScanner.Entities.find().fetch();
  for (const entity of entities) {
    const eDir = entity.path;
    if (!changedPath.startsWith(eDir + '/') && changedPath !== eDir) continue;

    // Determine kind
    let kind = null;

    // Check top-level
    for (const tl of TOPLEVEL) {
      if (changedPath === path.join(eDir, tl.file)) {
        kind = tl.kind;
        break;
      }
    }

    // Check corpus
    if (!kind) {
      for (const c of CORPUS) {
        const cd = path.join(eDir, c.dir);
        if (changedPath.startsWith(cd + '/')) {
          kind = c.kind;
          break;
        }
      }
    }

    if (kind) {
      indexFile(entity.handle, eDir, kind, changedPath);
      // Re-resolve all unresolved refs after a file change
      Meteor.setTimeout(resolveAllRefs, 200);
    }
    return;
  }
}

function watchEntityDir(entity) {
  const eDir = entity.path;
  if (_watchers.has(eDir)) return;

  try {
    const watcher = fs.watch(eDir, { recursive: true, persistent: false }, (event, filename) => {
      if (!filename || !filename.endsWith('.md')) return;
      const fullPath = path.join(eDir, filename);
      // Check not in excluded dir
      const parts = filename.split(path.sep);
      if (parts.some(p => EXCLUDE_DIRS.has(p))) return;

      debounce(fullPath, () => reindexPath(fullPath), 500);
    });
    _watchers.set(eDir, watcher);
  } catch (e) {
    // Some dirs may not support recursive watching on all platforms — silent.
  }
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
Meteor.startup(() => {
  const mode = process.env.KOAD_IO_INDEX_DOCUMENTS;
  if (!mode) return;

  // Run scan after 2s to let EntityScanner populate
  Meteor.setTimeout(() => {
    fullScan();

    // Set up file watchers for all known entity dirs
    const entities = EntityScanner.Entities.find().fetch();
    for (const entity of entities) {
      watchEntityDir(entity);
    }

    // Watch for newly-discovered entities
    EntityScanner.Entities.find().observeChanges({
      added: (_id, fields) => {
        const eDir = path.join(HOME, fields.folder || ('.' + fields.handle));
        watchEntityDir({ handle: fields.handle, path: eDir });
      },
    });
  }, 2000);
});

// ---------------------------------------------------------------------------
// DDP publications
// ---------------------------------------------------------------------------
Meteor.publish('documents.atlas', function () {
  return Documents.find();
});

Meteor.publish('documents.refs', function () {
  return DocumentRefs.find();
});
