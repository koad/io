// Goals indexer — VESTA-SPEC-192
// Watches ~/.koad-io/me/goals/*.md — one file per goal.
// Indexes into in-memory Goals collection; exposes derived counts.
//
// Gate: KOAD_IO_INDEX_GOALS env var (any truthy value activates)
// Collection: Goals (globalThis.GoalsCollection)
// DDP publication: goals.all
//
// Derived fields per document:
//   projectCount      — count of Projects with goal: <this slug>
//   activeFlightCount — count of open Flights with goal: <this slug>
//
// Stale-reference handling: invalid slugs in frontmatter are indexed as-is;
// the validator is the query layer, not the indexer.

const fs   = Npm.require('fs');
const path = Npm.require('path');
const os   = Npm.require('os');

const HOME      = process.env.HOME || os.homedir();
const GOALS_DIR = path.join(HOME, '.koad-io', 'me', 'goals');

// ---------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------
const Goals = new Mongo.Collection('Goals', { connection: null });
globalThis.GoalsCollection = Goals;

if (!globalThis.indexerReady) globalThis.indexerReady = {};

// ---------------------------------------------------------------------------
// Frontmatter parser — same mini-parser used across all md-based indexers
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

    key       = km[1];
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
// Build a Goal document from a .md file
// ---------------------------------------------------------------------------
function buildGoal(filePath) {
  let text;
  try { text = fs.readFileSync(filePath, 'utf8'); }
  catch { return null; }

  const slug = path.basename(filePath, '.md');
  const { fm, body } = parseFrontmatter(text);

  // Validate required fields — index regardless, mark invalid for callers
  const missing = [];
  for (const f of ['name', 'title', 'status', 'horizon', 'created']) {
    if (!fm[f]) missing.push(f);
  }

  // Normalize owner to array
  let owner = fm.owner || [];
  if (typeof owner === 'string') owner = [owner];

  // Normalize tags to array
  let tags = fm.tags || [];
  if (typeof tags === 'string') tags = [tags];

  return {
    _id:         slug,
    slug,
    name:        fm.name  || slug,
    title:       fm.title || slug,
    status:      fm.status || 'active',
    horizon:     fm.horizon || null,
    created:     fm.created || null,
    updated:     fm.updated || null,
    owner,
    tags,
    target:      fm.target      || null,
    relatesTo:   fm['relates-to'] ? (Array.isArray(fm['relates-to']) ? fm['relates-to'] : [fm['relates-to']]) : [],
    supersedes:  fm.supersedes  || null,
    notes:       fm.notes       || null,
    // Derived — recomputed on each upsert
    projectCount:      0,
    activeFlightCount: 0,
    // Meta
    _missing:    missing.length ? missing : null,
    _filePath:   filePath,
    _asof:       new Date(),
  };
}

// ---------------------------------------------------------------------------
// Recompute derived counts for a single goal slug
// ---------------------------------------------------------------------------
function recomputeDerived(slug) {
  // Project count: how many Projects link to this goal
  const Projects = globalThis.ProjectsCollection;
  const projectCount = Projects ? Projects.find({ goal: slug }).count() : 0;

  // Active flight count: open Flights with goal: <slug> (direct or via project)
  const Flights = globalThis.FlightsCollection;
  let activeFlightCount = 0;
  if (Flights) {
    activeFlightCount = Flights.find({
      $or: [
        { goal: slug, status: 'flying' },
        // Derived via project — check any project with this goal
        ...(Projects ? (() => {
          const projectSlugs = Projects.find({ goal: slug }).map(p => p.slug);
          return projectSlugs.length ? [{ project: { $in: projectSlugs }, status: 'flying' }] : [];
        })() : []),
      ],
    }).count();
  }

  Goals.update(slug, { $set: { projectCount, activeFlightCount } });
}

// ---------------------------------------------------------------------------
// Upsert a goal from a file path
// ---------------------------------------------------------------------------
function indexGoalFile(filePath) {
  const doc = buildGoal(filePath);
  if (!doc) {
    // File unreadable or gone
    const slug = path.basename(filePath, '.md');
    Goals.remove(slug);
    return;
  }
  const existing = Goals.findOne(doc._id);
  if (existing) {
    Goals.update(doc._id, { $set: doc });
  } else {
    Goals.insert(doc);
  }
  // Recompute derived after upsert
  recomputeDerived(doc.slug);
}

// ---------------------------------------------------------------------------
// Remove a goal record when file is deleted
// ---------------------------------------------------------------------------
function removeGoalFile(filePath) {
  const slug = path.basename(filePath, '.md');
  Goals.remove(slug);
}

// ---------------------------------------------------------------------------
// Full scan of goals dir
// ---------------------------------------------------------------------------
function fullScan() {
  console.log('[GOALS] Starting scan of', GOALS_DIR);
  let files;
  try {
    files = fs.readdirSync(GOALS_DIR).filter(f => f.endsWith('.md'));
  } catch (e) {
    console.log('[GOALS] goals dir does not exist or is unreadable:', e.message);
    globalThis.indexerReady.goals = new Date().toISOString();
    koad.ready.signal('goals');
    return;
  }

  // Remove goals that no longer have a file
  const existingSlugs = Goals.find({}, { fields: { _id: 1 } }).map(g => g._id);
  const currentSlugs  = new Set(files.map(f => path.basename(f, '.md')));
  for (const slug of existingSlugs) {
    if (!currentSlugs.has(slug)) Goals.remove(slug);
  }

  for (const file of files) {
    indexGoalFile(path.join(GOALS_DIR, file));
  }

  console.log(`[GOALS] Scan complete: ${Goals.find().count()} goals`);
  globalThis.indexerReady.goals = new Date().toISOString();
  koad.ready.signal('goals');
}

// ---------------------------------------------------------------------------
// File watcher — 300ms debounce
// ---------------------------------------------------------------------------
let _watcher    = null;
const _debounce = new Map();

function debounce(key, fn, delay) {
  if (_debounce.has(key)) Meteor.clearTimeout(_debounce.get(key));
  _debounce.set(key, Meteor.setTimeout(() => {
    _debounce.delete(key);
    fn();
  }, delay));
}

function startWatcher() {
  if (_watcher) return;
  try {
    _watcher = fs.watch(GOALS_DIR, { persistent: false }, (event, filename) => {
      if (!filename || !filename.endsWith('.md')) return;
      const fullPath = path.join(GOALS_DIR, filename);
      debounce(fullPath, () => {
        try {
          fs.accessSync(fullPath);
          indexGoalFile(fullPath);
        } catch {
          removeGoalFile(fullPath);
        }
      }, 300);
    });
  } catch (e) {
    console.log('[GOALS] watcher failed (dir may not exist):', e.message);
  }
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
Meteor.startup(() => {
  koad.ready.register('goals');
  const mode = process.env.KOAD_IO_INDEX_GOALS;
  if (!mode) {
    koad.ready.signal('goals');
    return;
  }

  // Scan after 3s to let Projects collection (if active) also be populated
  Meteor.setTimeout(() => {
    fullScan();
    startWatcher();
  }, 3000);
});

// ---------------------------------------------------------------------------
// DDP publications
// ---------------------------------------------------------------------------
Meteor.publish('goals.all', async function () {
  await koad.ready.await('goals');
  return Goals.find();
});
