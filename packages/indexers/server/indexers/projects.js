// Projects indexer — VESTA-SPEC-192
// Watches ~/.koad-io/me/projects/*.md — one file per project.
// Indexes into in-memory Projects collection; exposes derived flight count.
//
// Gate: KOAD_IO_INDEX_PROJECTS env var (any truthy value activates)
// Collection: Projects (globalThis.ProjectsCollection)
// DDP publication: projects.all
//
// Derived fields per document:
//   activeFlightCount — count of open Flights with project: <this slug>
//
// Goal linkage: each project doc carries goal: <slug> from frontmatter.
// The indexer does NOT validate that the goal slug resolves; stale refs
// are surfaced via _unresolvedGoal flag (SPEC-192 §6.4 pattern).

const fs       = Npm.require('fs');
const path     = Npm.require('path');
const os       = Npm.require('os');

const HOME         = process.env.HOME || os.homedir();
const PROJECTS_DIR = path.join(HOME, '.koad-io', 'me', 'projects');

// ---------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------
const Projects = new Mongo.Collection('Projects', { connection: null });
globalThis.ProjectsCollection = Projects;

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
// Build a Project document from a .md file
// ---------------------------------------------------------------------------
function buildProject(filePath) {
  let text;
  try { text = fs.readFileSync(filePath, 'utf8'); }
  catch { return null; }

  const slug = path.basename(filePath, '.md');
  const { fm, body } = parseFrontmatter(text);

  const missing = [];
  for (const f of ['name', 'title', 'status', 'created']) {
    if (!fm[f]) missing.push(f);
  }

  let owner = fm.owner || [];
  if (typeof owner === 'string') owner = [owner];

  let tags = fm.tags || [];
  if (typeof tags === 'string') tags = [tags];

  const goalSlug = fm.goal || null;

  // Validate goal reference — flag if unresolved (non-blocking, per SPEC §6.4)
  let unresolvedGoal = false;
  if (goalSlug) {
    const Goals = globalThis.GoalsCollection;
    if (Goals && !Goals.findOne(goalSlug)) {
      unresolvedGoal = true;
    }
  }

  return {
    _id:          slug,
    slug,
    name:         fm.name     || slug,
    title:        fm.title    || slug,
    status:       fm.status   || 'discovery',
    goal:         goalSlug,
    priority:     fm.priority || 'normal',
    created:      fm.created  || null,
    updated:      fm.updated  || null,
    owner,
    tags,
    target:       fm.target      || null,
    relatesTo:    fm['relates-to'] ? (Array.isArray(fm['relates-to']) ? fm['relates-to'] : [fm['relates-to']]) : [],
    supersedes:   fm.supersedes   || null,
    blockedBy:    fm['blocked-by'] ? (Array.isArray(fm['blocked-by']) ? fm['blocked-by'] : [fm['blocked-by']]) : [],
    // Derived — recomputed on each upsert
    activeFlightCount: 0,
    // Meta
    _missing:         missing.length ? missing : null,
    _unresolvedGoal:  unresolvedGoal,
    _filePath:        filePath,
    _asof:            new Date(),
  };
}

// ---------------------------------------------------------------------------
// Recompute derived counts for a single project slug
// ---------------------------------------------------------------------------
function recomputeDerived(slug) {
  const Flights = globalThis.FlightsCollection;
  const activeFlightCount = Flights
    ? Flights.find({ project: slug, status: 'flying' }).count()
    : 0;

  Projects.update(slug, { $set: { activeFlightCount } });

  // Also update parent goal's derived counts if we can
  const proj = Projects.findOne(slug);
  if (proj && proj.goal) {
    const Goals = globalThis.GoalsCollection;
    if (Goals) {
      const goalSlug = proj.goal;
      const projectCount = Projects.find({ goal: goalSlug }).count();
      Goals.update(goalSlug, { $set: { projectCount } });
    }
  }
}

// ---------------------------------------------------------------------------
// Upsert a project from a file path
// ---------------------------------------------------------------------------
function indexProjectFile(filePath) {
  const doc = buildProject(filePath);
  if (!doc) {
    const slug = path.basename(filePath, '.md');
    Projects.remove(slug);
    return;
  }
  const existing = Projects.findOne(doc._id);
  if (existing) {
    Projects.update(doc._id, { $set: doc });
  } else {
    Projects.insert(doc);
  }
  recomputeDerived(doc.slug);
}

// ---------------------------------------------------------------------------
// Remove a project record when file is deleted
// ---------------------------------------------------------------------------
function removeProjectFile(filePath) {
  const slug = path.basename(filePath, '.md');
  const proj = Projects.findOne(slug);
  Projects.remove(slug);
  // Update parent goal counts
  if (proj && proj.goal) {
    const Goals = globalThis.GoalsCollection;
    if (Goals) {
      const goalSlug = proj.goal;
      const projectCount = Projects.find({ goal: goalSlug }).count();
      Goals.update(goalSlug, { $set: { projectCount } });
    }
  }
}

// ---------------------------------------------------------------------------
// Full scan of projects dir
// ---------------------------------------------------------------------------
function fullScan() {
  console.log('[PROJECTS] Starting scan of', PROJECTS_DIR);
  let files;
  try {
    files = fs.readdirSync(PROJECTS_DIR).filter(f => f.endsWith('.md') && f !== 'PRIMER.md' && !f.startsWith('README'));
  } catch (e) {
    console.log('[PROJECTS] projects dir does not exist or is unreadable:', e.message);
    globalThis.indexerReady.projects = new Date().toISOString();
    koad.ready.signal('projects');
    return;
  }

  // Remove projects that no longer have a file
  const existingSlugs = Projects.find({}, { fields: { _id: 1 } }).map(p => p._id);
  const currentSlugs  = new Set(files.map(f => path.basename(f, '.md')));
  for (const slug of existingSlugs) {
    if (!currentSlugs.has(slug)) Projects.remove(slug);
  }

  for (const file of files) {
    indexProjectFile(path.join(PROJECTS_DIR, file));
  }

  console.log(`[PROJECTS] Scan complete: ${Projects.find().count()} projects`);
  globalThis.indexerReady.projects = new Date().toISOString();
  koad.ready.signal('projects');
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
    _watcher = fs.watch(PROJECTS_DIR, { persistent: false }, (event, filename) => {
      if (!filename || !filename.endsWith('.md')) return;
      if (filename === 'PRIMER.md' || filename.startsWith('README')) return;
      const fullPath = path.join(PROJECTS_DIR, filename);
      debounce(fullPath, () => {
        try {
          fs.accessSync(fullPath);
          indexProjectFile(fullPath);
        } catch {
          removeProjectFile(fullPath);
        }
      }, 300);
    });
  } catch (e) {
    console.log('[PROJECTS] watcher failed:', e.message);
  }
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
Meteor.startup(() => {
  koad.ready.register('projects');
  const mode = process.env.KOAD_IO_INDEX_PROJECTS;
  if (!mode) {
    koad.ready.signal('projects');
    return;
  }

  // Run after 2.5s so EntityScanner is populated; goals indexer gets 3s
  Meteor.setTimeout(() => {
    fullScan();
    startWatcher();
  }, 2500);
});

// ---------------------------------------------------------------------------
// DDP publications
// ---------------------------------------------------------------------------
Meteor.publish('projects.all', async function () {
  await koad.ready.await('projects');
  return Projects.find();
});
