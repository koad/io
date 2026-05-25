// live-prompt-api.js — POST/GET /api/prompt/live
//
// Volatile in-memory store for live typing prompts from entities.
// The pi extension POSTs here from live-prompt.ts (debounced 500ms, clears on submit).
//
// Endpoints:
//   POST /api/prompt/live  — body: {entity, session_id, text, at}
//   GET  /api/prompt/live  — returns all current live prompts (not yet expired)
//
// In-memory state:
//   _livePrompts: Map<entity, {entity, session_id, text, at}>
//   Auto-clears entries older than 10 seconds (periodic sweep every 1s)
//
// DDP projection:
//   Collection: LivePrompts (in-memory, connection: null)
//   Publication: indexed.LivePrompts — subscribe from storefront

import { WebApp } from 'meteor/webapp';
import { Mongo }  from 'meteor/mongo';

const app = WebApp.connectHandlers;

// ---------------------------------------------------------------------------
// In-memory store
// ---------------------------------------------------------------------------
const _livePrompts = new Map(); // entity → { entity, session_id, text, at }
const TTL_MS = 60000; // 60 seconds

// ---------------------------------------------------------------------------
// Meteor collection + DDP publication
// ---------------------------------------------------------------------------
const LivePrompts = new Mongo.Collection('LivePrompts', { connection: null });
globalThis.LivePrompts = LivePrompts;

Meteor.publish('indexed.LivePrompts', function () {
  return LivePrompts.find();
});

// Periodic sweep for stale entries
Meteor.setInterval(() => {
  const now = Date.now();
  const stale = [];
  for (const [entity, entry] of _livePrompts) {
    const age = now - new Date(entry.at).getTime();
    if (age > TTL_MS) {
      stale.push(entity);
    }
  }
  for (const entity of stale) {
    _livePrompts.delete(entity);
    LivePrompts.remove(entity);
  }
}, 1000);

// ---------------------------------------------------------------------------
// Helpers (mirror channel-api.js pattern)
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// OPTIONS preflight
// ---------------------------------------------------------------------------
app.use('/api/prompt/live', (req, res, next) => {
  if (req.method !== 'OPTIONS') return next();
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.writeHead(204);
  res.end();
});

// ---------------------------------------------------------------------------
// POST /api/prompt/live — store a live prompt
// ---------------------------------------------------------------------------
app.use('/api/prompt/live', async (req, res, next) => {
  if (req.method !== 'POST') return next();

  try {
    const body = req.body || {};
    const { entity, session_id, text, at } = body;

    if (!entity || typeof entity !== 'string') {
      return jsonErr(res, 400, 'entity field required (string)');
    }

    const entry = {
      entity,
      session_id: session_id || null,
      text: typeof text === 'string' ? text : '',
      at: at || new Date().toISOString(),
    };

    _livePrompts.set(entity, entry);
    LivePrompts.upsert(entity, { $set: entry });

    jsonOk(res, { status: 'ok', entity });
  } catch (err) {
    console.error('[API/prompt/live POST] error:', err.message);
    jsonErr(res, 500, err.message);
  }
});

// ---------------------------------------------------------------------------
// GET /api/prompt/live — return all non-expired prompts
// ---------------------------------------------------------------------------
app.use('/api/prompt/live', async (req, res, next) => {
  if (req.method !== 'GET') return next();

  try {
    const now = Date.now();
    const prompts = [];

    for (const [, entry] of _livePrompts) {
      if (now - new Date(entry.at).getTime() <= TTL_MS) {
        prompts.push(entry);
      }
    }

    jsonOk(res, { prompts });
  } catch (err) {
    console.error('[API/prompt/live GET] error:', err.message);
    jsonErr(res, 500, err.message);
  }
});
