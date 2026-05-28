/**
 * harness-bridge — Harness Bridge Protocol server (VESTA-SPEC-191)
 *
 * Daemon-internal Node.js module. Provides bidirectional harness
 * communication for running opencode sessions:
 *
 *   sidecar.py  — outbound telemetry (opencode → daemon). EXISTING.
 *   bridge.js   — inbound command delivery (daemon → opencode TUI). NEW.
 *
 * This module owns:
 *   - HarnessCommands in-memory store (ephemeral, no disk persistence)
 *   - In-memory bridge stream registry (_bridgeStreams)
 *   - HTTP endpoints under /harness/:
 *       GET  /harness/stream/:entity/:sessionId       — SSE stream for bridge.js
 *       POST /harness/commands/:entity/:sessionId      — queue a command
 *       PUT  /harness/commands/:id/status             — bridge reports result
 *       POST /harness/bridge/:entity/:sessionId/register   — bridge startup
 *       DELETE /harness/bridge/:entity/:sessionId/register — bridge shutdown
 *       GET  /harness/sessions/:entity                — list active bridges
 *       GET  /harness/ping                            — health check
 *   - 50-command soft cap per (entity, sessionId)
 *   - 60-second pruning interval
 *   - 30-second SSE keepalive heartbeat
 *
 * Usage (from sibling daemon server files):
 *   const { mount } = require('./harness-bridge-server');
 *   mount(app);  // app is a Connect/Express app (e.g. WebApp.connectHandlers)
 *
 * Consumed by daemon/src/server/harness-bridge.js, which mounts on
 * WebApp.connectHandlers at daemon boot. HTTP-consumed downstream by
 * bridge.js (a plain Node script alongside opencode sessions).
 */

'use strict';

const crypto = require('crypto');

// ---------------------------------------------------------------------------
// In-memory command store (replaces Mongo.Collection)
// ---------------------------------------------------------------------------

const _commands = []; // Array of command docs

const QUEUE_CAP = 50;
const PRUNE_AGE_MS = 5 * 60 * 1000; // 5 minutes
const PRUNE_INTERVAL_MS = 60 * 1000; // 60 seconds
const HEARTBEAT_INTERVAL_MS = 30 * 1000; // 30 seconds

// ---------------------------------------------------------------------------
// In-memory bridge stream registry
// { [entity]: { [sessionId]: { res, openedAt, lastFrameAt } } }
// ---------------------------------------------------------------------------

const _bridgeStreams = {};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCommandId() {
  return 'cmd_' + crypto.randomBytes(8).toString('hex');
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch (e) { reject(new Error('invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.setHeader('Content-Type', 'application/json');
  res.writeHead(status);
  res.end(payload);
}

// Parse URL path params from a pattern like /harness/stream/:entity/:sessionId
function matchPath(pattern, urlPath) {
  const keys = [];
  const regexStr = pattern.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, key) => {
    keys.push(key);
    return '([^/]+)';
  });
  const re = new RegExp('^' + regexStr + '$');
  const m = urlPath.match(re);
  if (!m) return null;
  const params = {};
  keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
  return params;
}

// Strip query string from URL
function urlPath(url) {
  const qi = url.indexOf('?');
  return qi === -1 ? url : url.slice(0, qi);
}

// Write an SSE frame to an open response
function writeSseFrame(res, eventType, data) {
  try {
    res.write(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`);
    return true;
  } catch (e) {
    return false;
  }
}

// Deliver a command to a bridge stream (if open). Updates deliveredAt on success.
function deliverCommand(doc) {
  const streams = _bridgeStreams[doc.entity];
  if (!streams || !streams[doc.sessionId]) return false;

  const frame = { id: doc._id, cmd: doc.cmd, payload: doc.payload };
  const sent = writeSseFrame(streams[doc.sessionId].res, 'harness_command', frame);
  if (sent) {
    streams[doc.sessionId].lastFrameAt = new Date();
    doc.status = 'delivered';
    doc.deliveredAt = new Date();
  }
  return sent;
}

// ---------------------------------------------------------------------------
// SSE heartbeat — ping all open bridge streams every 30s
// ---------------------------------------------------------------------------

setInterval(() => {
  for (const entity of Object.keys(_bridgeStreams)) {
    for (const sessionId of Object.keys(_bridgeStreams[entity])) {
      const entry = _bridgeStreams[entity][sessionId];
      const sent = writeSseFrame(entry.res, 'harness_ping', {});
      if (!sent) {
        delete _bridgeStreams[entity][sessionId];
        if (Object.keys(_bridgeStreams[entity]).length === 0) {
          delete _bridgeStreams[entity];
        }
      } else {
        entry.lastFrameAt = new Date();
      }
    }
  }
}, HEARTBEAT_INTERVAL_MS);

// ---------------------------------------------------------------------------
// Pruning — remove executed/failed commands older than PRUNE_AGE_MS
// ---------------------------------------------------------------------------

setInterval(() => {
  const cutoff = Date.now() - PRUNE_AGE_MS;
  for (let i = _commands.length - 1; i >= 0; i--) {
    const doc = _commands[i];
    if ((doc.status === 'executed' || doc.status === 'failed')) {
      const ts = doc.executedAt || doc.failedAt;
      if (ts && ts.getTime() < cutoff) {
        _commands.splice(i, 1);
      }
    }
  }
}, PRUNE_INTERVAL_MS);

// ---------------------------------------------------------------------------
// mount(app) — register all /harness/ routes on a Connect/Express app
// ---------------------------------------------------------------------------

function mount(app) {

  // CORS preflight for /harness/
  app.use('/harness', (req, res, next) => {
    if (req.method !== 'OPTIONS') return next();
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    res.writeHead(204);
    res.end();
  });

  // -------------------------------------------------------------------
  // GET /harness/ping — health check
  // -------------------------------------------------------------------
  app.use('/harness/ping', (req, res, next) => {
    const fullPath = urlPath(req.originalUrl || req.url || '/');
    if (fullPath !== '/harness/ping' && fullPath !== '/harness/ping/') return next();
    if (req.method !== 'GET') return next();

    let activeBridges = 0;
    for (const entity of Object.keys(_bridgeStreams)) {
      activeBridges += Object.keys(_bridgeStreams[entity]).length;
    }

    sendJson(res, 200, {
      status: 'ok',
      activeBridges,
      queuedCommands: _commands.filter(c => c.status === 'queued').length,
      ts: new Date().toISOString(),
    });
  });

  // -------------------------------------------------------------------
  // GET /harness/sessions/:entity — list active bridges for entity
  // -------------------------------------------------------------------
  app.use('/harness/sessions', (req, res, next) => {
    const full = urlPath(req.originalUrl || req.url || '/');
    const params = matchPath('/harness/sessions/:entity', full);
    if (!params) return next();
    if (req.method !== 'GET') return next();

    const { entity } = params;
    const sessions = _bridgeStreams[entity] || {};
    const result = Object.entries(sessions).map(([sessionId, entry]) => ({
      sessionId,
      openedAt: entry.openedAt,
      lastFrameAt: entry.lastFrameAt,
    }));
    sendJson(res, 200, { entity, bridges: result });
  });

  // -------------------------------------------------------------------
  // GET /harness/stream/:entity/:sessionId — long-lived SSE for bridge.js
  // -------------------------------------------------------------------
  app.use('/harness/stream', async (req, res, next) => {
    const full = urlPath(req.originalUrl || req.url || '/');
    const params = matchPath('/harness/stream/:entity/:sessionId', full);
    if (!params) return next();
    if (req.method !== 'GET') return next();

    const { entity, sessionId } = params;

    // Duplicate stream check
    if (_bridgeStreams[entity] && _bridgeStreams[entity][sessionId]) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('X-Accel-Buffering', 'no');
      res.setHeader('Connection', 'keep-alive');
      res.writeHead(200);
      writeSseFrame(res, 'harness_error', {
        code: 'duplicate_stream',
        message: `A bridge is already connected for ${entity}/${sessionId}`,
      });
      res.end();
      return;
    }

    // Register stream
    if (!_bridgeStreams[entity]) _bridgeStreams[entity] = {};
    const now = new Date();
    _bridgeStreams[entity][sessionId] = { res, openedAt: now, lastFrameAt: now };

    // SSE response headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Connection', 'keep-alive');
    res.writeHead(200);

    // Deliver any queued commands immediately
    const queued = _commands
      .filter(c => c.entity === entity && c.sessionId === sessionId && c.status === 'queued')
      .sort((a, b) => a.enqueuedAt - b.enqueuedAt);
    for (const doc of queued) {
      deliverCommand(doc);
    }

    // Cleanup on disconnect
    req.on('close', () => {
      if (_bridgeStreams[entity] && _bridgeStreams[entity][sessionId]) {
        delete _bridgeStreams[entity][sessionId];
        if (Object.keys(_bridgeStreams[entity]).length === 0) {
          delete _bridgeStreams[entity];
        }
      }
    });
  });

  // -------------------------------------------------------------------
  // POST /harness/commands/:entity/:sessionId — queue a command
  // PUT  /harness/commands/:id/status        — bridge reports result
  // -------------------------------------------------------------------
  app.use('/harness/commands', async (req, res, next) => {
    const full = urlPath(req.originalUrl || req.url || '/');

    const postParams = matchPath('/harness/commands/:entity/:sessionId', full);
    const putParams = matchPath('/harness/commands/:id/status', full);

    if (!postParams && !putParams) return next();

    // -------- PUT /harness/commands/:id/status --------
    if (putParams && req.method === 'PUT') {
      const { id } = putParams;
      let body;
      try { body = await parseBody(req); }
      catch (e) { return sendJson(res, 400, { error: 'invalid JSON' }); }

      const status = body.status;
      if (!['executed', 'failed'].includes(status)) {
        return sendJson(res, 400, { error: 'status must be "executed" or "failed"' });
      }

      const doc = _commands.find(c => c._id === id);
      if (!doc) {
        // Evicted from in-memory — safe to ignore per spec
        res.writeHead(204);
        return res.end();
      }

      doc.status = status;
      if (status === 'executed') {
        doc.executedAt = new Date();
        if (body.result) doc.result = body.result;
      } else {
        doc.failedAt = new Date();
        if (body.reason) doc.failReason = body.reason;
      }

      res.writeHead(204);
      return res.end();
    }

    // -------- POST /harness/commands/:entity/:sessionId --------
    if (postParams && req.method === 'POST') {
      const { entity, sessionId } = postParams;

      let body;
      try { body = await parseBody(req); }
      catch (e) { return sendJson(res, 400, { error: 'invalid JSON' }); }

      const validCmds = ['inject', 'append', 'ping', 'pause', 'resume'];
      if (!body.cmd || !validCmds.includes(body.cmd)) {
        return sendJson(res, 400, { error: `cmd must be one of: ${validCmds.join(', ')}` });
      }

      // Soft cap: 50 queued commands per (entity, sessionId)
      const queuedCount = _commands.filter(
        c => c.entity === entity && c.sessionId === sessionId && c.status === 'queued'
      ).length;
      if (queuedCount >= QUEUE_CAP) {
        return sendJson(res, 429, {
          error: `Queue cap (${QUEUE_CAP}) reached for ${entity}/${sessionId}. Retry after some commands are processed.`
        });
      }

      const doc = {
        _id: makeCommandId(),
        entity,
        sessionId,
        cmd: body.cmd,
        payload: body.payload || {},
        status: 'queued',
        enqueuedAt: new Date(),
        deliveredAt: null,
        executedAt: null,
        failedAt: null,
        failReason: null,
      };

      _commands.push(doc);

      // Attempt immediate SSE delivery
      const bridgeOpen = _bridgeStreams[entity] && _bridgeStreams[entity][sessionId];
      if (bridgeOpen) {
        deliverCommand(doc);
      }

      return sendJson(res, bridgeOpen ? 202 : 404, {
        _id: doc._id,
        status: doc.status,
      });
    }

    return next();
  });

  // -------------------------------------------------------------------
  // POST   /harness/bridge/:entity/:sessionId/register — bridge startup
  // DELETE /harness/bridge/:entity/:sessionId/register — bridge shutdown
  // -------------------------------------------------------------------
  app.use('/harness/bridge', async (req, res, next) => {
    const full = urlPath(req.originalUrl || req.url || '/');
    const regParams = matchPath('/harness/bridge/:entity/:sessionId/register', full);
    if (!regParams) return next();

    const { entity, sessionId } = regParams;

    // -------- POST — bridge startup registration --------
    if (req.method === 'POST') {
      let body;
      try { body = await parseBody(req); }
      catch (e) { return sendJson(res, 400, { error: 'invalid JSON' }); }

      const HarnessSessions = globalThis.HarnessSessionsCollection;
      if (HarnessSessions) {
        const existing = await HarnessSessions.findOneAsync({ _id: sessionId });
        if (existing) {
          await HarnessSessions.updateAsync(
            { _id: sessionId },
            { $set: { bridgeAlive: true, bridgePid: body.pid || null } }
          );
          return sendJson(res, 200, { status: 'ok' });
        } else {
          return sendJson(res, 404, { status: 'not_found', message: 'No HarnessSessions record for this sessionId. Bridge continues.' });
        }
      } else {
        return sendJson(res, 200, { status: 'ok', note: 'HarnessSessions not available' });
      }
    }

    // -------- DELETE — bridge shutdown deregistration --------
    if (req.method === 'DELETE') {
      const HarnessSessions = globalThis.HarnessSessionsCollection;
      if (HarnessSessions) {
        await HarnessSessions.updateAsync(
          { _id: sessionId },
          { $set: { bridgeAlive: false, bridgePid: null } }
        );
      }
      res.writeHead(204);
      return res.end();
    }

    return next();
  });
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = { mount, _commands, _bridgeStreams };
