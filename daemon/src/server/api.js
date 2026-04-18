// REST API — entity emitter endpoint
// No auth — inside the hard shell (localhost only)

import { WebApp } from 'meteor/webapp';
import bodyParser from 'body-parser';

const app = WebApp.connectHandlers;

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
