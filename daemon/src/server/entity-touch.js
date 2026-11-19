// server/entity-touch.js — "this entity is here, right now."
//
// ── WHY THIS EXISTS (2026-11-12) ────────────────────────────────────────────
// The daemon owns the entity index, and its `lastActivity` had NO live writer.
// Measured with a harness session running: every row was hours stale (vulcan
// 19:30, sienna Nov 10 — a day, across eleven sessions). It is written at scan
// time and then sits.
//
// The two workarounds were tried and both are wrong:
//
//   · Touching `~/.<entity>/ENTITY.md` and letting a watcher notice. Tested:
//     mtime changed at 04:22:17, `lastActivity` did not move, no watcher fired.
//     And it should not be built that way — ENTITY.md's mtime is the answer to
//     "when did this identity last change", which is a fact git, the auditors and
//     musium's scanners all read. A heartbeat must not overwrite it.
//   · Reading `HarnessSessions` for liveness (what the overview does today). It
//     works, but it needs a session, so a connection that has not called
//     `session_start` is invisible — which is exactly the case this is for.
//
// So: one verb, one writer, one field. `lastActivity` already exists in the
// entity document; nothing new is invented. `presence` is additive and bounded.
//
// ── WHY A ROUTE AND NOT Meteor.allow() ──────────────────────────────────────
// An allow rule receives (userId, doc, fieldNames, modifier, options) — no
// connection. The only identity it can check is a logged-in userId, and the
// callers here (the entity console, a voice client, a shell helper) are
// anonymous. A rule permissive enough for them is permissive for EVERY DDP
// client on the mesh, which would make entity rows writable by anything that can
// reach the daemon. A route can read the caller's address, and it can refuse.
//
// Mesh-only, whitelisted fields, throttled. A burst from a chatty client is a
// no-op, not a write.

import { WebApp } from 'meteor/webapp';

const THROTTLE_MS = Number(process.env.KOAD_IO_TOUCH_THROTTLE_MS || 30000);
const MAX_STR = 120;
const HANDLE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

// handle → ms of the last accepted write. In-process on purpose: this is a
// liveness signal, and after a restart the first touch SHOULD be written.
const lastAccepted = new Map();

function str(value, max = MAX_STR) {
  const text = String(value == null ? '' : value).trim();
  return text ? text.slice(0, max) : null;
}

/** Is the caller on the kingdom mesh? The perimeter the rest of the daemon uses. */
function fromMesh(req) {
  const raw = String(
    (req.socket && req.socket.remoteAddress) || req.headers['x-forwarded-for'] || '',
  );
  return raw.includes('10.10.10.') || raw.includes('127.0.0.1') || raw.includes('::1');
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (_err) { reject(new Error('Invalid JSON')); }
    });
  });
}

function entitiesCollection() {
  try {
    return (globalThis.koad && globalThis.koad.library && globalThis.koad.library.entities) || null;
  } catch (_err) {
    return null;
  }
}

WebApp.connectHandlers.use('/api/entities/touch', async (req, res) => {
  const send = (status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(`${JSON.stringify(data, null, 2)}\n`);
  };

  if (req.method !== 'POST') {
    return send(405, { error: 'method_not_allowed', message: 'POST /api/entities/touch { handle }' });
  }
  if (!fromMesh(req)) {
    return send(403, {
      error: 'not_here',
      message: 'entity activity is published on the kingdom mesh, not to the public',
    });
  }

  let body = {};
  try { body = await readJsonBody(req); }
  catch (err) { return send(400, { error: 'bad_json', message: err.message }); }

  const handle = str(body.handle);
  if (!handle || !HANDLE_RE.test(handle)) {
    return send(400, { error: 'handle_required', message: 'a bare entity handle, e.g. "sienna"' });
  }

  const Entities = entitiesCollection();
  if (!Entities) return send(503, { error: 'entity_index_unavailable', message: 'the entity index is not loaded yet' });

  const doc = Entities.findOne({ handle });
  if (!doc) return send(404, { error: 'unknown_entity', message: `no entity "${handle}" in this kingdom` });

  const now = Date.now();
  const previous = lastAccepted.get(handle) || 0;
  if (now - previous < THROTTLE_MS) {
    // Not an error: a caller refreshing faster than the window is doing the right
    // thing, it is just not a new fact. Say so rather than writing again.
    return send(200, {
      ok: true,
      handle,
      throttled: true,
      retry_after_ms: THROTTLE_MS - (now - previous),
      lastActivity: doc.lastActivity || null,
    });
  }

  const asof = new Date(now);
  // ONLY THE FIELDS THE CALLER SENT ARE WRITTEN. A refresh that carries no client
  // must not blank the client a connect-time touch recorded — presence is MERGED,
  // never replaced by a later, sparser call. (Observed 2026-11-12: the connect touch
  // wrote `client: Sesame`, a per-call refresh without it wrote `client: null` one
  // minute later, and the row lost the only field that says who is on the line.)
  const set = { lastActivity: asof, 'presence.at': asof };
  const door = str(body.door);
  const client = str(body.client);
  const session = str(body.session);
  if (door) set['presence.door'] = door;
  if (client) set['presence.client'] = client;
  if (session) set['presence.session'] = session;

  try {
    Entities.update({ _id: doc._id }, { $set: set });
  } catch (err) {
    return send(500, { error: 'write_failed', message: err.message });
  }
  lastAccepted.set(handle, now);

  return send(200, {
    ok: true,
    handle,
    lastActivity: asof,
    presence: { door, client, session, at: asof },
  });
});

console.log(`[entity-touch] POST /api/entities/touch ready — mesh-only, lastActivity + presence, ${THROTTLE_MS}ms throttle`);
