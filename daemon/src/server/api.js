// REST API — entity emitter endpoint
// No auth — inside the hard shell (localhost only)

import { WebApp } from 'meteor/webapp';
import bodyParser from 'body-parser';

const os = Npm.require('os');
const fs = Npm.require('fs');
const path = Npm.require('path');
const app = WebApp.connectHandlers;

// ---------------------------------------------------------------------------
// Message inbox writer — disk persistence for `request` type emissions.
// When a request emission arrives, write it as a frontmatter markdown file
// to $KOAD_IO_MESSAGES_DIR/<entity>/ for the target entity to read on startup.
// The daemon NEVER reads message content — only counts files.
// ---------------------------------------------------------------------------
const MESSAGES_BASE = process.env.KOAD_IO_MESSAGES_DIR || path.join(os.homedir(), '.forge', 'messages');

function writeMessageToDisk(entity, emissionId, body, meta, timestamp) {
  try {
    const entityDir = path.join(MESSAGES_BASE, entity);
    if (!fs.existsSync(entityDir)) {
      fs.mkdirSync(entityDir, { recursive: true });
    }

    const iso = timestamp.toISOString().replace(/:/g, '').replace(/\./g, '').slice(0, 15) + 'Z';
    const action = (meta && typeof meta.action === 'string' && /^[a-z0-9_-]+$/i.test(meta.action))
      ? meta.action
      : 'request';
    const filename = `${iso}-${action}.md`;
    const filepath = path.join(entityDir, filename);

    const frontmatter = [
      '---',
      `emission_id: ${emissionId}`,
      `entity: ${entity}`,
      `type: request`,
      `action: ${action}`,
      `timestamp: ${timestamp.toISOString()}`,
    ];
    if (meta && typeof meta === 'object') {
      const metaStr = JSON.stringify(meta);
      frontmatter.push(`meta: '${metaStr.replace(/'/g, "''")}'`);
    }
    frontmatter.push('---', '', body, '');

    fs.writeFileSync(filepath, frontmatter.join('\n'), 'utf8');
    console.log(`[MESSAGES] wrote ${entity}/${filename}`);
  } catch (err) {
    // Non-fatal — message write failure must not affect the emission path
    console.error(`[MESSAGES] write failed for ${entity}: ${err.message}`);
  }
}

// Indexer readiness registry — each indexer stamps its key when initial scan completes.
// Health endpoint reads this to report whether the daemon is fully indexed.
if (!globalThis.indexerReady) globalThis.indexerReady = {};

app.use(bodyParser.json());

// Built-in lifecycle types: session, flight, service, conversation, hook
// Built-in fire-and-forget types: notice, warning, error, request
// Type is open-vocabulary — consumers assign meaning; daemon stores any valid-shape string.
// Convention: noun.verb for event types (e.g. commit.signed, bond.witnessed, brief.dispatched)
const TYPE_PATTERN = /^[a-z0-9_][a-z0-9_.:-]{0,98}$/i;

// POST /emit/update — update a lifecycle emission
// Must be registered BEFORE /emit because connect prefix-matches.
app.use('/emit/update', (req, res, next) => {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    res.writeHead(204);
    return res.end();
  }
  if (req.method !== 'POST') return next();

  const { _id, body, action, meta, status_line, note, results, results_type } = req.body || {};

  if (!_id || typeof _id !== 'string') {
    res.writeHead(400);
    return res.end(JSON.stringify({ status: 'error', message: 'Missing "_id"' }));
  }

  // body is optional when using structured fields (status_line / note / results)
  const hasStructuredField = status_line != null || note != null || results != null;
  if (!hasStructuredField && (!body || typeof body !== 'string')) {
    res.writeHead(400);
    return res.end(JSON.stringify({ status: 'error', message: 'Missing "body" (or provide status_line / note / results)' }));
  }

  const existing = EmissionsCollection.findOne(_id);
  if (!existing) {
    res.writeHead(404);
    return res.end(JSON.stringify({ status: 'error', message: `Emission ${_id} not found` }));
  }

  const now = new Date();
  const effectiveBody = body || status_line || note || '(field update)';
  const update = {
    $set: { body: effectiveBody, updatedAt: now },
    $push: { history: { body: effectiveBody, at: now } },
  };

  if (action === 'close') {
    update.$set.status = 'closed';
    update.$set.closedAt = now;
  } else if (existing.status === 'open') {
    update.$set.status = 'active';
  }

  if (meta && typeof meta === 'object') {
    update.$set.meta = Object.assign({}, existing.meta || {}, meta);
  }

  // Structured narration fields:
  //   status_line — current activity headline, replaced on each call
  //   note        — append-only timeline entry (pushed to notes[])
  //   results     — markdown payload set when work completes (replaced)
  if (typeof status_line === 'string') {
    update.$set.status_line = status_line;
  }
  if (typeof note === 'string') {
    if (!update.$push) update.$push = {};
    update.$push.notes = { body: note, at: now };
  }
  if (typeof results === 'string') {
    update.$set.results = results;
    update.$set.results_type = (typeof results_type === 'string' && results_type) ? results_type : 'markdown';
  }

  EmissionsCollection.update(_id, update);
  EntityScanner.Entities.update({ handle: existing.entity }, { $set: { lastActivity: now } });
  console.log(`[EMIT/REST] ${existing.entity}/${existing.type}: ${effectiveBody} (${action || 'update'})`);

  // Reactive layer — fire matching triggers
  if (globalThis.evaluateEmissionTriggers) {
    const after = EmissionsCollection.findOne(_id);
    const event = action === 'close' ? 'close' : 'update';
    if (after) globalThis.evaluateEmissionTriggers(after, event);
  }

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.writeHead(200);
  res.end(JSON.stringify({ status: 'success', _id }));
});

// POST /emit — entity notification endpoint
app.use('/emit', (req, res, next) => {
  if (req.method !== 'POST') return next();

  const { entity, type, body, lifecycle, meta } = req.body || {};

  // Validate
  if (!entity || typeof entity !== 'string') {
    res.writeHead(400);
    return res.end(JSON.stringify({ status: 'error', message: 'Missing or invalid "entity" field' }));
  }
  if (!type || typeof type !== 'string' || !TYPE_PATTERN.test(type)) {
    res.writeHead(400);
    return res.end(JSON.stringify({ status: 'error', message: '"type" must be a non-empty string (max 100 chars, alphanumeric + . : - _)' }));
  }
  if (!body || typeof body !== 'string') {
    res.writeHead(400);
    return res.end(JSON.stringify({ status: 'error', message: 'Missing or invalid "body" field' }));
  }

  const now = new Date();
  const isLifecycle = lifecycle === 'open';

  const doc = {
    entity,
    type,
    body,
    timestamp: now,
  };

  if (meta && typeof meta === 'object') {
    doc.meta = globalThis.enrichEmissionAncestry
      ? globalThis.enrichEmissionAncestry(meta)
      : meta;
  }

  if (isLifecycle) {
    doc.status = 'open';
    doc.startedAt = now;
    doc.updatedAt = now;
    doc.history = [{ body, at: now }];
  }

  const id = EmissionsCollection.insert(doc);
  EntityScanner.Entities.update({ handle: entity }, { $set: { lastActivity: now } });
  console.log(`[EMIT/REST] ${entity}/${type}: ${body}${isLifecycle ? ' (lifecycle:open)' : ''}`);

  // Reactive layer — fire matching triggers
  if (globalThis.evaluateEmissionTriggers) {
    const event = isLifecycle ? 'open' : 'emit';
    globalThis.evaluateEmissionTriggers(Object.assign({}, doc, { _id: id }), event);
  }

  // Message inbox — persist request emissions to disk for entity pickup on session start.
  // Determine target entity: meta.target overrides meta.entity which falls back to entity field.
  if (type === 'request') {
    const targetEntity = (meta && (meta.target || meta.entity)) || entity;
    writeMessageToDisk(targetEntity, id, body, meta || {}, now);
  }

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
    const allReady = ['entities', 'passengers', 'alerts', 'sessions'].every(k => ready[k]);

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
        sessions: globalThis.SessionsCollection ? await globalThis.SessionsCollection.find().countAsync() : null,
      },
      time: new Date().toISOString(),
    };
    jsonOk(res, payload);
  } catch (err) {
    console.error('[API/health] error:', err.message);
    jsonErr(res, 500, err.message);
  }
});

// GET /api/flights/:id — single flight by _id
// Register BEFORE /api/flights and /api/flights/active (prefix-match order).
app.use('/api/flights', async (req, res, next) => {
  if (req.method !== 'GET') return next();

  const url = req.originalUrl || req.url || '';
  // Match /api/flights/<id> — id is everything after the last slash, no query
  const m = url.match(/^\/api\/flights\/([^/?]+)/);
  if (!m) return next();

  const id = decodeURIComponent(m[1]);
  // Don't match known sub-paths like "active"
  if (id === 'active') return next();

  try {
    const Flights = globalThis.FlightsCollection;
    if (!Flights) return jsonErr(res, 503, 'Flights collection not initialized');

    const flight = await Flights.findOneAsync({ _id: id });
    if (!flight) return jsonErr(res, 404, `Flight ${id} not found`);

    jsonOk(res, { status: 'ok', flight });
  } catch (err) {
    console.error('[API/flights/:id] error:', err.message);
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

// GET /api/sessions/active — active harness sessions only
app.use('/api/sessions/active', async (req, res, next) => {
  if (req.method !== 'GET' || !pathIs(req, '/api/sessions/active')) return next();
  try {
    const Sessions = globalThis.SessionsCollection;
    if (!Sessions) return jsonErr(res, 503, 'Sessions collection not initialized');

    const sessions = await Sessions.find(
      { status: 'active' },
      { sort: { lastSeen: -1 }, limit: 200 }
    ).fetchAsync();

    const totalCost = sessions.reduce((sum, s) => sum + (s.cost || 0), 0);

    jsonOk(res, { status: 'ok', count: sessions.length, totalCost, sessions });
  } catch (err) {
    console.error('[API/sessions/active] error:', err.message);
    jsonErr(res, 500, err.message);
  }
});

// GET /api/sessions — all indexed sessions
// GET /api/sessions?entity=juno — filter by entity
// GET /api/sessions?status=active — filter by status (active, stale)
// GET /api/sessions?limit=50 — default 50, max 500
app.use('/api/sessions', async (req, res, next) => {
  if (req.method !== 'GET' || !pathIs(req, '/api/sessions')) return next();
  try {
    const q = parseQuery(req.originalUrl || req.url);
    const Sessions = globalThis.SessionsCollection;
    if (!Sessions) return jsonErr(res, 503, 'Sessions collection not initialized');

    const selector = {};
    if (q.status) selector.status = q.status;
    if (q.entity) selector.entity = q.entity;

    const limit = Math.min(parseInt(q.limit || '50', 10) || 50, 500);
    const sessions = await Sessions.find(selector, {
      sort: { lastSeen: -1 },
      limit,
    }).fetchAsync();

    const totalCost = sessions.reduce((sum, s) => sum + (s.cost || 0), 0);

    jsonOk(res, { status: 'ok', count: sessions.length, totalCost, sessions });
  } catch (err) {
    console.error('[API/sessions] error:', err.message);
    jsonErr(res, 500, err.message);
  }
});

// ---------------------------------------------------------------------------
// Conversation thread endpoints (VESTA-SPEC-143)
// Specific paths registered BEFORE the :id catch-all.
// ---------------------------------------------------------------------------

// GET /api/conversations/active — threads with status "active"
app.use('/api/conversations/active', async (req, res, next) => {
  if (req.method !== 'GET' || !pathIs(req, '/api/conversations/active')) return next();
  try {
    const Convos = globalThis.ConversationsCollection;
    if (!Convos) return jsonErr(res, 503, 'Conversations collection not initialized');

    const conversations = await Convos.find(
      { status: 'active' },
      { sort: { lastSeen: -1 } }
    ).fetchAsync();

    jsonOk(res, { ok: true, conversations });
  } catch (err) {
    console.error('[API/conversations/active] error:', err.message);
    jsonErr(res, 500, err.message);
  }
});

// GET /api/conversations/recent — dormant threads seen in last 24h
app.use('/api/conversations/recent', async (req, res, next) => {
  if (req.method !== 'GET' || !pathIs(req, '/api/conversations/recent')) return next();
  try {
    const Convos = globalThis.ConversationsCollection;
    if (!Convos) return jsonErr(res, 503, 'Conversations collection not initialized');

    const cutoff = new Date(Date.now() - 24 * 3600 * 1000);
    const conversations = await Convos.find(
      { status: 'dormant', lastSeen: { $gte: cutoff } },
      { sort: { lastSeen: -1 } }
    ).fetchAsync();

    jsonOk(res, { ok: true, conversations });
  } catch (err) {
    console.error('[API/conversations/recent] error:', err.message);
    jsonErr(res, 500, err.message);
  }
});

// GET /api/conversations/by-entity/:entity — all threads for one entity, sorted by lastSeen desc
app.use('/api/conversations/by-entity', async (req, res, next) => {
  if (req.method !== 'GET') return next();
  const url = req.originalUrl || req.url || '';
  const m = url.match(/^\/api\/conversations\/by-entity\/([^/?]+)/);
  if (!m) return next();

  const entity = decodeURIComponent(m[1]);
  try {
    const Convos = globalThis.ConversationsCollection;
    if (!Convos) return jsonErr(res, 503, 'Conversations collection not initialized');

    const conversations = await Convos.find(
      { entity },
      { sort: { lastSeen: -1 } }
    ).fetchAsync();

    jsonOk(res, { ok: true, conversations });
  } catch (err) {
    console.error('[API/conversations/by-entity] error:', err.message);
    jsonErr(res, 500, err.message);
  }
});

// GET /api/conversations/:id — single thread by _id (session_id or session record id)
// Registered AFTER the more-specific paths above.
app.use('/api/conversations', async (req, res, next) => {
  if (req.method !== 'GET') return next();
  const url = req.originalUrl || req.url || '';
  const m = url.match(/^\/api\/conversations\/([^/?]+)/);
  if (!m) return next();

  const id = decodeURIComponent(m[1]);
  // Don't swallow requests meant for sub-paths not yet registered
  if (id === 'active' || id === 'recent' || id === 'by-entity') return next();

  try {
    const Convos = globalThis.ConversationsCollection;
    if (!Convos) return jsonErr(res, 503, 'Conversations collection not initialized');

    const conversation = await Convos.findOneAsync({ _id: id });
    if (!conversation) return jsonErr(res, 404, `Conversation ${id} not found`);

    jsonOk(res, { ok: true, conversation });
  } catch (err) {
    console.error('[API/conversations/:id] error:', err.message);
    jsonErr(res, 500, err.message);
  }
});

// GET /api/triggers — list all loaded reactive triggers
app.use('/api/triggers', async (req, res, next) => {
  if (req.method !== 'GET' || !pathIs(req, '/api/triggers')) return next();
  try {
    const list = globalThis.listEmissionTriggers ? globalThis.listEmissionTriggers() : [];
    jsonOk(res, { status: 'ok', count: list.length, triggers: list });
  } catch (err) {
    console.error('[API/triggers] error:', err.message);
    jsonErr(res, 500, err.message);
  }
});

// GET /api/emissions/tree/<id> — full descendant tree under an emission
// Returns a nested structure: { ...node, children: [{ ...child, children: [...] }] }
// The requested id is the root of the returned tree (not necessarily the
// ancestral root). Includes the requested node itself + every descendant
// reachable via meta.path.
app.use('/api/emissions/tree', async (req, res, next) => {
  if (req.method !== 'GET') return next();
  try {
    const url = req.originalUrl || req.url || '';
    // /api/emissions/tree/<id> — connect strips the prefix, so req.url is /<id>
    // But pathIs uses originalUrl which is unstripped. Strip prefix manually.
    const stripped = url.replace(/^\/api\/emissions\/tree\/?/, '').split('?')[0].replace(/\/$/, '');
    const id = decodeURIComponent(stripped);
    if (!id) return jsonErr(res, 400, 'Missing emission id in path');

    const Emissions = globalThis.EmissionsCollection;
    if (!Emissions) return jsonErr(res, 503, 'Emissions collection not initialized');

    const root = await Emissions.findOne(id);
    if (!root) return jsonErr(res, 404, `Emission ${id} not found`);

    // Find every doc whose path includes this id — those are all descendants
    const descendants = await Emissions.find({ 'meta.path': id }).fetchAsync();

    // Build a parent → children index for O(N) tree assembly
    const byParent = {};
    for (const doc of descendants) {
      const pid = doc.meta && doc.meta.parentId;
      if (!pid) continue;
      if (!byParent[pid]) byParent[pid] = [];
      byParent[pid].push(doc);
    }

    function attach(node) {
      const kids = byParent[node._id] || [];
      kids.sort((a, b) => new Date(a.startedAt || a.timestamp) - new Date(b.startedAt || b.timestamp));
      return Object.assign({}, node, {
        children: kids.map(attach),
      });
    }

    const tree = attach(root);
    const totalNodes = 1 + descendants.length;
    jsonOk(res, { status: 'ok', rootId: id, totalNodes, tree });
  } catch (err) {
    console.error('[API/emissions/tree] error:', err.message);
    jsonErr(res, 500, err.message);
  }
});

// GET /api/emissions/active — open or active lifecycle emissions
// GET /api/emissions/active?entity=vulcan — filter by entity
app.use('/api/emissions/active', async (req, res, next) => {
  if (req.method !== 'GET' || !pathIs(req, '/api/emissions/active')) return next();
  try {
    const q = parseQuery(req.originalUrl || req.url);
    const Emissions = globalThis.EmissionsCollection;
    if (!Emissions) return jsonErr(res, 503, 'Emissions collection not initialized');

    const selector = { status: { $in: ['open', 'active'] } };
    if (q.entity) selector.entity = q.entity;

    const emissions = await Emissions.find(selector, {
      sort: { startedAt: -1 },
      limit: 200,
    }).fetchAsync();

    jsonOk(res, { status: 'ok', count: emissions.length, emissions });
  } catch (err) {
    console.error('[API/emissions/active] error:', err.message);
    jsonErr(res, 500, err.message);
  }
});

// GET /api/emissions — recent emissions (newest first)
// GET /api/emissions?entity=juno — filter
// GET /api/emissions?type=warning — filter
// GET /api/emissions?status=open — filter by lifecycle status
// GET /api/emissions?parent=abc123 — children of a conversation/parent emission
// GET /api/emissions?flightId=abc123 — emissions tied to a flight (via meta.flightId)
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
    if (q.status) selector.status = q.status;
    if (q.parent) selector['meta.parentId'] = q.parent;
    if (q.flightId) selector['meta.flightId'] = q.flightId;

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

// GET /api/workers — worker process status (koad:io-worker-processes)
// Returns all workers registered in WorkerProcesses collection, sorted by service name.
// errors[] is stripped to a count to avoid leaking stack traces.
app.use('/api/workers', async (req, res, next) => {
  if (req.method !== 'GET' || !pathIs(req, '/api/workers')) return next();
  try {
    // WorkerProcesses collection is declared in packages/workers with Mongo name 'workers'
    const WorkersRef = new Mongo.Collection('workers', { connection: null });
    const raw = await WorkersRef.find({}, { sort: { service: 1 } }).fetchAsync();

    // Project out stack traces — include error count only
    const workers = raw.map(w => {
      const safe = Object.assign({}, w);
      if (Array.isArray(safe.errors)) {
        safe.errorCount = safe.errors.length;
        delete safe.errors;
      }
      return safe;
    });

    jsonOk(res, { status: 'ok', count: workers.length, workers });
  } catch (err) {
    console.error('[API/workers] error:', err.message);
    jsonErr(res, 500, err.message);
  }
});

// GET /api/messages/counts — inbox file counts per entity (never reads content)
// Returns { entity: count } for each entity that has a messages directory.
// Processed/ subdirectory is excluded from the count.
app.use('/api/messages/counts', async (req, res, next) => {
  if (req.method !== 'GET' || !pathIs(req, '/api/messages/counts')) return next();
  try {
    const counts = {};
    if (fs.existsSync(MESSAGES_BASE)) {
      const entries = fs.readdirSync(MESSAGES_BASE, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const entityHandle = entry.name;
        const entityDir = path.join(MESSAGES_BASE, entityHandle);
        const files = fs.readdirSync(entityDir).filter(f => f !== 'processed' && f.endsWith('.md'));
        if (files.length > 0) {
          counts[entityHandle] = files.length;
        }
      }
    }
    const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
    jsonOk(res, { status: 'ok', total, counts });
  } catch (err) {
    console.error('[API/messages/counts] error:', err.message);
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

  // Sessions — active harness sessions; cost + model visible, cwd excluded
  const SessionsCol = globalThis.SessionsCollection;
  const sessions = SessionsCol
    ? await SessionsCol.find(
        { status: 'active' },
        {
          sort: { lastSeen: -1 },
          limit: 50,
          fields: { entity: 1, model: 1, contextPct: 1, cost: 1, lastSeen: 1, host: 1, status: 1, _id: 0 },
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
    sessions: sessions.map(s => ({
      entity: s.entity,
      model: s.model || null,
      contextPct: s.contextPct != null ? Number(s.contextPct) : null,
      cost: s.cost != null ? Number(s.cost) : null,
      lastSeen: s.lastSeen ? s.lastSeen.toISOString() : null,
      host: s.host || null,
    })),
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

// ---------------------------------------------------------------------------
// GET /api/primitives — list the primitive library
// GET /api/primitives/<name> — single primitive detail with script content
// GET /api/entities/<handle>/primitives — installed primitives per entity
// POST /api/primitives/provision?entity=<handle> — manual provision trigger
//
// These implement VESTA-SPEC-136 §9.1–9.4.
// ---------------------------------------------------------------------------

const primitivesFsPath = Npm.require('path');
const primitivesFs = Npm.require('fs');
const primitivesHome = process.env.HOME;

function loadPrimitivesLibraryForApi() {
  if (globalThis.PrimitivesLibrary && globalThis.PrimitivesLibrary.loadPrimitiveLibrary) {
    return globalThis.PrimitivesLibrary.loadPrimitiveLibrary();
  }
  return [];
}

// GET /api/primitives/<name> — must be registered before /api/primitives
app.use('/api/primitives', async (req, res, next) => {
  if (req.method !== 'GET') return next();

  const url = req.originalUrl || req.url || '';
  // Strip query string and leading path prefix
  const stripped = url.replace(/^\/api\/primitives\/?/, '').split('?')[0].replace(/\/$/, '');

  if (!stripped || stripped === 'provision') return next(); // let /api/primitives (list) or /provision handler catch

  // Single primitive detail: GET /api/primitives/<name>
  const name = decodeURIComponent(stripped);
  try {
    const library = loadPrimitivesLibraryForApi();
    const primitive = library.find(p => p.name === name);
    if (!primitive) return jsonErr(res, 404, `Primitive '${name}' not found`);

    let script = null;
    try {
      script = primitivesFs.readFileSync(primitive.scriptPath, 'utf8');
    } catch (e) {}

    const { scriptPath, ...rest } = primitive;
    jsonOk(res, Object.assign({}, rest, { script }));
  } catch (err) {
    console.error('[API/primitives/:name] error:', err.message);
    jsonErr(res, 500, err.message);
  }
});

// GET /api/primitives — list all primitives in library
app.use('/api/primitives', async (req, res, next) => {
  if (req.method !== 'GET' || !pathIs(req, '/api/primitives')) return next();
  try {
    const library = loadPrimitivesLibraryForApi();
    const primitives = library.map(({ scriptPath, ...rest }) => rest);
    jsonOk(res, { status: 'ok', count: primitives.length, primitives });
  } catch (err) {
    console.error('[API/primitives] error:', err.message);
    jsonErr(res, 500, err.message);
  }
});

// POST /api/primitives/provision?entity=<handle> — manual provision
app.use('/api/primitives/provision', async (req, res, next) => {
  if (req.method !== 'POST') return next();
  try {
    const q = parseQuery(req.originalUrl || req.url);
    const entityHandle = q.entity || null;

    const entities = entityHandle
      ? EntityScanner.Entities.find({ handle: entityHandle }).fetch()
      : EntityScanner.Entities.find().fetch();

    if (entityHandle && entities.length === 0) {
      return jsonErr(res, 404, `Entity '${entityHandle}' not found`);
    }

    const library = loadPrimitivesLibraryForApi();

    // Re-use the provisioner logic by calling provisionOnce via globalThis
    // provisioner.js exports nothing directly — we re-implement the sweep here
    // using the shared library loader and the same pattern. The provisioner
    // worker will also sweep on its next interval, but this gives an immediate
    // synchronous summary for the caller.

    const results = [];
    const pathMod = Npm.require('path');
    const fsMod = Npm.require('fs');
    const cryptoMod = Npm.require('crypto');

    function hashFile(fp) {
      try {
        const c = fsMod.readFileSync(fp);
        return 'sha256:' + cryptoMod.createHash('sha256').update(c).digest('hex');
      } catch (e) { return null; }
    }

    function readRecord(entityPath, name) {
      try {
        return JSON.parse(fsMod.readFileSync(pathMod.join(entityPath, '.patched', name + '.json'), 'utf8'));
      } catch (e) { return null; }
    }

    function hasOptout(entityPath, name) {
      try { fsMod.accessSync(pathMod.join(entityPath, '.patched', name + '.optout')); return true; }
      catch (e) { return false; }
    }

    for (const entity of entities) {
      if (!entity.path) continue;
      for (const primitive of library) {
        if (!primitive.roles.includes('*') && entity.role && !primitive.roles.includes(entity.role)) continue;
        if (!primitive.roles.includes('*') && !entity.role) continue;

        const name = primitive.name;
        let action = 'no_op';

        if (hasOptout(entity.path, name)) {
          action = 'skipped_optout';
        } else {
          const record = readRecord(entity.path, name);
          if (!record) {
            action = 'eligible_not_installed';
          } else {
            const currentHash = hashFile(record.install_path);
            const cmp = (function semCmp(a, b) {
              const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
              for (let i = 0; i < 3; i++) {
                const na = pa[i] || 0, nb = pb[i] || 0;
                if (na < nb) return -1; if (na > nb) return 1;
              }
              return 0;
            })(record.version, primitive.version);
            if (cmp < 0 && currentHash === record.source_hash) action = 'upgrade_notice_emitted';
            else if (cmp < 0) action = 'skipped_customized';
            else if (cmp > 0) action = 'version_anomaly';
            else if (currentHash !== record.source_hash) action = 'skipped_customized';
            else action = 'no_op';
          }
        }

        results.push({ entity: entity.handle, primitive: name, action });
      }
    }

    jsonOk(res, {
      status: 'ok',
      ran_at: new Date().toISOString(),
      entity: entityHandle || 'all',
      summary: results,
    });
  } catch (err) {
    console.error('[API/primitives/provision] error:', err.message);
    jsonErr(res, 500, err.message);
  }
});

// GET /api/entities/<handle>/primitives — installed primitives state per entity
// Must be registered BEFORE /api/entities to avoid prefix shadowing.
app.use('/api/entities', async (req, res, next) => {
  if (req.method !== 'GET') return next();

  const url = req.originalUrl || req.url || '';
  const m = url.match(/^\/api\/entities\/([^/?]+)\/primitives/);
  if (!m) return next();

  const handle = decodeURIComponent(m[1]);
  try {
    const entity = await EntityScanner.Entities.findOneAsync({ handle });
    if (!entity) return jsonErr(res, 404, `Entity '${handle}' not found`);

    const library = loadPrimitivesLibraryForApi();
    const entityPath = entity.path;
    const fsMod = Npm.require('fs');
    const pathMod = Npm.require('path');
    const cryptoMod = Npm.require('crypto');

    function hashFile(fp) {
      try {
        const c = fsMod.readFileSync(fp);
        return 'sha256:' + cryptoMod.createHash('sha256').update(c).digest('hex');
      } catch (e) { return null; }
    }

    function readRecord(name) {
      try {
        return JSON.parse(fsMod.readFileSync(pathMod.join(entityPath, '.patched', name + '.json'), 'utf8'));
      } catch (e) { return null; }
    }

    function checkOptout(name) {
      try { fsMod.accessSync(pathMod.join(entityPath, '.patched', name + '.optout')); return true; }
      catch (e) { return false; }
    }

    const entries = [];

    // Add all library primitives eligible for this entity + opted-out ones
    const seen = new Set();
    for (const primitive of library) {
      const { name, kind, version: libVersion } = primitive;
      seen.add(name);
      const roleMatches = primitive.roles.includes('*') || (entity.role && primitive.roles.includes(entity.role));

      if (checkOptout(name)) {
        entries.push({ name, kind, status: 'opted_out', installed_version: null, library_version: libVersion, customized: false, pinned: false, opted_out: true });
        continue;
      }

      if (!roleMatches) {
        entries.push({ name, kind, status: 'role_mismatch', installed_version: null, library_version: libVersion, customized: false, pinned: false, opted_out: false });
        continue;
      }

      const record = readRecord(name);
      if (!record) {
        entries.push({ name, kind, status: 'not_installed', installed_version: null, library_version: libVersion, customized: false, pinned: false, opted_out: false });
        continue;
      }

      const currentHash = hashFile(record.install_path);
      const customized = !currentHash || currentHash !== record.source_hash;
      const pinned = record.pinned || false;

      const semCmp = (function(a, b) {
        const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
        for (let i = 0; i < 3; i++) {
          const na = pa[i] || 0, nb = pb[i] || 0;
          if (na < nb) return -1; if (na > nb) return 1;
        }
        return 0;
      })(record.version, libVersion);

      let status;
      if (semCmp > 0) status = 'version_anomaly';
      else if (semCmp < 0 && !customized) status = 'upgrade_available';
      else if (customized) status = 'customized';
      else status = 'current';

      entries.push({ name, kind, status, installed_version: record.version, library_version: libVersion, customized, pinned, opted_out: false });
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));
    jsonOk(res, { status: 'ok', entity: handle, count: entries.length, primitives: entries });
  } catch (err) {
    console.error('[API/entities/:handle/primitives] error:', err.message);
    jsonErr(res, 500, err.message);
  }
});

// ---------------------------------------------------------------------------
// POST /api/session/register — pre-register a harness session token
//
// Called by the harness launcher BEFORE starting Claude Code so the token is
// known to HarnessSessions when Claude Code reads .mcp.json and connects to
// the MCP service. The MCP auth layer validates Bearer tokens by looking up
// HarnessSessions._id — this endpoint creates that record ahead of time.
//
// Body: { entity, token, harness?, host?, pid?, cwd? }
//   entity  — entity handle (e.g. "juno")
//   token   — pre-generated UUID that will be used as Bearer token
//   harness — harness name (default: "claude-code")
//   host    — hostname (default: os.hostname())
//   pid     — launcher PID (informational)
//   cwd     — working directory (informational)
//
// The session-scanner will later enrich this record with live telemetry.
// On clean exit the harness calls /api/session/close to mark it ended.
// ---------------------------------------------------------------------------
app.use('/api/session/register', (req, res, next) => {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    res.writeHead(204);
    return res.end();
  }
  if (req.method !== 'POST') return next();

  const { entity, token, harness, host, pid, cwd } = req.body || {};

  if (!entity || typeof entity !== 'string') {
    res.writeHead(400);
    return res.end(JSON.stringify({ status: 'error', message: 'Missing "entity"' }));
  }
  if (!token || typeof token !== 'string' || token.length < 8) {
    res.writeHead(400);
    return res.end(JSON.stringify({ status: 'error', message: 'Missing or too-short "token"' }));
  }

  const Sessions = globalThis.SessionsCollection;
  if (!Sessions) {
    res.writeHead(503);
    return res.end(JSON.stringify({ status: 'error', message: 'SessionsCollection not available' }));
  }

  const now = new Date();
  const doc = {
    _id: token,
    entity,
    status: 'active',
    source: 'pre-registered',
    harness: harness || 'claude-code',
    host: host || os.hostname(),
    pid: pid ? Number(pid) : null,
    cwd: cwd || '',
    startedAt: now,
    lastSeen: now,
  };

  // Upsert — if the token already exists (e.g. from a prior crashed session),
  // refresh it rather than failing.
  const existing = Sessions.findOne({ _id: token });
  if (existing) {
    Sessions.update(token, { $set: { status: 'active', lastSeen: now, entity, harness: doc.harness } });
    console.log(`[SESSION/REGISTER] refreshed pre-registered token for ${entity}: ${token.slice(0, 12)}...`);
  } else {
    Sessions.insert(doc);
    console.log(`[SESSION/REGISTER] registered token for ${entity}: ${token.slice(0, 12)}...`);
  }

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.writeHead(200);
  res.end(JSON.stringify({ status: 'ok', token, entity }));
});

// POST /api/session/close — mark a pre-registered session as ended
// Body: { token }
app.use('/api/session/close', (req, res, next) => {
  if (req.method !== 'POST') return next();

  const { token } = req.body || {};
  if (!token || typeof token !== 'string') {
    res.writeHead(400);
    return res.end(JSON.stringify({ status: 'error', message: 'Missing "token"' }));
  }

  const Sessions = globalThis.SessionsCollection;
  if (Sessions) {
    Sessions.update({ _id: token }, { $set: { status: 'ended', endedAt: new Date() } });
    console.log(`[SESSION/CLOSE] closed pre-registered token: ${token.slice(0, 12)}...`);
  }

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.writeHead(200);
  res.end(JSON.stringify({ status: 'ok', token }));
});

// ---------------------------------------------------------------------------
// Storefront file API — serve entity public storefront content.
// Endpoints read from ~/.forge/storefronts/entities/<handle>/ on disk.
//
// GET /api/storefront/:handle/tree  — recursive file tree (max depth 5)
// GET /api/storefront/:handle/file?path=<rel> — single file content (text)
// GET /api/storefront/:handle/raw?path=<rel>  — raw bytes with Content-Type
//
// Path safety: all requests are validated to stay within the storefront root.
// No symlink traversal, no null bytes, no absolute paths.
// ---------------------------------------------------------------------------

const _storefrontBase = path.join(os.homedir(), '.forge', 'storefronts', 'entities');

// Known entity handles — must have a directory in storefrontBase.
// Validated dynamically (directory existence check), but handle itself must
// be alphanumeric + hyphens only to prevent any path manipulation.
const _handleRe = /^[a-zA-Z0-9-]+$/;

const STOREFRONT_SKIP_NAMES  = new Set(['.git', '.meteor', 'node_modules', 'dist', 'builds']);
const STOREFRONT_SKIP_PREFIX = '.'; // hidden files/dirs

const STOREFRONT_TEXT_EXTS = new Set([
  '.md', '.txt', '.json', '.yaml', '.yml', '.js', '.sh', '.bash', '.css',
  '.html', '.htm', '.xml', '.toml', '.ini', '.conf', '.env', '.ts',
  '.py', '.rb', '.rs', '.go', '.java', '.c', '.cpp', '.h',
]);

const STOREFRONT_IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico']);

const STOREFRONT_MAX_FILE_SIZE = 1 * 1024 * 1024; // 1 MB
const STOREFRONT_MAX_DEPTH = 5;

function _mime(extname) {
  const map = {
    '.md':   'text/markdown',
    '.txt':  'text/plain',
    '.json': 'application/json',
    '.yaml': 'text/yaml',
    '.yml':  'text/yaml',
    '.js':   'application/javascript',
    '.ts':   'application/typescript',
    '.sh':   'text/x-sh',
    '.bash': 'text/x-sh',
    '.css':  'text/css',
    '.html': 'text/html',
    '.htm':  'text/html',
    '.xml':  'application/xml',
    '.svg':  'image/svg+xml',
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif':  'image/gif',
    '.webp': 'image/webp',
    '.ico':  'image/x-icon',
  };
  return map[extname] || 'application/octet-stream';
}

// Validate handle and resolve storefront root. Returns the root path if valid,
// or null if the handle is invalid or the directory does not exist.
function _storefrontRoot(handle) {
  if (!handle || !_handleRe.test(handle)) return null;
  const root = path.join(_storefrontBase, handle);
  try {
    const st = fs.lstatSync(root);
    if (!st.isDirectory()) return null;
  } catch (e) {
    return null;
  }
  return root;
}

// Validate that a resolved path is safely inside root (no escape, not a
// symlink that exits the tree). Returns resolved absolute path or null.
function _safePath(root, relPath) {
  if (!relPath || typeof relPath !== 'string') return null;
  // Reject null bytes and control characters
  if (/[\x00-\x1f]/.test(relPath)) return null;
  // Reject absolute paths
  if (path.isAbsolute(relPath)) return null;
  const resolved = path.resolve(root, relPath);
  // Must stay within root
  if (!resolved.startsWith(root + path.sep) && resolved !== root) return null;
  // Check for symlinks that escape
  try {
    const real = fs.realpathSync(resolved);
    if (!real.startsWith(root + path.sep) && real !== root) return null;
  } catch (e) {
    return null;
  }
  return resolved;
}

// Recursive tree walker.
function _walkTree(dir, root, depth) {
  if (depth > STOREFRONT_MAX_DEPTH) return [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return [];
  }

  const dirs  = [];
  const files = [];

  for (const entry of entries) {
    if (entry.name.startsWith(STOREFRONT_SKIP_PREFIX)) continue;
    if (STOREFRONT_SKIP_NAMES.has(entry.name)) continue;

    if (entry.isDirectory()) {
      const children = _walkTree(path.join(dir, entry.name), root, depth + 1);
      dirs.push({ name: entry.name, type: 'dir', children });
    } else if (entry.isFile()) {
      let size = 0;
      try { size = fs.statSync(path.join(dir, entry.name)).size; } catch (e) {}
      files.push({ name: entry.name, type: 'file', size });
    }
  }

  dirs.sort((a, b)  => a.name.localeCompare(b.name));
  files.sort((a, b) => a.name.localeCompare(b.name));
  return [...dirs, ...files];
}

// GET /api/storefront/:handle/tree
app.use('/api/storefront', async (req, res, next) => {
  if (req.method !== 'GET') return next();

  const url = req.originalUrl || req.url || '';
  const m = url.match(/^\/api\/storefront\/([^/?]+)\/tree/);
  if (!m) return next();

  const handle = decodeURIComponent(m[1]);
  const root = _storefrontRoot(handle);
  if (!root) {
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(404);
    return res.end(JSON.stringify({ status: 'error', message: `Storefront '${handle}' not found` }));
  }

  try {
    const tree = _walkTree(root, root, 1);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok', handle, tree }));
  } catch (err) {
    console.error('[API/storefront/tree] error:', err.message);
    jsonErr(res, 500, err.message);
  }
});

// GET /api/storefront/:handle/file?path=<rel>
app.use('/api/storefront', async (req, res, next) => {
  if (req.method !== 'GET') return next();

  const url = req.originalUrl || req.url || '';
  const m = url.match(/^\/api\/storefront\/([^/?]+)\/file/);
  if (!m) return next();

  const handle = decodeURIComponent(m[1]);
  const root = _storefrontRoot(handle);
  if (!root) {
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(404);
    return res.end(JSON.stringify({ status: 'error', message: `Storefront '${handle}' not found` }));
  }

  const q = parseQuery(url);
  const relPath = q.path;
  const absPath = _safePath(root, relPath);
  if (!absPath) {
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(400);
    return res.end(JSON.stringify({ status: 'error', message: 'Invalid or unsafe path' }));
  }

  try {
    const stat = fs.statSync(absPath);
    if (!stat.isFile()) {
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(400);
      return res.end(JSON.stringify({ status: 'error', message: 'Path is not a file' }));
    }

    if (stat.size > STOREFRONT_MAX_FILE_SIZE) {
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(413);
      return res.end(JSON.stringify({ status: 'error', message: 'File exceeds 1 MB limit' }));
    }

    const ext = path.extname(absPath).toLowerCase();
    const mimeType = _mime(ext);
    const relOut = path.relative(root, absPath);

    if (STOREFRONT_IMAGE_EXTS.has(ext)) {
      // Images: return descriptor pointing to raw endpoint
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.writeHead(200);
      return res.end(JSON.stringify({
        status: 'ok', handle, path: relOut, size: stat.size, mimeType,
        isImage: true,
        rawUrl: `/api/storefront/${encodeURIComponent(handle)}/raw?path=${encodeURIComponent(relOut)}`,
        content: null,
      }));
    }

    const content = fs.readFileSync(absPath, 'utf8');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok', handle, path: relOut, size: stat.size, mimeType, content }));
  } catch (err) {
    if (err.code === 'ENOENT') {
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(404);
      return res.end(JSON.stringify({ status: 'error', message: 'File not found' }));
    }
    console.error('[API/storefront/file] error:', err.message);
    jsonErr(res, 500, err.message);
  }
});

// GET /api/storefront/:handle/raw?path=<rel> — stream raw bytes with Content-Type
app.use('/api/storefront', async (req, res, next) => {
  if (req.method !== 'GET') return next();

  const url = req.originalUrl || req.url || '';
  const m = url.match(/^\/api\/storefront\/([^/?]+)\/raw/);
  if (!m) return next();

  const handle = decodeURIComponent(m[1]);
  const root = _storefrontRoot(handle);
  if (!root) {
    res.writeHead(404);
    return res.end('Not found');
  }

  const q = parseQuery(url);
  const relPath = q.path;
  const absPath = _safePath(root, relPath);
  if (!absPath) {
    res.writeHead(400);
    return res.end('Invalid or unsafe path');
  }

  try {
    const stat = fs.statSync(absPath);
    if (!stat.isFile()) {
      res.writeHead(400);
      return res.end('Not a file');
    }

    const ext = path.extname(absPath).toLowerCase();
    const mimeType = _mime(ext);

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.writeHead(200);

    const stream = fs.createReadStream(absPath);
    stream.on('error', (err) => {
      console.error('[API/storefront/raw] stream error:', err.message);
      res.end();
    });
    stream.pipe(res);
  } catch (err) {
    if (err.code === 'ENOENT') {
      res.writeHead(404);
      return res.end('Not found');
    }
    console.error('[API/storefront/raw] error:', err.message);
    res.writeHead(500);
    res.end(err.message);
  }
});
