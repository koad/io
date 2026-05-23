// channel-api.js — VESTA-SPEC-154 v2.3 + SPEC-156 channel HTTP endpoints
//
// Daemon-resident channel runtime. Replaces the retired dance-hall MCP channel surface.
// Built against the pi extension client at:
//   ~/.local/share/koad-io/harnesses/pi/extensions/koad-io/channels/client.ts
//
// Endpoints:
//   GET  /api/channels/:slug/state              — full channel state (moderator + entity)
//   POST /api/channels/:slug/leave               — entity leaves channel
//   POST /api/channels/:slug/hand                — entity raises hand
//   GET  /api/channels/:slug/cue/:entity/poll    — poll for pending cue
//   POST /api/channels/:slug/cue/deliver         — moderator grants floor
//   POST /api/channels/:slug/cue/broadcast       — broadcast new-event to all
//   GET  /api/channels/:slug/turns               — read turns from offset
//   POST /api/channels/:slug/event               — fire event after turn append
//
// Channel data on disk (~/.channels/):
//   ~/.channels/<slug>.jsonl                    — channel turns
//   ~/.channels/.members/<slug>/<entity>.json   — member presence
//   ~/.channels/.hands/<slug>.jsonl             — hand queue audit
//   ~/.channels/.offsets/<slug>/<entity>.offset — per-entity read offset
//   ~/.channels/.cues/<slug>/<entity>.pending   — fallback pending cue
//   ~/.channels/index.jsonl                     — channel index
//
// In-memory state (module-level):
//   _pendingCues[slug][entity]       — { resolve, reject, keepaliveTimer }
//   _handQueues[slug]                — [{ entity, raisedAt, intent }]
//   _autoPassTimers[slug]            — { timerId, armedAt, oldestHandRaisedAt }
//   _grantPending[slug]              — { entity, grantedAt } | null
//   _pendingTurnWaits[slug]          — [{ resolve, timeoutHandle, sinceCount }]
//   _pendingStateWaits[slug]         — [{ resolve, timeoutHandle, changeTypes }]

import { WebApp } from 'meteor/webapp';

const os = Npm.require('os');
const fs = Npm.require('fs');
const path = Npm.require('path');
const app = WebApp.connectHandlers;

const HOME          = os.homedir();
const CHANNELS_ROOT = path.join(HOME, '.channels');
const AUTO_PASS_TIMEOUT_SECONDS = 180;

// ---------------------------------------------------------------------------
// In-memory state
// ---------------------------------------------------------------------------
const _pendingCues        = Object.create(null);
const _handQueues         = Object.create(null);
const _autoPassTimers     = Object.create(null);
const _grantPending       = Object.create(null);
const _pendingTurnWaits   = Object.create(null);
const _pendingStateWaits  = Object.create(null);

// ---------------------------------------------------------------------------
// Helpers (mirror api.js pattern)
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

// Match exact path, stripping query string
function pathIs(req, target) {
  const url = req.originalUrl || req.url || '';
  const i = url.indexOf('?');
  const p = i === -1 ? url : url.slice(0, i);
  return p === target || p === target + '/';
}

// Simple slug validation: alphanumeric + hyphens + underscores
function validSlug(slug) {
  return typeof slug === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(slug);
}

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readJsonlAll(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8')
    .split('\n')
    .filter(l => l.trim())
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

function appendJsonl(filePath, record) {
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, JSON.stringify(record) + '\n', 'utf8');
}

// ---------------------------------------------------------------------------
// Channel file paths
// ---------------------------------------------------------------------------
function channelFile(slug)   { return path.join(CHANNELS_ROOT, `${slug}.jsonl`); }
function memberFile(slug, entity) { return path.join(CHANNELS_ROOT, '.members', slug, `${entity}.json`); }
function handsFile(slug)     { return path.join(CHANNELS_ROOT, '.hands', `${slug}.jsonl`); }
function offsetFile(slug, entity) { return path.join(CHANNELS_ROOT, '.offsets', slug, `${entity}.offset`); }
function pendingCueFile(slug, entity) { return path.join(CHANNELS_ROOT, '.cues', slug, `${entity}.pending`); }

function channelStatus(slug) {
  const indexFile = path.join(CHANNELS_ROOT, 'index.jsonl');
  const records = readJsonlAll(indexFile).filter(r => r && r.slug === slug);
  return records.length ? records[records.length - 1] : null;
}

function channelTurnCount(slug) {
  const f = channelFile(slug);
  if (!fs.existsSync(f)) return 0;
  return fs.readFileSync(f, 'utf8').split('\n').filter(l => l.trim()).length;
}

function readTurnsFrom(slug, fromOffset) {
  const f = channelFile(slug);
  if (!fs.existsSync(f)) return [];
  const lines = fs.readFileSync(f, 'utf8').split('\n').filter(l => l.trim());
  const slice = lines.slice(fromOffset);
  return slice.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

function readOffset(slug, entity) {
  const f = offsetFile(slug, entity);
  if (!fs.existsSync(f)) return 0;
  const v = parseInt(fs.readFileSync(f, 'utf8').trim(), 10);
  return isNaN(v) ? 0 : v;
}

function writeOffset(slug, entity, value) {
  const f = offsetFile(slug, entity);
  ensureDir(path.dirname(f));
  fs.writeFileSync(f, String(value), 'utf8');
}

function getMember(slug, entity) {
  const f = memberFile(slug, entity);
  if (!fs.existsSync(f)) return null;
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; }
}

function getPresentMembers(slug) {
  const membersDir = path.join(CHANNELS_ROOT, '.members', slug);
  if (!fs.existsSync(membersDir)) return [];
  return fs.readdirSync(membersDir)
    .filter(f => f.endsWith('.json'))
    .map(f => { try { return JSON.parse(fs.readFileSync(path.join(membersDir, f), 'utf8')); } catch { return null; } })
    .filter(m => m && m.status === 'present');
}

function getAllMembers(slug) {
  const membersDir = path.join(CHANNELS_ROOT, '.members', slug);
  if (!fs.existsSync(membersDir)) return [];
  return fs.readdirSync(membersDir)
    .filter(f => f.endsWith('.json'))
    .map(f => { try { return JSON.parse(fs.readFileSync(path.join(membersDir, f), 'utf8')); } catch { return null; } })
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Hand queue helpers
// ---------------------------------------------------------------------------
function addHand(slug, entity, intent) {
  if (!_handQueues[slug]) _handQueues[slug] = [];
  // Remove any existing hand from this entity (re-raise replaces)
  _handQueues[slug] = _handQueues[slug].filter(h => h.entity !== entity);
  const hand = {
    entity,
    channel: slug,
    raisedAt: new Date().toISOString(),
    ...(intent ? { intent } : {}),
  };
  _handQueues[slug].push(hand);

  // Append to audit log
  appendJsonl(handsFile(slug), { ...hand, event: 'raised' });

  // Arm auto-pass timer if not already armed
  _armAutoPassTimer(slug);

  // Fire state-change event
  _fireStateChange(slug, 'hand_raised', entity);

  return { position: _handQueues[slug].length };
}

function removeHand(slug, entity) {
  if (!_handQueues[slug]) return false;
  const before = _handQueues[slug].length;
  _handQueues[slug] = _handQueues[slug].filter(h => h.entity !== entity);
  const removed = _handQueues[slug].length < before;

  if (removed && _handQueues[slug].length === 0) {
    _disarmAutoPassTimer(slug);
  }

  if (removed) {
    _fireStateChange(slug, 'hand_cleared', entity);
  }

  return removed;
}

// ---------------------------------------------------------------------------
// Cue construction
// ---------------------------------------------------------------------------
function _buildCue(slug, entity, trigger, opts = {}) {
  const now = new Date().toISOString();
  const lastOffset = readOffset(slug, entity);
  const currentCount = channelTurnCount(slug);
  const newTurns = currentCount > lastOffset
    ? readTurnsFrom(slug, lastOffset)
    : [];

  // Update offset to current
  writeOffset(slug, entity, currentCount);

  const handQueue = (_handQueues[slug] || []);
  const myPos = handQueue.findIndex(h => h.entity === entity);

  // Update member's lastCueAt
  const mf = memberFile(slug, entity);
  if (fs.existsSync(mf)) {
    try {
      const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
      m.lastCueAt = now;
      fs.writeFileSync(mf, JSON.stringify(m, null, 2), 'utf8');
    } catch { /* non-critical */ }
  }

  const cue = {
    trigger,
    channel: slug,
    deliveredAt: now,
    newTurns,
    newTurnCount: newTurns.length,
    offsetAtCue: currentCount,
    queuedHands: handQueue.map(h => h.entity),
    yourPosition: myPos >= 0 ? myPos + 1 : null,
    yourTurn: opts.yourTurn || false,
  };

  if (opts.junoNote) cue.junoNote = opts.junoNote;

  return cue;
}

function _writePendingCue(slug, entity, trigger, opts = {}) {
  const cueFile = pendingCueFile(slug, entity);
  ensureDir(path.dirname(cueFile));
  const cue = {
    trigger,
    channel: slug,
    deliveredAt: new Date().toISOString(),
    newTurns: [],
    newTurnCount: 0,
    queuedHands: (_handQueues[slug] || []).map(h => h.entity),
    yourPosition: null,
    yourTurn: opts.yourTurn || false,
  };
  if (opts.junoNote) cue.junoNote = opts.junoNote;
  fs.writeFileSync(cueFile, JSON.stringify(cue), 'utf8');
}

// ---------------------------------------------------------------------------
// Cue delivery
// ---------------------------------------------------------------------------
function _deliverCuePoll(slug, entity, trigger, opts = {}) {
  const slugMap = _pendingCues[slug];
  if (!slugMap) return false;
  const pending = slugMap[entity];
  if (!pending) return false;

  clearTimeout(pending.keepaliveTimer);
  delete slugMap[entity];

  const cue = _buildCue(slug, entity, trigger, opts);
  pending.resolve(cue);
  return true;
}

// Unified delivery (poll only for now; SSE to be added when channel-stream.js is ready)
function _deliverCue(slug, entity, trigger, opts = {}) {
  const delivered = _deliverCuePoll(slug, entity, trigger, opts);

  // Fire floor_granted state-change for your-turn deliveries
  if (delivered && trigger === 'your-turn') {
    _fireStateChange(slug, 'floor_granted', entity);
  }
  return delivered;
}

// Broadcast to all entities waiting on a channel
function _broadcastCue(slug, trigger, opts = {}) {
  const slugMap = _pendingCues[slug];
  let count = 0;
  if (slugMap) {
    const entities = Object.keys(slugMap);
    for (const entity of entities) {
      if (_deliverCuePoll(slug, entity, trigger, opts)) count++;
    }
  }
  return count;
}

function _resolveAllPendingCuesChannelClosed(slug) {
  const slugMap = _pendingCues[slug];
  if (slugMap) {
    for (const entity of Object.keys(slugMap)) {
      _deliverCuePoll(slug, entity, 'channel-closed');
    }
  }
}

// ---------------------------------------------------------------------------
// Turn-waiter resolution
// ---------------------------------------------------------------------------
function _resolveTurnWaiters(slug) {
  const waiters = _pendingTurnWaits[slug];
  if (!waiters || !waiters.length) return;

  const currentCount = channelTurnCount(slug);
  const remaining = [];
  for (const waiter of waiters) {
    if (currentCount > waiter.sinceCount) {
      clearTimeout(waiter.timeoutHandle);
      const newTurns = readTurnsFrom(slug, waiter.sinceCount);
      const lastTurn = newTurns.length ? newTurns[newTurns.length - 1] : null;
      waiter.resolve({
        trigger: 'new-turn',
        channel: slug,
        resolvedAt: new Date().toISOString(),
        turns: newTurns,
        lastTurnId: lastTurn ? lastTurn.turnId : null,
      });
    } else {
      remaining.push(waiter);
    }
  }
  _pendingTurnWaits[slug] = remaining;
}

function _resolveAllTurnWaitersChannelClosed(slug) {
  const waiters = _pendingTurnWaits[slug];
  if (!waiters || !waiters.length) return;
  for (const waiter of waiters) {
    clearTimeout(waiter.timeoutHandle);
    waiter.resolve({
      trigger: 'channel-closed',
      channel: slug,
      resolvedAt: new Date().toISOString(),
      turns: [],
      lastTurnId: null,
    });
  }
  delete _pendingTurnWaits[slug];
}

// ---------------------------------------------------------------------------
// State-change waiter resolution
// ---------------------------------------------------------------------------
function _buildSnapshot(slug) {
  const meta = channelStatus(slug) || { slug, status: 'open' };
  const allMembers = getAllMembers(slug);
  const handQueue = _handQueues[slug] || [];
  const totalCount = channelTurnCount(slug);

  const timerState = _autoPassTimers[slug];
  let autoPassTimer;
  if (timerState && handQueue.length > 0) {
    const elapsedMs = Date.now() - new Date(timerState.oldestHandRaisedAt).getTime();
    const secondsRemaining = Math.max(0, AUTO_PASS_TIMEOUT_SECONDS - Math.floor(elapsedMs / 1000));
    autoPassTimer = {
      armed: true,
      oldestHandRaisedAt: timerState.oldestHandRaisedAt,
      secondsRemaining,
      timeoutSeconds: AUTO_PASS_TIMEOUT_SECONDS,
    };
  } else {
    autoPassTimer = {
      armed: false,
      oldestHandRaisedAt: null,
      secondsRemaining: null,
      timeoutSeconds: AUTO_PASS_TIMEOUT_SECONDS,
    };
  }

  return {
    channel: slug,
    status: meta.status || 'open',
    members: allMembers,
    raisedHands: handQueue,
    turnCount: totalCount,
    autoPassTimer,
  };
}

function _fireStateChange(slug, changeType, entity = null) {
  const waiters = _pendingStateWaits[slug];
  if (!waiters || !waiters.length) return;

  const ts = new Date().toISOString();
  const remaining = [];
  for (const waiter of waiters) {
    const matchesFilter = !waiter.changeTypes || waiter.changeTypes.includes(changeType);
    if (matchesFilter) {
      clearTimeout(waiter.timeoutHandle);
      waiter.resolve({
        trigger: 'state-change',
        change_type: changeType,
        channel: slug,
        entity,
        ts,
        snapshot: _buildSnapshot(slug),
      });
    } else {
      remaining.push(waiter);
    }
  }
  _pendingStateWaits[slug] = remaining;
}

function _resolveAllStateWaitersChannelClosed(slug) {
  const waiters = _pendingStateWaits[slug];
  if (!waiters || !waiters.length) return;
  const ts = new Date().toISOString();
  for (const waiter of waiters) {
    clearTimeout(waiter.timeoutHandle);
    waiter.resolve({
      trigger: 'state-change',
      change_type: 'channel_closed',
      channel: slug,
      entity: null,
      ts,
      snapshot: _buildSnapshot(slug),
    });
  }
  delete _pendingStateWaits[slug];
}

// ---------------------------------------------------------------------------
// Auto-pass timer machinery
// ---------------------------------------------------------------------------
function _disarmAutoPassTimer(slug) {
  const t = _autoPassTimers[slug];
  if (t) {
    clearTimeout(t.timerId);
    delete _autoPassTimers[slug];
  }
}

function _armAutoPassTimer(slug, opts = {}) {
  const queue = _handQueues[slug];
  if (!queue || !queue.length) return;

  if (_autoPassTimers[slug] && !opts.force) return;

  if (_autoPassTimers[slug]) {
    clearTimeout(_autoPassTimers[slug].timerId);
    delete _autoPassTimers[slug];
  }

  const oldest = queue[0];
  const oldestMs = new Date(oldest.raisedAt).getTime();
  const now = Date.now();
  const elapsed = Math.max(0, now - oldestMs);
  const delayMs = Math.max(0, AUTO_PASS_TIMEOUT_SECONDS * 1000 - elapsed);

  const timerId = setTimeout(() => {
    _onAutoPassExpiry(slug);
  }, delayMs);

  _autoPassTimers[slug] = {
    timerId,
    armedAt: new Date().toISOString(),
    oldestHandRaisedAt: oldest.raisedAt,
  };
}

async function _onAutoPassExpiry(slug) {
  delete _autoPassTimers[slug];

  const queue = _handQueues[slug];
  if (!queue || !queue.length) return;

  let delivered = false;
  while ((_handQueues[slug] || []).length > 0) {
    const hand = _handQueues[slug][0];
    const { entity, raisedAt } = hand;
    const nowIso = new Date().toISOString();

    const member = getMember(slug, entity);
    const isPresent = member && member.status === 'present';

    if (!isPresent) {
      _handQueues[slug].shift();
      appendJsonl(handsFile(slug), {
        event: 'auto-pass-skipped',
        channel: slug, entity, raisedAt,
        skippedAt: nowIso, reason: 'absent',
      });
      continue;
    }

    const ok = _deliverCue(slug, entity, 'your-turn', { yourTurn: true });
    if (!ok) {
      // Fallback: write pending file
      _writePendingCue(slug, entity, 'your-turn', { yourTurn: true });
      _grantPending[slug] = { entity, grantedAt: nowIso, viaPendingFile: true };
      appendJsonl(handsFile(slug), {
        event: 'auto-pass-pending-fallback',
        channel: slug, entity, raisedAt,
        pendingAt: nowIso, reason: 'mcp-miss-mid-cycle',
      });
      delivered = true;
      break;
    }

    _handQueues[slug].shift();
    _grantPending[slug] = { entity, grantedAt: nowIso };

    appendJsonl(handsFile(slug), {
      event: 'auto-passed',
      channel: slug, entity, raisedAt,
      autoPassedAt: nowIso, queuePosition: 1,
      timeoutSeconds: AUTO_PASS_TIMEOUT_SECONDS,
    });

    _fireStateChange(slug, 'auto_passed', entity);
    delivered = true;
    break;
  }

  const remaining = _handQueues[slug] || [];
  if (remaining.length > 0) {
    _armAutoPassTimer(slug, { force: true });
  }

  if (!delivered && !remaining.length) {
    _disarmAutoPassTimer(slug);
  }
}

// ---------------------------------------------------------------------------
// OPTIONS preflight for all /api/channels routes
// ---------------------------------------------------------------------------
app.use('/api/channels', (req, res, next) => {
  if (req.method !== 'OPTIONS') return next();
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.writeHead(204);
  res.end();
});

// ===========================================================================
// GET /api/channels/:slug/state — full channel state
// ===========================================================================
app.use('/api/channels', async (req, res, next) => {
  if (req.method !== 'GET') return next();

  const url = req.originalUrl || req.url || '';
  const m = url.match(/^\/api\/channels\/([^/?]+)\/state/);
  if (!m) return next();

  const slug = decodeURIComponent(m[1]);
  if (!validSlug(slug)) return jsonErr(res, 400, 'Invalid channel slug');

  if (!fs.existsSync(channelFile(slug))) {
    return jsonErr(res, 404, `Channel '${slug}' not found`);
  }

  try {
    const q = parseQuery(url);
    const meta = channelStatus(slug) || { slug, status: 'open' };
    const totalCount = channelTurnCount(slug);
    const allMembers = getAllMembers(slug);
    const handQueue = _handQueues[slug] || [];

    // Recent turns
    let fromOffset;
    const turnsFromParam = q.turns_from !== undefined ? parseInt(q.turns_from, 10) : null;
    if (turnsFromParam !== null && !isNaN(turnsFromParam)) {
      fromOffset = turnsFromParam;
    } else {
      fromOffset = Math.max(0, totalCount - 20);
    }
    const recentTurns = readTurnsFrom(slug, fromOffset);

    // Auto-pass timer state
    const timerState = _autoPassTimers[slug];
    let autoPassTimer;
    if (timerState && handQueue.length > 0) {
      const elapsedMs = Date.now() - new Date(timerState.oldestHandRaisedAt).getTime();
      const secRemaining = Math.max(0, AUTO_PASS_TIMEOUT_SECONDS - Math.floor(elapsedMs / 1000));
      autoPassTimer = {
        armed: true,
        oldestHandRaisedAt: timerState.oldestHandRaisedAt,
        secondsRemaining: secRemaining,
        timeoutSeconds: AUTO_PASS_TIMEOUT_SECONDS,
      };
    } else {
      autoPassTimer = {
        armed: false,
        oldestHandRaisedAt: null,
        secondsRemaining: null,
        timeoutSeconds: AUTO_PASS_TIMEOUT_SECONDS,
      };
    }

    const result = {
      channel: slug,
      status: meta.status || 'open',
      mode: meta.mode || 'closed',
      topic: meta.topic || '',
      members: allMembers,
      raisedHands: handQueue,
      recentTurns,
      turnCount: totalCount,
      pendingWaits: Object.keys(_pendingCues[slug] || {}),
      sseStreams: {},
      autoPassTimer,
      grantPending: _grantPending[slug] || null,
    };

    // Attach branch metadata when present
    const extensions = meta.extensions || {};
    if (extensions.branch) result.branch = extensions.branch;
    if (extensions.branches && extensions.branches.length > 0) result.branches = extensions.branches;

    jsonOk(res, result);
  } catch (err) {
    console.error('[API/channels/state] error:', err.message);
    jsonErr(res, 500, err.message);
  }
});

// ===========================================================================
// POST /api/channels/:slug/leave — entity leaves channel
// ===========================================================================
app.use('/api/channels', async (req, res, next) => {
  if (req.method !== 'POST') return next();

  const url = req.originalUrl || req.url || '';
  const m = url.match(/^\/api\/channels\/([^/?]+)\/leave/);
  if (!m) return next();

  const slug = decodeURIComponent(m[1]);
  if (!validSlug(slug)) return jsonErr(res, 400, 'Invalid channel slug');

  try {
    const body = req.body || {};
    const { entity, reason } = body;

    if (!entity || typeof entity !== 'string') {
      return jsonErr(res, 400, 'entity field required');
    }

    // Cancel any pending wait
    if (_pendingCues[slug] && _pendingCues[slug][entity]) {
      clearTimeout(_pendingCues[slug][entity].keepaliveTimer);
      delete _pendingCues[slug][entity];
    }

    // Remove from hand queue
    removeHand(slug, entity);

    // Release grant if entity held floor
    if (_grantPending[slug] && _grantPending[slug].entity === entity) {
      delete _grantPending[slug];
    }

    // Update member sidecar
    const mf = memberFile(slug, entity);
    if (fs.existsSync(mf)) {
      try {
        const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
        m.status = 'absent';
        if (reason) m.leaveReason = reason;
        fs.writeFileSync(mf, JSON.stringify(m, null, 2), 'utf8');
      } catch { /* non-critical */ }
    }

    // Fire state-change
    _fireStateChange(slug, 'member_left', entity);

    jsonOk(res, { left: true, channel: slug, entity });
  } catch (err) {
    console.error('[API/channels/leave] error:', err.message);
    jsonErr(res, 500, err.message);
  }
});

// ===========================================================================
// POST /api/channels/:slug/hand — raise hand
// ===========================================================================
app.use('/api/channels', async (req, res, next) => {
  if (req.method !== 'POST') return next();

  const url = req.originalUrl || req.url || '';
  const m = url.match(/^\/api\/channels\/([^/?]+)\/hand/);
  if (!m) return next();

  const slug = decodeURIComponent(m[1]);
  if (!validSlug(slug)) return jsonErr(res, 400, 'Invalid channel slug');

  if (!fs.existsSync(channelFile(slug))) {
    return jsonErr(res, 404, `Channel '${slug}' not found`);
  }

  try {
    const body = req.body || {};
    const { entity, intent } = body;

    if (!entity || typeof entity !== 'string') {
      return jsonErr(res, 400, 'entity field required');
    }

    const { position } = addHand(slug, entity, intent);
    const queueLength = (_handQueues[slug] || []).length;

    // Deliver hand-acknowledged targeted cue if entity is waiting
    _deliverCue(slug, entity, 'hand-acknowledged');

    jsonOk(res, {
      acknowledged: true,
      channel: slug,
      entity,
      queuePosition: position,
      queueLength,
    });
  } catch (err) {
    console.error('[API/channels/hand] error:', err.message);
    jsonErr(res, 500, err.message);
  }
});

// ===========================================================================
// GET /api/channels/:slug/cue/:entity/poll — poll for pending cue
// ===========================================================================
app.use('/api/channels', async (req, res, next) => {
  if (req.method !== 'GET') return next();

  const url = req.originalUrl || req.url || '';
  const m = url.match(/^\/api\/channels\/([^/?]+)\/cue\/([^/?]+)\/poll/);
  if (!m) return next();

  const slug = decodeURIComponent(m[1]);
  const entity = decodeURIComponent(m[2]);

  if (!validSlug(slug)) return jsonErr(res, 400, 'Invalid channel slug');
  if (!entity || typeof entity !== 'string') return jsonErr(res, 400, 'Missing entity');

  if (!fs.existsSync(channelFile(slug))) {
    return jsonErr(res, 404, `Channel '${slug}' not found`);
  }

  try {
    // Check for pending .pending file first (fallback from previous delivery)
    const pf = pendingCueFile(slug, entity);
    if (fs.existsSync(pf)) {
      try {
        const cue = JSON.parse(fs.readFileSync(pf, 'utf8'));
        // Clear the file after reading
        fs.unlinkSync(pf);
        return jsonOk(res, cue);
      } catch { /* proceed to poll path */ }
    }

    // No pending file — return null cue
    jsonOk(res, null);
  } catch (err) {
    console.error('[API/channels/cue/poll] error:', err.message);
    jsonErr(res, 500, err.message);
  }
});

// Actually, poll-for-cue is meant for the long-poll case too. Let me re-read the client:
// client.ts: pollForCue calls GET /api/channels/:slug/cue/:entity/poll
// The pi extension wait_for_cue tool uses this as the "poll transport" path.
// That means this endpoint needs to support long-polling (block until cue arrives).
// But wait — the current pi extension is calling this as a one-shot GET, not a long-poll.
// The long-poll semantics live inside the MCP tool handler in the pi extension.
//
// For the API layer, we provide two things:
// 1. A one-shot check: GET /api/channels/:slug/cue/:entity/poll — return pending cue or null
// 2. The long-poll mechanism uses _pendingCues in-memory state which is resolved by
//    _deliverCuePoll when a cue arrives. The MCP tool's wait_for_cue creates a promise
//    that blocks and this endpoint is only used as a fallback (pending file).
//
// So the above implementation is correct: check .pending file, return null if none.

// ===========================================================================
// POST /api/channels/:slug/cue/deliver — moderator grants floor
// ===========================================================================
app.use('/api/channels', async (req, res, next) => {
  if (req.method !== 'POST') return next();

  const url = req.originalUrl || req.url || '';
  const m = url.match(/^\/api\/channels\/([^/?]+)\/cue\/deliver/);
  if (!m) return next();

  const slug = decodeURIComponent(m[1]);
  if (!validSlug(slug)) return jsonErr(res, 400, 'Invalid channel slug');

  if (!fs.existsSync(channelFile(slug))) {
    return jsonErr(res, 404, `Channel '${slug}' not found`);
  }

  try {
    const body = req.body || {};
    const { entity, juno_note } = body;

    if (!entity || typeof entity !== 'string') {
      return jsonErr(res, 400, 'entity field required');
    }

    // Remove from hand queue if present
    const wasInQueue = removeHand(slug, entity);

    // Moderator action — disarm auto-pass timer
    _disarmAutoPassTimer(slug);

    // Deliver targeted your-turn cue
    const delivered = _deliverCue(slug, entity, 'your-turn', {
      yourTurn: true,
      ...(juno_note ? { junoNote: juno_note } : {}),
    });

    if (!delivered) {
      // Entity not reachable — write pending file fallback
      _writePendingCue(slug, entity, 'your-turn', {
        yourTurn: true,
        ...(juno_note ? { junoNote: juno_note } : {}),
      });

      // Re-arm timer if remaining hands
      if ((_handQueues[slug] || []).length > 0) _armAutoPassTimer(slug);

      return jsonOk(res, {
        delivered: false,
        channel: slug,
        entity,
        removedFromQueue: wasInQueue,
        note: 'Entity not currently reachable via poll — cue written to pending file.',
      });
    }

    // Set advisory grantPending
    _grantPending[slug] = { entity, grantedAt: new Date().toISOString() };

    // Re-arm from remaining hands
    if ((_handQueues[slug] || []).length > 0) _armAutoPassTimer(slug);

    jsonOk(res, {
      delivered: true,
      channel: slug,
      entity,
      removedFromQueue: wasInQueue,
    });
  } catch (err) {
    console.error('[API/channels/cue/deliver] error:', err.message);
    jsonErr(res, 500, err.message);
  }
});

// ===========================================================================
// POST /api/channels/:slug/cue/broadcast — broadcast to all
// ===========================================================================
app.use('/api/channels', async (req, res, next) => {
  if (req.method !== 'POST') return next();

  const url = req.originalUrl || req.url || '';
  const m = url.match(/^\/api\/channels\/([^/?]+)\/cue\/broadcast/);
  if (!m) return next();

  const slug = decodeURIComponent(m[1]);
  if (!validSlug(slug)) return jsonErr(res, 400, 'Invalid channel slug');

  if (!fs.existsSync(channelFile(slug))) {
    return jsonErr(res, 404, `Channel '${slug}' not found`);
  }

  try {
    const body = req.body || {};
    const { reason } = body;

    // Moderator action — disarm auto-pass timer
    _disarmAutoPassTimer(slug);

    const count = _broadcastCue(slug, 'new-event');

    if (reason) {
      appendJsonl(handsFile(slug), {
        event: 'broadcast',
        channel: slug,
        ts: new Date().toISOString(),
        reason,
        notified: count,
      });
    }

    // Re-arm if hands remain
    if ((_handQueues[slug] || []).length > 0) _armAutoPassTimer(slug);

    jsonOk(res, { broadcast: true, channel: slug, memberCount: count });
  } catch (err) {
    console.error('[API/channels/cue/broadcast] error:', err.message);
    jsonErr(res, 500, err.message);
  }
});

// ===========================================================================
// GET /api/channels/:slug/turns — read turns from offset
// ===========================================================================
app.use('/api/channels', async (req, res, next) => {
  if (req.method !== 'GET') return next();

  const url = req.originalUrl || req.url || '';
  const m = url.match(/^\/api\/channels\/([^/?]+)\/turns/);
  if (!m) return next();

  const slug = decodeURIComponent(m[1]);
  if (!validSlug(slug)) return jsonErr(res, 400, 'Invalid channel slug');

  if (!fs.existsSync(channelFile(slug))) {
    return jsonErr(res, 404, `Channel '${slug}' not found`);
  }

  try {
    const q = parseQuery(url);
    const currentCount = channelTurnCount(slug);
    const sinceCountParam = q.since_count !== undefined ? parseInt(q.since_count, 10) : null;
    const sinceTurnId = q.since_turn_id || null;

    let sinceCount;
    if (sinceTurnId) {
      // Parse the sequence number from turnId (e.g. "design-0012" → 12)
      const allTurns = readJsonlAll(channelFile(slug));
      const idx = allTurns.findIndex(t => t && t.turnId === sinceTurnId);
      sinceCount = idx >= 0 ? idx + 1 : allTurns.length;
    } else if (sinceCountParam !== null && !isNaN(sinceCountParam)) {
      sinceCount = sinceCountParam;
    } else {
      sinceCount = currentCount;
    }

    const turns = sinceCount < currentCount
      ? readTurnsFrom(slug, sinceCount)
      : [];

    jsonOk(res, { turns, currentCount });
  } catch (err) {
    console.error('[API/channels/turns] error:', err.message);
    jsonErr(res, 500, err.message);
  }
});

// ===========================================================================
// POST /api/channels/:slug/event — fire event after turn append
// ===========================================================================
app.use('/api/channels', async (req, res, next) => {
  if (req.method !== 'POST') return next();

  const url = req.originalUrl || req.url || '';
  const m = url.match(/^\/api\/channels\/([^/?]+)\/event/);
  if (!m) return next();

  const slug = decodeURIComponent(m[1]);
  if (!validSlug(slug)) return jsonErr(res, 400, 'Invalid channel slug');

  try {
    const body = req.body || {};
    const { event_type = 'new-event', entity, addressee } = body;

    // Handle member join/leave events — fire state-change waiters, no cue delivery
    if (event_type === 'member_joined') {
      _fireStateChange(slug, 'member_joined', entity || null);
      return jsonOk(res, { fired: true, channel: slug, eventType: event_type });
    }
    if (event_type === 'member_left') {
      _fireStateChange(slug, 'member_left', entity || null);
      return jsonOk(res, { fired: true, channel: slug, eventType: event_type });
    }

    // Clear advisory grantPending when granted entity appends
    const gp = _grantPending[slug];
    if (gp) {
      if (!entity || gp.entity === entity) {
        delete _grantPending[slug];
      }
    }

    // Conch-pass: if addressee is set, attempt floor transfer before broadcast
    let conchPassResult = null;
    if (addressee && addressee !== entity && event_type === 'new-event') {
      const nowIso = new Date().toISOString();
      const member = getMember(slug, addressee);

      if (!member) {
        conchPassResult = { skipped: true, reason: 'not_member' };
      } else if (member.status !== 'present') {
        conchPassResult = { skipped: true, reason: 'absent' };
      } else {
        const delivered = _deliverCue(slug, addressee, 'your-turn', {
          yourTurn: true,
          junoNote: `conch passed by ${entity || 'operator'}`,
        });

        if (delivered) {
          _grantPending[slug] = { entity: addressee, grantedAt: nowIso, viaConchPass: true, from: entity };
          conchPassResult = { passed: true, delivered: true };
        } else {
          _writePendingCue(slug, addressee, 'your-turn', {
            yourTurn: true,
            junoNote: `conch passed by ${entity || 'operator'}`,
          });
          _grantPending[slug] = { entity: addressee, grantedAt: nowIso, viaConchPass: true, viaPendingFile: true, from: entity };
          conchPassResult = { passed: true, delivered: false, viaPendingFile: true };
        }
      }
    }

    // Fire channel event (broadcast new-event or channel-closed to waiters)
    if (event_type === 'channel-closed') {
      _resolveAllPendingCuesChannelClosed(slug);
      _resolveAllTurnWaitersChannelClosed(slug);
      _resolveAllStateWaitersChannelClosed(slug);
    } else {
      _broadcastCue(slug, 'new-event');
      _resolveTurnWaiters(slug);
    }

    const result = { fired: true, channel: slug, eventType: event_type };
    if (conchPassResult) result.conchPass = conchPassResult;
    jsonOk(res, result);
  } catch (err) {
    console.error('[API/channels/event] error:', err.message);
    jsonErr(res, 500, err.message);
  }
});

// Export for potential external use (e.g., cleanup on transport close)
export {
  _pendingCues,
  _handQueues,
  _autoPassTimers,
  _grantPending,
  _pendingTurnWaits,
  _pendingStateWaits,
};
