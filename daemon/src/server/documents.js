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
const { WebApp } = require('meteor/webapp');

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
  { dir: 'offerings',    kind: 'offering' },
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
    body:         kind === 'offering' ? body : undefined,
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
// File-watching — targeted corpus watchers instead of whole-entity recursion
// ---------------------------------------------------------------------------
const _debounceTimers     = new Map();
const _planRefreshTimers  = new Map();
const _entityWatchPlans   = new Map(); // handle -> { path, rootWatcher, structureWatchers, corpusWatchers }
const _entityIdsToHandles = new Map();
const ROOT_CORPUS_SEGMENTS = new Set(CORPUS.map(c => c.dir.split('/')[0]));

function debounce(key, fn, delay) {
  if (_debounceTimers.has(key)) {
    Meteor.clearTimeout(_debounceTimers.get(key));
  }
  _debounceTimers.set(key, Meteor.setTimeout(() => {
    _debounceTimers.delete(key);
    fn();
  }, delay));
}

function closeWatcher(watcher) {
  if (!watcher) return;
  try { watcher.close(); } catch (e) {}
}

function normalizeWatchFilename(filename) {
  if (!filename) return null;
  return String(filename).split(path.sep).join('/');
}

function existingStructureWatchDirs(entityDir) {
  const dirs = new Set();
  for (const c of CORPUS) {
    const parts = c.dir.split('/');
    if (parts.length < 2) continue;

    let current = entityDir;
    for (let i = 0; i < parts.length - 1; i++) {
      current = path.join(current, parts[i]);
      try {
        if (fs.statSync(current).isDirectory()) dirs.add(current);
      } catch (e) {
        break;
      }
    }
  }
  return dirs;
}

function existingCorpusWatchDirs(entityDir) {
  const dirs = new Set();
  for (const c of CORPUS) {
    const fullPath = path.join(entityDir, c.dir);
    try {
      if (fs.statSync(fullPath).isDirectory()) dirs.add(fullPath);
    } catch (e) {}
  }
  return dirs;
}

function clearEntityWatchPlan(handle) {
  const plan = _entityWatchPlans.get(handle);
  if (!plan) return;

  closeWatcher(plan.rootWatcher);
  for (const watcher of plan.structureWatchers.values()) closeWatcher(watcher);
  for (const watcher of plan.corpusWatchers.values()) closeWatcher(watcher);
  _entityWatchPlans.delete(handle);

  if (_planRefreshTimers.has(handle)) {
    Meteor.clearTimeout(_planRefreshTimers.get(handle));
    _planRefreshTimers.delete(handle);
  }
}

function scheduleEntityPlanRefresh(entity, delay = 250) {
  const handle = entity && entity.handle;
  if (!handle) return;

  if (_planRefreshTimers.has(handle)) {
    Meteor.clearTimeout(_planRefreshTimers.get(handle));
  }

  _planRefreshTimers.set(handle, Meteor.setTimeout(() => {
    _planRefreshTimers.delete(handle);
    watchEntityDir(entity);
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
  const handle = entity && entity.handle;
  const eDir = entity && entity.path;
  if (!handle || !eDir) return;

  let plan = _entityWatchPlans.get(handle);
  if (plan && plan.path !== eDir) {
    clearEntityWatchPlan(handle);
    plan = null;
  }

  if (!plan) {
    plan = {
      path: eDir,
      rootWatcher: null,
      structureWatchers: new Map(),
      corpusWatchers: new Map(),
    };
    _entityWatchPlans.set(handle, plan);
  }

  if (!plan.rootWatcher) {
    try {
      const watcher = fs.watch(eDir, { persistent: false }, (_event, filename) => {
        const rel = normalizeWatchFilename(filename);
        if (!rel) return;

        if (TOPLEVEL.some(tl => rel === tl.file)) {
          const fullPath = path.join(eDir, rel);
          debounce(fullPath, () => {
            reindexPath(fullPath).catch(e => {
              console.error('[DOCUMENTS] Incremental index failed:', e && e.stack ? e.stack : e);
            });
          }, 500);
          return;
        }

        if (ROOT_CORPUS_SEGMENTS.has(rel)) {
          scheduleEntityPlanRefresh({ handle, path: eDir });
        }
      });

      watcher.on('error', () => {
        closeWatcher(watcher);
        plan.rootWatcher = null;
        scheduleEntityPlanRefresh({ handle, path: eDir });
      });

      plan.rootWatcher = watcher;
    } catch (e) {
      // Entity dir may be transiently unavailable — refresh will retry later.
    }
  }

  const desiredStructureDirs = existingStructureWatchDirs(eDir);
  for (const [watchDir, watcher] of Array.from(plan.structureWatchers.entries())) {
    if (!desiredStructureDirs.has(watchDir)) {
      closeWatcher(watcher);
      plan.structureWatchers.delete(watchDir);
    }
  }
  for (const watchDir of desiredStructureDirs) {
    if (plan.structureWatchers.has(watchDir)) continue;
    try {
      const watcher = fs.watch(watchDir, { persistent: false }, () => {
        scheduleEntityPlanRefresh({ handle, path: eDir });
      });
      watcher.on('error', () => {
        closeWatcher(watcher);
        plan.structureWatchers.delete(watchDir);
        scheduleEntityPlanRefresh({ handle, path: eDir });
      });
      plan.structureWatchers.set(watchDir, watcher);
    } catch (e) {}
  }

  const desiredCorpusDirs = existingCorpusWatchDirs(eDir);
  for (const [watchDir, watcher] of Array.from(plan.corpusWatchers.entries())) {
    if (!desiredCorpusDirs.has(watchDir)) {
      closeWatcher(watcher);
      plan.corpusWatchers.delete(watchDir);
    }
  }
  for (const watchDir of desiredCorpusDirs) {
    if (plan.corpusWatchers.has(watchDir)) continue;
    try {
      const watcher = fs.watch(watchDir, { recursive: true, persistent: false }, (_event, filename) => {
        const rel = normalizeWatchFilename(filename);
        if (!rel || !rel.endsWith('.md')) return;

        const parts = rel.split('/');
        if (parts.some(p => EXCLUDE_DIRS.has(p))) return;

        const fullPath = path.join(watchDir, rel);
        debounce(fullPath, () => {
          reindexPath(fullPath).catch(e => {
            console.error('[DOCUMENTS] Incremental index failed:', e && e.stack ? e.stack : e);
          });
        }, 500);
      });

      watcher.on('error', () => {
        closeWatcher(watcher);
        plan.corpusWatchers.delete(watchDir);
        scheduleEntityPlanRefresh({ handle, path: eDir });
      });

      plan.corpusWatchers.set(watchDir, watcher);
    } catch (e) {
      // Some dirs may not support recursive watching on all platforms — silent.
    }
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
      _entityIdsToHandles.set(entity._id, entity.handle);
      watchEntityDir(entity);
    }

    // Watch for entity roster changes so watch plans stay in sync.
    EntityScanner.Entities.find().observeChanges({
      added: (_id, fields) => {
        if (!fields.handle) return;
        _entityIdsToHandles.set(_id, fields.handle);
        const eDir = path.join(HOME, fields.folder || ('.' + fields.handle));
        watchEntityDir({ handle: fields.handle, path: eDir });
      },
      changed: (_id, fields) => {
        const handle = fields.handle || _entityIdsToHandles.get(_id);
        if (!handle) return;
        if (fields.handle) _entityIdsToHandles.set(_id, fields.handle);
        const entity = EntityScanner.Entities.findOne(_id) || EntityScanner.Entities.findOne({ handle });
        if (entity) watchEntityDir(entity);
      },
      removed: (_id) => {
        const handle = _entityIdsToHandles.get(_id);
        if (!handle) return;
        clearEntityWatchPlan(handle);
        _entityIdsToHandles.delete(_id);
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

function normalizeOfferingStatus(status) {
  if (typeof status !== 'string' || !status.trim()) return 'active';
  return status.trim().toLowerCase();
}

function projectOffering(doc) {
  if (!doc || doc.kind !== 'offering') return null;
  const fm = doc.frontmatter || {};
  const slug = (doc.filename || '').replace(/\.md$/i, '') || path.basename(doc._id || '', '.md');
  const priceRaw = fm.price;
  const priceNum = typeof priceRaw === 'number' ? priceRaw : Number(priceRaw);
  const price = Number.isFinite(priceNum) ? priceNum : priceRaw;
  return {
    _id: doc._id,
    entity: doc.entity,
    slug,
    path: doc._id,
    rel_path: doc.rel_path,
    title: fm.title || slug || '(untitled offering)',
    description: fm.description || doc.body_excerpt || '',
    price,
    currency: fm.currency || 'USD',
    duration: fm.duration || '',
    category: fm.category || '',
    status: normalizeOfferingStatus(fm.status),
    tags: Array.isArray(fm.tags) ? fm.tags : (fm.tags ? [fm.tags] : []),
    body: doc.body || '',
    mtime: doc.mtime,
    asof: doc.asof,
  };
}

function omitId(doc) {
  const shaped = { ...(doc || {}) };
  delete shaped._id;
  return shaped;
}

function publishProjectedCursor(sub, collectionName, cursor, projector) {
  return cursor.observe({
    added(doc) {
      const shaped = projector(doc);
      if (!shaped || !shaped._id) return;
      sub.added(collectionName, shaped._id, omitId(shaped));
    },
    changed(newDoc) {
      const shaped = projector(newDoc);
      if (!shaped || !shaped._id) return;
      sub.changed(collectionName, shaped._id, omitId(shaped));
    },
    removed(oldDoc) {
      if (!oldDoc || !oldDoc._id) return;
      sub.removed(collectionName, oldDoc._id);
    },
  });
}

Meteor.publish('offerings.all', async function () {
  await koad.ready.await('documents');
  const sub = this;
  const handle = publishProjectedCursor(sub, 'Offerings', Documents.find({ kind: 'offering' }), projectOffering);
  sub.ready();
  sub.onStop(() => handle.stop());
});

Meteor.publish('offerings.entity', async function (entity, statusArg) {
  check(entity, String);
  check(statusArg, Match.Optional(String));
  await koad.ready.await('documents');
  const selector = {
    kind: 'offering',
    entity: entity.toLowerCase(),
  };
  if (statusArg) {
    const normalizedStatus = normalizeOfferingStatus(statusArg);
    if (normalizedStatus === 'active') {
      selector.$or = [
        { 'frontmatter.status': 'active' },
        { 'frontmatter.status': { $exists: false } },
        { 'frontmatter.status': '' },
      ];
    } else {
      selector['frontmatter.status'] = normalizedStatus;
    }
  }
  const sub = this;
  const handle = publishProjectedCursor(sub, 'Offerings', Documents.find(selector), projectOffering);
  sub.ready();
  sub.onStop(() => handle.stop());
});

const offeringsApi = WebApp.connectHandlers;

offeringsApi.use('/api/offerings', async (req, res, next) => {
  if (req.method !== 'GET') return next();
  try {
    await koad.ready.await('documents');
    const url = new URL(req.url, 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean);
    const entity = parts.length > 0 ? parts[0].toLowerCase() : (url.searchParams.get('entity') || '').toLowerCase();
    const status = normalizeOfferingStatus(url.searchParams.get('status') || 'active');
    const selector = { kind: 'offering' };
    if (entity) selector.entity = entity;
    if (status === 'active') {
      selector.$or = [
        { 'frontmatter.status': 'active' },
        { 'frontmatter.status': { $exists: false } },
        { 'frontmatter.status': '' },
      ];
    } else if (status) {
      selector['frontmatter.status'] = status;
    }
    const docs = Documents.find(selector, { sort: { mtime: -1 } }).fetch()
      .map(projectOffering)
      .filter(Boolean);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, count: docs.length, offerings: docs }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: err && err.message ? err.message : String(err) }));
  }
});

// ---------------------------------------------------------------------------
// atlas.snapshot — single-shot corpus delivery for fast initial load.
//
// Returns the full corpus as a single JSON array. Server caches the result
// with a 60-second TTL keyed on document/ref counts. Browser inserts into
// local Mongo.Collections directly, then the live subscriptions above catch
// incremental updates.
// ---------------------------------------------------------------------------
let _snapshotCache = null;
const SNAPSHOT_TTL_MS = 60 * 1000;

function _buildAtlasSnapshot() {
  const docs = Documents.find({}, {
    fields: { entity: 1, kind: 1, filename: 1, frontmatter: 1, mtime: 1, word_count: 1 },
  }).fetch();
  const refs = DocumentRefs.find({ resolved: true }, {
    fields: { source_path: 1, target_path: 1, ref_key: 1, source_entity: 1, target_entity: 1, resolved: 1 },
  }).fetch();
  const fingerprint = docs.length + ':' + refs.length;
  return { fingerprint, builtAt: Date.now(), payload: { documents: docs, refs: refs } };
}

Meteor.methods({
  'atlas.snapshot'() {
    const now = Date.now();
    const docCount = Documents.find().count();
    const refCount = DocumentRefs.find({ resolved: true }).count();
    const currentFingerprint = docCount + ':' + refCount;
    if (_snapshotCache &&
        _snapshotCache.fingerprint === currentFingerprint &&
        (now - _snapshotCache.builtAt) < SNAPSHOT_TTL_MS) {
      return Object.assign({ cached: true }, _snapshotCache.payload, { fingerprint: _snapshotCache.fingerprint });
    }
    _snapshotCache = _buildAtlasSnapshot();
    return Object.assign({ cached: false }, _snapshotCache.payload, { fingerprint: _snapshotCache.fingerprint });
  },
});
