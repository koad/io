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
const fsp  = fs.promises;

const HOME = process.env.HOME || os.homedir();
const STARTUP_SCAN_BATCH_SIZE = 10;
const STARTUP_SCAN_DELAY_MS = 15000;
const REF_BATCH_SIZE = 100;
const WALK_YIELD_EVERY = 25;

function yieldToEventLoop() {
  return new Promise(resolve => Meteor.setTimeout(resolve, 0));
}

async function pathExists(targetPath) {
  try {
    await fsp.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

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
async function walkMd(dir) {
  const out = [];
  const queue = [dir];
  let walked = 0;

  while (queue.length) {
    const current = queue.shift();
    let ents;
    try {
      ents = await fsp.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const e of ents) {
      const p = path.join(current, e.name);
      if (e.isDirectory()) {
        if (EXCLUDE_DIRS.has(e.name)) continue;
        queue.push(p);
      } else if (e.isFile() && e.name.endsWith('.md')) {
        out.push(p);
      }
    }

    walked++;
    if (walked % WALK_YIELD_EVERY === 0) {
      await yieldToEventLoop();
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Build a Document record from a file path
// ---------------------------------------------------------------------------
async function buildDoc(entity, entityDir, kind, fullPath) {
  let text;
  try { text = await fsp.readFile(fullPath, 'utf8'); }
  catch { return null; }

  const { fm, body }   = parseFrontmatter(text);
  let stat;
  try { stat = await fsp.stat(fullPath); }
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
async function indexFile(entity, entityDir, kind, fullPath) {
  const doc = await buildDoc(entity, entityDir, kind, fullPath);
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
async function resolveAllRefs() {
  const unresolved = DocumentRefs.find({ resolved: false }).fetch();
  if (!unresolved.length) return;

  for (let i = 0; i < unresolved.length; i += REF_BATCH_SIZE) {
    const batch = unresolved.slice(i, i + REF_BATCH_SIZE);

    for (const ref of batch) {
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

    await yieldToEventLoop();
  }
}

// ---------------------------------------------------------------------------
// Full scan of all entities
// ---------------------------------------------------------------------------
async function fullScan() {
  const t0 = Date.now();
  console.log('[DOCUMENTS] Starting full scan...');

  const entities = EntityScanner.Entities.find().fetch();
  const scanTargets = [];

  for (const entity of entities) {
    const entityDir = entity.path;

    // Top-level identity files
    for (const tl of TOPLEVEL) {
      const fullPath = path.join(entityDir, tl.file);
      if (await pathExists(fullPath)) {
        scanTargets.push({
          entity: entity.handle,
          entityDir,
          kind: tl.kind,
          fullPath,
        });
      }
    }

    // Corpus dirs
    for (const c of CORPUS) {
      const corpusDir = path.join(entityDir, c.dir);
      if (!await pathExists(corpusDir)) continue;
      const files = await walkMd(corpusDir);
      for (const fullPath of files) {
        scanTargets.push({
          entity: entity.handle,
          entityDir,
          kind: c.kind,
          fullPath,
        });
      }
      await yieldToEventLoop();
    }
  }

  console.log(`[DOCUMENTS] Discovered ${scanTargets.length} markdown files — indexing in background...`);

  let docCount = 0;
  for (let i = 0; i < scanTargets.length; i += STARTUP_SCAN_BATCH_SIZE) {
    const batch = scanTargets.slice(i, i + STARTUP_SCAN_BATCH_SIZE);
    const docs = await Promise.all(batch.map(target =>
      buildDoc(target.entity, target.entityDir, target.kind, target.fullPath)
    ));

    for (const doc of docs) {
      if (!doc) continue;
      upsertDoc(doc);
      docCount++;
    }

    await yieldToEventLoop();
  }

  // Re-extract all refs from fresh Documents
  DocumentRefs.remove({});
  const allDocs = Documents.find({}).fetch();
  for (let i = 0; i < allDocs.length; i += REF_BATCH_SIZE) {
    const batch = allDocs.slice(i, i + REF_BATCH_SIZE);
    for (const doc of batch) {
      rebuildRefsForSource(doc._id, doc.frontmatter);
    }
    await yieldToEventLoop();
  }

  // Resolve refs
  await resolveAllRefs();

  const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
  const refCount = DocumentRefs.find({ resolved: true }).count();
  console.log(`[DOCUMENTS] Scan complete: ${docCount} docs, ${DocumentRefs.find().count()} refs (${refCount} resolved) in ${elapsed}s`);

  globalThis.indexerReady.documents = new Date().toISOString();
  koad.ready.signal('documents');
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
async function reindexPath(changedPath) {
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
      await indexFile(entity.handle, eDir, kind, changedPath);
      // Re-resolve all unresolved refs after a file change
      Meteor.setTimeout(() => {
        resolveAllRefs().catch(e => {
          console.error('[DOCUMENTS] Ref resolution failed:', e && e.stack ? e.stack : e);
        });
      }, 200);
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

      debounce(fullPath, () => {
        reindexPath(fullPath).catch(e => {
          console.error('[DOCUMENTS] Incremental index failed:', e && e.stack ? e.stack : e);
        });
      }, 500);
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
  koad.ready.register('documents');
  const mode = process.env.KOAD_IO_INDEX_DOCUMENTS;
  if (!mode) {
    koad.ready.signal('documents');
    return;
  }

  // Delay the startup backfill long enough for Meteor to finish bringing the
  // HTTP surface up cleanly. Watchers come up first so fresh edits still index
  // immediately while the bulk backfill waits its turn.
  Meteor.setTimeout(() => {
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

    fullScan().catch(e => {
      console.error('[DOCUMENTS] Full scan failed:', e && e.stack ? e.stack : e);
      koad.ready.signal('documents');
    });
  }, STARTUP_SCAN_DELAY_MS);
});

// ---------------------------------------------------------------------------
// DDP publications
// ---------------------------------------------------------------------------
Meteor.publish('documents.atlas', async function () {
  await koad.ready.await('documents');
  return Documents.find();
});

Meteor.publish('documents.refs', async function () {
  await koad.ready.await('documents');
  return DocumentRefs.find();
});
