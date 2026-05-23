// Goals and Projects REST API — VESTA-SPEC-192
//
// GET /api/goals                       — all goals (active by default)
// GET /api/goals?status=all            — include complete/archived
// GET /api/goals?status=active         — active only (default)
// GET /api/goals?horizon=30k           — filter by GTD horizon
//
// GET /api/projects                    — all projects (active+discovery by default)
// GET /api/projects?status=all         — include complete/archived
// GET /api/projects?status=active      — active only
// GET /api/projects?goal=<slug>        — filter by goal slug
//
// GET /api/projects/:slug/flights      — flights linked to a project (direct)
//   ?status=flying                     — open only
//   ?limit=50                          — default 50, max 500
//
// Flight query extension (via existing /api/flights):
//   GET /api/flights?project=<slug>    — handled here by extending the
//   GET /api/flights?goal=<slug>         existing /api/flights middleware
//
// Note: /api/flights?project= and /api/flights?goal= filtering is added at the
// bottom of this file as an additional middleware that intercepts those params
// BEFORE the generic /api/flights handler in api.js fires. We register on a
// separate use() call so the ordering is explicit.

import { WebApp } from 'meteor/webapp';

const os  = Npm.require('os');
const app = WebApp.connectHandlers;

// ---------------------------------------------------------------------------
// Shared helpers (mirrors pattern in api.js)
// ---------------------------------------------------------------------------

function parseQuery(url) {
  const q   = {};
  const qi  = (url || '').indexOf('?');
  if (qi === -1) return q;
  for (const pair of url.slice(qi + 1).split('&')) {
    const eqi = pair.indexOf('=');
    if (eqi === -1) continue;
    const k = decodeURIComponent(pair.slice(0, eqi));
    const v = decodeURIComponent(pair.slice(eqi + 1));
    q[k] = v;
  }
  return q;
}

function pathIs(req, target) {
  const url  = req.originalUrl || req.url || '';
  const i    = url.indexOf('?');
  const p    = i === -1 ? url : url.slice(0, i);
  return p === target || p === target + '/';
}

function pathStartsWith(req, prefix) {
  const url = req.originalUrl || req.url || '';
  const i   = url.indexOf('?');
  const p   = i === -1 ? url : url.slice(0, i);
  return p === prefix || p.startsWith(prefix + '/');
}

function jsonOk(res, payload) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.writeHead(200);
  res.end(JSON.stringify(payload));
}

function jsonErr(res, code, message) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.writeHead(code);
  res.end(JSON.stringify({ status: 'error', message }));
}

// ---------------------------------------------------------------------------
// GET /api/goals
// ---------------------------------------------------------------------------
app.use('/api/goals', async (req, res, next) => {
  if (req.method !== 'GET') return next();
  if (!pathIs(req, '/api/goals')) return next();

  const Goals = globalThis.GoalsCollection;
  if (!Goals) return jsonErr(res, 503, 'Goals collection not initialized — KOAD_IO_INDEX_GOALS not active');

  try {
    const q = parseQuery(req.originalUrl || req.url);

    const selector = {};
    if (q.status === 'all') {
      // no filter
    } else if (q.status) {
      selector.status = q.status;
    } else {
      // Default: active and paused only (exclude complete/archived)
      selector.status = { $in: ['active', 'proposed'] };
    }

    if (q.horizon) selector.horizon = q.horizon;

    const goals = await Goals.find(selector, { sort: { created: -1 } }).fetchAsync();
    jsonOk(res, { status: 'ok', count: goals.length, goals });
  } catch (err) {
    console.error('[API/goals] error:', err.message);
    jsonErr(res, 500, err.message);
  }
});

// ---------------------------------------------------------------------------
// GET /api/projects
// ---------------------------------------------------------------------------
app.use('/api/projects', async (req, res, next) => {
  if (req.method !== 'GET') return next();
  // Must not match /api/projects/:slug/flights — that's handled separately
  if (!pathIs(req, '/api/projects')) return next();

  const Projects = globalThis.ProjectsCollection;
  if (!Projects) return jsonErr(res, 503, 'Projects collection not initialized — KOAD_IO_INDEX_PROJECTS not active');

  try {
    const q = parseQuery(req.originalUrl || req.url);

    const selector = {};
    if (q.status === 'all') {
      // no filter
    } else if (q.status) {
      selector.status = q.status;
    } else {
      // Default: exclude complete/archived
      selector.status = { $in: ['discovery', 'active', 'blocked'] };
    }

    if (q.goal) selector.goal_refs = q.goal;

    const projects = await Projects.find(selector, { sort: { created: -1 } }).fetchAsync();
    jsonOk(res, { status: 'ok', count: projects.length, projects });
  } catch (err) {
    console.error('[API/projects] error:', err.message);
    jsonErr(res, 500, err.message);
  }
});

// ---------------------------------------------------------------------------
// GET /api/projects/:slug/flights
// Intercept before the /api/projects handler above — register first.
// ---------------------------------------------------------------------------
app.use('/api/projects', async (req, res, next) => {
  if (req.method !== 'GET') return next();

  // Match /api/projects/<slug>/flights
  const url = req.originalUrl || req.url || '';
  const m   = url.match(/^\/api\/projects\/([^/?]+)\/flights/);
  if (!m) return next();

  const slug    = decodeURIComponent(m[1]);
  const Flights = globalThis.FlightsCollection;

  if (!Flights) return jsonErr(res, 503, 'Flights collection not initialized');

  const Projects = globalThis.ProjectsCollection;
  if (!Projects) return jsonErr(res, 503, 'Projects collection not initialized — KOAD_IO_INDEX_PROJECTS not active');

  // Confirm project exists
  const project = await Projects.findOne(slug);
  if (!project) return jsonErr(res, 404, `Project "${slug}" not found`);

  try {
    const q        = parseQuery(url);
    const selector = { project: slug };
    if (q.status) selector.status = q.status;

    const limit   = Math.min(parseInt(q.limit || '50', 10) || 50, 500);
    const flights = await Flights.find(selector, {
      sort:  { started: -1 },
      limit,
    }).fetchAsync();

    jsonOk(res, {
      status:  'ok',
      project: slug,
      count:   flights.length,
      flights,
    });
  } catch (err) {
    console.error(`[API/projects/${slug}/flights] error:`, err.message);
    jsonErr(res, 500, err.message);
  }
});

// ---------------------------------------------------------------------------
// Flight query extension: /api/flights?project=<slug> and ?goal=<slug>
//
// These intercept BEFORE the generic /api/flights handler in api.js.
// We only handle requests that carry project= or goal= params.
// All other /api/flights requests fall through to api.js.
// ---------------------------------------------------------------------------
app.use('/api/flights', async (req, res, next) => {
  if (req.method !== 'GET') return next();
  if (!pathIs(req, '/api/flights')) return next();

  const q = parseQuery(req.originalUrl || req.url);
  // Only intercept when project= or goal= is present
  if (!q.project && !q.goal) return next();

  const Flights = globalThis.FlightsCollection;
  if (!Flights) return jsonErr(res, 503, 'Flights collection not initialized');

  try {
    const selector = {};
    const limit    = Math.min(parseInt(q.limit || '50', 10) || 50, 500);

    if (q.status) selector.status = q.status;
    if (q.entity) selector.entity = q.entity;

    if (q.project && !q.goal) {
      // Direct project filter only
      selector.project = q.project;

    } else if (q.goal && !q.project) {
      // Goal filter: direct flights + flights via any project linked to this goal
      const Projects = globalThis.ProjectsCollection;
      const projectSlugs = Projects
        ? Projects.find({ goal_refs: q.goal }).map(p => p.slug)
        : [];

      const orClauses = [{ goal: q.goal }];
      if (projectSlugs.length) {
        orClauses.push({ project: { $in: projectSlugs } });
      }
      selector.$or = orClauses;

    } else if (q.project && q.goal) {
      // Both provided — AND them (project must link to this goal per spec §5)
      selector.project = q.project;
      selector.goal    = q.goal;
    }

    const flights = await Flights.find(selector, {
      sort:  { started: -1 },
      limit,
    }).fetchAsync();

    jsonOk(res, { status: 'ok', count: flights.length, flights });
  } catch (err) {
    console.error('[API/flights?project/goal] error:', err.message);
    jsonErr(res, 500, err.message);
  }
});

// ---------------------------------------------------------------------------
// CORS preflight for new endpoints
// ---------------------------------------------------------------------------
for (const route of ['/api/goals', '/api/projects']) {
  app.use(route, (req, res, next) => {
    if (req.method !== 'OPTIONS') return next();
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    res.writeHead(204);
    res.end();
  });
}
