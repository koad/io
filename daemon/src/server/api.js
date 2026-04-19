// REST API — entity emitter endpoint
// No auth — inside the hard shell (localhost only)

import { WebApp } from 'meteor/webapp';
import bodyParser from 'body-parser';

const os = Npm.require('os');
const app = WebApp.connectHandlers;

// Indexer readiness registry — each indexer stamps its key when initial scan completes.
// Health endpoint reads this to report whether the daemon is fully indexed.
if (!globalThis.indexerReady) globalThis.indexerReady = {};

app.use(bodyParser.json());

const VALID_TYPES = ['notice', 'warning', 'error', 'request'];

// POST /emit — entity notification endpoint
app.use('/emit', (req, res, next) => {
  if (req.method !== 'POST') return next();

  const { entity, type, body } = req.body || {};

  // Validate
  if (!entity || typeof entity !== 'string') {
    res.writeHead(400);
    return res.end(JSON.stringify({ status: 'error', message: 'Missing or invalid "entity" field' }));
  }
  if (!type || !VALID_TYPES.includes(type)) {
    res.writeHead(400);
    return res.end(JSON.stringify({ status: 'error', message: `"type" must be one of: ${VALID_TYPES.join(', ')}` }));
  }
  if (!body || typeof body !== 'string') {
    res.writeHead(400);
    return res.end(JSON.stringify({ status: 'error', message: 'Missing or invalid "body" field' }));
  }

  const doc = {
    entity,
    type,
    body,
    timestamp: new Date(),
  };

  const id = EmissionsCollection.insert(doc);
  console.log(`[EMIT/REST] ${entity}/${type}: ${body}`);

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.writeHead(200);
  res.end(JSON.stringify({ status: 'success', _id: id }));
});

// CORS preflight for /emit
app.use('/emit', (req, res, next) => {
  if (req.method !== 'OPTIONS') return next();
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.writeHead(204);
  res.end();
});

// POST /heartbeat — entity activity pulse
// Body: { entity: "juno" }
// Called by prompt-awareness hooks during live sessions.
app.use('/heartbeat', (req, res, next) => {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    res.writeHead(204);
    return res.end();
  }
  if (req.method !== 'POST') return next();

  const { entity } = req.body || {};
  if (!entity || typeof entity !== 'string') {
    res.writeHead(400);
    return res.end(JSON.stringify({ status: 'error', message: 'Missing "entity"' }));
  }

  const now = new Date();
  EntityScanner.Entities.update({ handle: entity }, { $set: { lastActivity: now } });

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.writeHead(200);
  res.end(JSON.stringify({ status: 'ok', entity, at: now.toISOString() }));
});

// POST /flight — flight telemetry endpoint
// Body: { action: "open"|"close"|"stale", ...fields }
// No auth — localhost only, behind ZeroTier/Netbird hard shell
app.use('/flight', (req, res, next) => {
  if (req.method !== 'POST') return next();

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');

  const body = req.body || {};
  const { action } = body;

  if (!action || !['open', 'close', 'stale'].includes(action)) {
    res.writeHead(400);
    return res.end(JSON.stringify({ status: 'error', message: '"action" must be one of: open, close, stale' }));
  }

  try {
    if (action === 'open') {
      const { _id, entity, briefSlug, briefSummary, host, model, started } = body;
      if (!_id || typeof _id !== 'string') {
        res.writeHead(400);
        return res.end(JSON.stringify({ status: 'error', message: 'Missing "_id"' }));
      }
      if (!entity || typeof entity !== 'string') {
        res.writeHead(400);
        return res.end(JSON.stringify({ status: 'error', message: 'Missing "entity"' }));
      }
      const doc = {
        _id,
        entity,
        briefSlug: briefSlug || '',
        briefSummary: briefSummary || '',
        host: host || '',
        model: model || '',
        started: started ? new Date(started) : new Date(),
      };
      Meteor.call('flight.open', doc);
      console.log(`[FLIGHT/REST] open: ${entity}/${briefSlug || _id}`);
      res.writeHead(200);
      return res.end(JSON.stringify({ status: 'success', _id }));
    }

    if (action === 'close') {
      const { _id, ended, elapsed, completionSummary, stats } = body;
      if (!_id || typeof _id !== 'string') {
        res.writeHead(400);
        return res.end(JSON.stringify({ status: 'error', message: 'Missing "_id"' }));
      }
      const update = {};
      if (ended) update.ended = new Date(ended);
      if (elapsed != null) update.elapsed = Number(elapsed);
      if (completionSummary) update.completionSummary = String(completionSummary).slice(0, 300);
      if (stats && typeof stats === 'object') update.stats = {
        toolCalls: stats.toolCalls != null ? Number(stats.toolCalls) : null,
        contextTokens: stats.contextTokens != null ? Number(stats.contextTokens) : null,
        inputTokens: stats.inputTokens != null ? Number(stats.inputTokens) : null,
        outputTokens: stats.outputTokens != null ? Number(stats.outputTokens) : null,
        cost: stats.cost != null ? Number(stats.cost) : null,
      };
      Meteor.call('flight.close', _id, update);
      console.log(`[FLIGHT/REST] close: ${_id}`);
      res.writeHead(200);
      return res.end(JSON.stringify({ status: 'success', _id }));
    }

    if (action === 'stale') {
      const { _id } = body;
      if (!_id || typeof _id !== 'string') {
        res.writeHead(400);
        return res.end(JSON.stringify({ status: 'error', message: 'Missing "_id"' }));
      }
      Meteor.call('flight.stale', _id);
      console.log(`[FLIGHT/REST] stale: ${_id}`);
      res.writeHead(200);
      return res.end(JSON.stringify({ status: 'success', _id }));
    }
  } catch (err) {
    console.error('[FLIGHT/REST] error:', err.message);
    res.writeHead(500);
    return res.end(JSON.stringify({ status: 'error', message: err.message }));
  }
});

// CORS preflight for /flight
app.use('/flight', (req, res, next) => {
  if (req.method !== 'OPTIONS') return next();
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.writeHead(204);
  res.end();
});

// ---------------------------------------------------------------------------
// Read endpoints for CLI operators (juno status flights, emissions, etc.)
// All GET, JSON out, no auth — inside the ZeroTier/Netbird hard shell.
// Meteor 3: use fetchAsync()/countAsync() and async handlers.
// Collection refs go through globalThis (set in flights.js, emissions.js).
// ---------------------------------------------------------------------------

// Local ref to Passengers — declared with same name in indexers/passengers.js
// so Meteor dedupes to the same in-memory store.
const PassengersRef = new Mongo.Collection('Passengers', { connection: null });

function jsonOk(res, payload) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.writeHead(200);
  res.end(JSON.stringify(payload));
}

function jsonErr(res, code, message) {
  res.setHeader('Content-Type', 'application/json');
  res.writeHead(code);
  res.end(JSON.stringify({ status: 'error', message }));
}

// Parse ?foo=bar&baz=qux off req.url (connect middleware has no req.query)
function parseQuery(url) {
  const q = {};
  const i = url.indexOf('?');
  if (i === -1) return q;
  const raw = url.slice(i + 1);
  for (const pair of raw.split('&')) {
    const [k, v] = pair.split('=');
    if (k) q[decodeURIComponent(k)] = v ? decodeURIComponent(v) : '';
  }
  return q;
}

// Match exact path, stripping query string.
// Connect middleware with `app.use(prefix, ...)` strips the prefix from
// req.url, so we check req.originalUrl (unchanged) for exact routing.
function pathIs(req, target) {
  const url = req.originalUrl || req.url || '';
  const i = url.indexOf('?');
  const path = i === -1 ? url : url.slice(0, i);
  return path === target || path === target + '/';
}

// GET /api/health — daemon self-check
app.use('/api/health', async (req, res, next) => {
  if (req.method !== 'GET' || !pathIs(req, '/api/health')) return next();
  try {
    const Flights = globalThis.FlightsCollection;
    const Emissions = globalThis.EmissionsCollection;
    const ready = globalThis.indexerReady || {};
    const allReady = ['entities', 'passengers', 'alerts'].every(k => ready[k]);

    const payload = {
      status: allReady ? 'ok' : 'starting',
      ready: allReady,
      hostname: os.hostname(),
      uptime_s: Math.floor(process.uptime()),
      pid: process.pid,
      node: process.version,
      indexers: ready,
      counts: {
        flights: Flights ? await Flights.find().countAsync() : null,
        emissions: Emissions ? await Emissions.find().countAsync() : null,
        passengers: await PassengersRef.find().countAsync(),
      },
      time: new Date().toISOString(),
    };
    jsonOk(res, payload);
  } catch (err) {
    console.error('[API/health] error:', err.message);
    jsonErr(res, 500, err.message);
  }
});

// GET /api/flights/active — convenience: flying + stale only
// Register BEFORE /api/flights because connect middleware processes in order
// and /api/flights's prefix also matches /api/flights/active.
app.use('/api/flights/active', async (req, res, next) => {
  if (req.method !== 'GET' || !pathIs(req, '/api/flights/active')) return next();
  try {
    const Flights = globalThis.FlightsCollection;
    if (!Flights) return jsonErr(res, 503, 'Flights collection not initialized');

    const flights = await Flights.find(
      { status: { $in: ['flying', 'stale'] } },
      { sort: { started: -1 }, limit: 200 }
    ).fetchAsync();

    jsonOk(res, { status: 'ok', count: flights.length, flights });
  } catch (err) {
    console.error('[API/flights/active] error:', err.message);
    jsonErr(res, 500, err.message);
  }
});

// GET /api/flights — recent flights (newest first)
// GET /api/flights?status=flying — filter by status (flying, landed, stale)
// GET /api/flights?entity=vulcan — filter by entity
// GET /api/flights?limit=50 — default 50, max 500
app.use('/api/flights', async (req, res, next) => {
  if (req.method !== 'GET' || !pathIs(req, '/api/flights')) return next();
  try {
    const q = parseQuery(req.originalUrl || req.url);
    const Flights = globalThis.FlightsCollection;
    if (!Flights) return jsonErr(res, 503, 'Flights collection not initialized');

    const selector = {};
    if (q.status) selector.status = q.status;
    if (q.entity) selector.entity = q.entity;

    const limit = Math.min(parseInt(q.limit || '50', 10) || 50, 500);
    const flights = await Flights.find(selector, {
      sort: { started: -1 },
      limit,
    }).fetchAsync();

    jsonOk(res, { status: 'ok', count: flights.length, flights });
  } catch (err) {
    console.error('[API/flights] error:', err.message);
    jsonErr(res, 500, err.message);
  }
});

// GET /api/emissions — recent emissions (newest first)
// GET /api/emissions?entity=juno — filter
// GET /api/emissions?type=warning — filter
// GET /api/emissions?limit=50 — default 50, max 500
app.use('/api/emissions', async (req, res, next) => {
  if (req.method !== 'GET' || !pathIs(req, '/api/emissions')) return next();
  try {
    const q = parseQuery(req.originalUrl || req.url);
    const Emissions = globalThis.EmissionsCollection;
    if (!Emissions) return jsonErr(res, 503, 'Emissions collection not initialized');

    const selector = {};
    if (q.entity) selector.entity = q.entity;
    if (q.type) selector.type = q.type;

    const limit = Math.min(parseInt(q.limit || '50', 10) || 50, 500);
    const emissions = await Emissions.find(selector, {
      sort: { timestamp: -1 },
      limit,
    }).fetchAsync();

    jsonOk(res, { status: 'ok', count: emissions.length, emissions });
  } catch (err) {
    console.error('[API/emissions] error:', err.message);
    jsonErr(res, 500, err.message);
  }
});

// GET /api/passengers — entity index (all entities the daemon knows about)
app.use('/api/passengers', async (req, res, next) => {
  if (req.method !== 'GET' || !pathIs(req, '/api/passengers')) return next();
  try {
    const passengers = await PassengersRef.find({}, {
      sort: { name: 1 },
    }).fetchAsync();
    jsonOk(res, { status: 'ok', count: passengers.length, passengers });
  } catch (err) {
    console.error('[API/passengers] error:', err.message);
    jsonErr(res, 500, err.message);
  }
});

// ---------------------------------------------------------------------------
// Entity, kingdom, bond, tickler, key, env, and alert read endpoints
// Same pattern: GET, JSON, no auth — inside the hard shell.
// ---------------------------------------------------------------------------

// GET /api/entities — all detected entities
// GET /api/entities?role=orchestrator — filter by role
// GET /api/entities?kingdom=koad-io — filter by kingdomId
// GET /api/entities?summary=true — omit entityMd (for list views)
app.use('/api/entities', async (req, res, next) => {
  if (req.method !== 'GET' || !pathIs(req, '/api/entities')) return next();
  try {
    const q = parseQuery(req.originalUrl || req.url);
    const selector = {};
    if (q.role) selector.role = q.role;
    if (q.kingdom) selector.kingdomId = q.kingdom;

    const opts = { sort: { handle: 1 } };
    if (q.summary === 'true') {
      opts.fields = { entityMd: 0 };
    }

    const entities = await EntityScanner.Entities.find(selector, opts).fetchAsync();
    jsonOk(res, { status: 'ok', count: entities.length, entities });
  } catch (err) {
    console.error('[API/entities] error:', err.message);
    jsonErr(res, 500, err.message);
  }
});

// GET /api/kingdoms — all indexed kingdoms
app.use('/api/kingdoms', async (req, res, next) => {
  if (req.method !== 'GET' || !pathIs(req, '/api/kingdoms')) return next();
  try {
    const KingdomsRef = new Mongo.Collection('Kingdoms', { connection: null });
    const kingdoms = await KingdomsRef.find({}, {
      sort: { name: 1 },
    }).fetchAsync();
    jsonOk(res, { status: 'ok', count: kingdoms.length, kingdoms });
  } catch (err) {
    console.error('[API/kingdoms] error:', err.message);
    jsonErr(res, 500, err.message);
  }
});

// GET /api/bonds — bond index per entity
// GET /api/bonds?entity=juno — filter to one entity
app.use('/api/bonds', async (req, res, next) => {
  if (req.method !== 'GET' || !pathIs(req, '/api/bonds')) return next();
  try {
    const q = parseQuery(req.originalUrl || req.url);
    const BondsRef = new Mongo.Collection('BondsIndex', { connection: null });
    const selector = {};
    if (q.entity) selector.handle = q.entity;

    const bonds = await BondsRef.find(selector, {
      sort: { handle: 1 },
    }).fetchAsync();

    const CrossRef = new Mongo.Collection('CrossKingdomBonds', { connection: null });
    const crossSelector = {};
    if (q.entity) crossSelector.$or = [{ fromEntity: q.entity }, { toEntity: q.entity }];
    const crossKingdom = await CrossRef.find(crossSelector).fetchAsync();

    jsonOk(res, {
      status: 'ok',
      count: bonds.length,
      bonds,
      crossKingdom: { count: crossKingdom.length, bonds: crossKingdom },
    });
  } catch (err) {
    console.error('[API/bonds] error:', err.message);
    jsonErr(res, 500, err.message);
  }
});

// GET /api/tickler — pending tickles per entity
// GET /api/tickler?entity=juno — filter to one entity
app.use('/api/tickler', async (req, res, next) => {
  if (req.method !== 'GET' || !pathIs(req, '/api/tickler')) return next();
  try {
    const q = parseQuery(req.originalUrl || req.url);
    const TicklerRef = new Mongo.Collection('TicklerIndex', { connection: null });
    const selector = {};
    if (q.entity) selector.handle = q.entity;

    const tickles = await TicklerRef.find(selector, {
      sort: { handle: 1 },
    }).fetchAsync();
    jsonOk(res, { status: 'ok', count: tickles.length, tickles });
  } catch (err) {
    console.error('[API/tickler] error:', err.message);
    jsonErr(res, 500, err.message);
  }
});

// GET /api/keys — key presence per entity (filenames only, never contents)
// GET /api/keys?entity=juno — filter to one entity
app.use('/api/keys', async (req, res, next) => {
  if (req.method !== 'GET' || !pathIs(req, '/api/keys')) return next();
  try {
    const q = parseQuery(req.originalUrl || req.url);
    const KeysRef = new Mongo.Collection('KeysIndex', { connection: null });
    const selector = {};
    if (q.entity) selector.handle = q.entity;

    const keys = await KeysRef.find(selector, {
      sort: { handle: 1 },
    }).fetchAsync();
    jsonOk(res, { status: 'ok', count: keys.length, keys });
  } catch (err) {
    console.error('[API/keys] error:', err.message);
    jsonErr(res, 500, err.message);
  }
});

// GET /api/env — entity env vars (sensitive keys redacted)
// GET /api/env?entity=juno — filter to one entity
const SENSITIVE_KEY_PATTERNS = [/SECRET/i, /TOKEN/i, /PASSWORD/i, /CREDENTIAL/i];
function redactVars(vars) {
  if (!vars || typeof vars !== 'object') return vars;
  const safe = {};
  for (const [k, v] of Object.entries(vars)) {
    if (SENSITIVE_KEY_PATTERNS.some(re => re.test(k))) safe[k] = '[REDACTED]';
    else safe[k] = v;
  }
  return safe;
}

app.use('/api/env', async (req, res, next) => {
  if (req.method !== 'GET' || !pathIs(req, '/api/env')) return next();
  try {
    const q = parseQuery(req.originalUrl || req.url);
    const EnvRef = new Mongo.Collection('EnvIndex', { connection: null });
    const selector = {};
    if (q.entity) selector.handle = q.entity;

    const raw = await EnvRef.find(selector, {
      sort: { handle: 1 },
    }).fetchAsync();

    const env = raw.map(doc => ({
      ...doc,
      vars: redactVars(doc.vars),
    }));

    jsonOk(res, { status: 'ok', count: env.length, env });
  } catch (err) {
    console.error('[API/env] error:', err.message);
    jsonErr(res, 500, err.message);
  }
});

// GET /api/alerts — active alerts/notifications per entity
// GET /api/alerts?entity=juno — filter to one entity
app.use('/api/alerts', async (req, res, next) => {
  if (req.method !== 'GET' || !pathIs(req, '/api/alerts')) return next();
  try {
    const q = parseQuery(req.originalUrl || req.url);
    const AlertsRef = new Mongo.Collection('Alerts', { connection: null });
    const selector = {};
    if (q.entity) selector.entity = q.entity;

    const alerts = await AlertsRef.find(selector, {
      sort: { updatedAt: -1 },
    }).fetchAsync();
    jsonOk(res, { status: 'ok', count: alerts.length, alerts });
  } catch (err) {
    console.error('[API/alerts] error:', err.message);
    jsonErr(res, 500, err.message);
  }
});

// ---------------------------------------------------------------------------
// GET /overview — public-safe kingdom snapshot (VESTA-SPEC-135)
// 60s TTL cache; CORS open; no auth required.
// Field projections follow §5 of the spec — dollar values and ops-language excluded.
// ---------------------------------------------------------------------------

let overviewCache = null;
let overviewCacheAt = 0;
const OVERVIEW_TTL_MS = 60 * 1000;

// Parse bond base strings into directed edges.
// Expected format: "{from}-to-{to}-{bond_type}"
// E.g. "koad-to-juno-peer" → { from: "koad", to: "juno", bond_type: "peer" }
// Deduplicates same-type pairs by bumping count.
function buildBondEdges(bondsDocs) {
  const edgeMap = new Map();
  for (const doc of bondsDocs) {
    for (const bond of (doc.bonds || [])) {
      const base = bond.base || '';
      const m = base.match(/^(.+)-to-(.+)-([^-]+)$/);
      if (!m) {
        console.warn('[overview] bond base did not match parse pattern, skipping:', base);
        continue;
      }
      const [, from, to, bond_type] = m;
      const key = `${from}::${to}::${bond_type}`;
      if (edgeMap.has(key)) {
        edgeMap.get(key).count++;
      } else {
        edgeMap.set(key, { from, to, bond_type, count: 1 });
      }
    }
  }
  return Array.from(edgeMap.values());
}

async function buildOverviewPayload() {
  const now = new Date();
  const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000);

  // Entities — public-safe projection per §5
  const entities = await EntityScanner.Entities.find(
    {},
    { fields: { handle: 1, tagline: 1, role: 1, entityMd: 1 } }
  ).fetchAsync();

  // Bonds — parse edge list from BondsIndex
  const BondsRef = new Mongo.Collection('BondsIndex', { connection: null });
  const bondsDocs = await BondsRef.find({}).fetchAsync();
  const edges = buildBondEdges(bondsDocs);

  // Flights (24h) — public-safe projection; briefSlug excluded per §4.4.1
  const Flights = globalThis.FlightsCollection;
  const flights = Flights
    ? await Flights.find(
        { started: { $gte: twentyFourHoursAgo } },
        {
          sort: { started: -1 },
          limit: 50,
          fields: { entity: 1, status: 1, started: 1, elapsed: 1, model: 1, _id: 0 },
        }
      ).fetchAsync()
    : [];

  // Emissions (24h) — type + entity + timestamp only; body excluded per §4.5
  const Emissions = globalThis.EmissionsCollection;
  const emissions = Emissions
    ? await Emissions.find(
        { timestamp: { $gte: twentyFourHoursAgo } },
        {
          sort: { timestamp: -1 },
          limit: 50,
          fields: { entity: 1, type: 1, timestamp: 1, _id: 0 },
        }
      ).fetchAsync()
    : [];

  return {
    generated_at: now.toISOString(),
    entities: entities.map(e => ({
      handle: e.handle,
      tagline: e.tagline || null,
      role: e.role || null,
      entityMd: e.entityMd || null,
    })),
    bond_graph: { edges },
    activity: {
      flights_24h: flights.map(f => ({
        entity: f.entity,
        status: f.status,
        started: f.started ? f.started.toISOString() : null,
        elapsed_s: f.elapsed != null ? Number(f.elapsed) : null,
        model: f.model || null,
      })),
      emissions_24h: emissions.map(e => ({
        entity: e.entity,
        type: e.type,
        timestamp: e.timestamp ? e.timestamp.toISOString() : null,
      })),
    },
  };
}

// OPTIONS preflight for /api/overview
// NOTE: moved from /overview to /api/overview — the Blaze template route at
// /overview was being shadowed by this JSON handler, causing the dashboard
// to return raw JSON instead of HTML. REST endpoints live under /api/.
app.use('/api/overview', (req, res, next) => {
  if (req.method !== 'OPTIONS') return next();
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.writeHead(204);
  res.end();
});

// GET /api/overview — public-safe kingdom snapshot
app.use('/api/overview', async (req, res, next) => {
  if (req.method !== 'GET' || !pathIs(req, '/api/overview')) return next();

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');

  const now = Date.now();
  try {
    if (!overviewCache || (now - overviewCacheAt) > OVERVIEW_TTL_MS) {
      overviewCache = await buildOverviewPayload();
      overviewCacheAt = now;
    }
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.setHeader('X-Overview-Generated-At', overviewCache.generated_at);
    jsonOk(res, overviewCache);
  } catch (err) {
    console.error('[overview] buildOverviewPayload error:', err.message);
    // Stale-on-error: serve cached response if one exists
    if (overviewCache) {
      res.setHeader('Cache-Control', 'public, max-age=60');
      res.setHeader('X-Overview-Generated-At', overviewCache.generated_at);
      res.setHeader('X-Overview-Stale', 'true');
      jsonOk(res, overviewCache);
    } else {
      jsonErr(res, 503, 'overview not yet available: ' + err.message);
    }
  }
});
