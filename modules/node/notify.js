// notify.js — the channel, the cursor, the wake. One primitive, three positions.
//
// A channel is an append-only JSONL file under `$RUNTIME/notify/`. A session
// subscribes to it (and thereby publishes presence), anyone with a reason may
// append an event, and a message relayed to a listening session is just another
// event on the same channel — no second mechanism, no second cursor.
//
// WHY THIS LIVES IN @koad-io/node
// Two sides need the identical rules, and they are in different repos: the
// harness tool (`~/.forge/harness/extension/tools/notify.ts`, an ESM import of
// this file) and the door at mcp.koad.sh (`@koad-io/node/notify`, symlinked from
// its node_modules). Two copies of "what counts as fresh" or "which line is the
// cursor" would drift, and the drift would be invisible until a re-delivered
// decision or a ghost listener showed up in a call. So the rules live here once.
//
// ── THE FIVE PROPERTIES (each one was bought with a bug we have already paid for)
//
// 1. CURSOR, NOT POLLING. A reader passes the id of the last event it handled
//    and receives only what came after it. Order is FILE ORDER, never id
//    comparison: two writers on two machines do not share a clock, and a cursor
//    that sorts by timestamp will eventually skip or replay. Re-delivering a
//    decision is worse than missing one — it invites the same decision twice
//    into the same record — so an id the file does not contain returns NOTHING
//    plus `cursor_unknown: true`, never a replay from the top.
//
// 2. A TORN WRITE MUST NOT POISON THE CHANNEL. A line is complete only when it
//    ends in a newline. All writers append exactly one `\n`-terminated line per
//    event; a crash mid-write leaves a tail without one, and this reader drops
//    it (and says so in `partial_bytes`/`invalid_lines`) rather than parsing it.
//
// 3. BOUNDED PAYLOAD. Every event carries ids and a one-line summary. A summary
//    over SUMMARY_MAX is clipped and the TRUE length is stated next to it. This
//    text lands in a model's context and possibly in a transcript: a
//    notification channel that carries prose is a publication surface wearing a
//    different hat.
//
// 4. ATTRIBUTION. `by` (who caused it) and `via` (through what) are on every
//    event. A wake that cannot say where it came from cannot be acted on.
//
// 5. PRESENCE EXPIRES. A session that has stopped listening must not read as
//    listening. `$RUNTIME/presence/<entity>.json` holds one entry per session
//    and an entry is `listening` only while it has been refreshed inside
//    PRESENCE_FRESH_MS (the same five minutes the board calls fresh). After
//    that it is `last-seen` with an age — never a greyed-out "listening".
//
// Written for the notify_subscribe / presence / relay flight, 2026-11-07.

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// ── the rules, in one place ─────────────────────────────────────────────────

/** The five-minute freshness rule, used for presence by every reader. */
export const PRESENCE_FRESH_MS = 5 * 60 * 1000;

/** How long an expired presence entry is kept so a reader can say "12m ago". */
export const PRESENCE_PRUNE_MS = 24 * 60 * 60 * 1000;

/** One line, never a document. 400 chars arrives clipped, with the true length. */
export const SUMMARY_MAX = 240;

/** Relay throttle: a burst of three, then one per minute. */
export const RELAY_BURST = 3;
export const RELAY_REFILL_MS = 60 * 1000;

export const CHANNELS = Object.freeze(['triage', 'questions']);

const CHANNEL_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const ENTITY_RE = /^[a-z0-9][a-z0-9_.-]{0,63}$/;

// ── paths ───────────────────────────────────────────────────────────────────

export function runtimePath() {
  return process.env.KOAD_IO_RUNTIME_PATH
    || path.join(os.homedir(), '.local', 'share', 'koad-io', 'runtime');
}

export function notifyDir() {
  return path.join(runtimePath(), 'notify');
}

export function presenceDir() {
  return path.join(runtimePath(), 'presence');
}

export function channelPath(channel) {
  assertChannel(channel);
  return path.join(notifyDir(), `${channel}.jsonl`);
}

export function presencePath(entity) {
  assertEntity(entity);
  return path.join(presenceDir(), `${entity}.json`);
}

function assertChannel(channel) {
  if (!CHANNEL_RE.test(String(channel || ''))) {
    throw new Error(`invalid channel name: ${JSON.stringify(channel)} — expected /${CHANNEL_RE.source}/`);
  }
}

function assertEntity(entity) {
  if (!ENTITY_RE.test(String(entity || ''))) {
    throw new Error(`invalid entity name: ${JSON.stringify(entity)}`);
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

// ── events ──────────────────────────────────────────────────────────────────

/**
 * A short, unique id. Uniqueness is the only property the cursor needs: the
 * reader locates the id in FILE ORDER, so nothing sorts by it and no clock
 * agreement between writers is implied.
 */
export function newEventId(atMs = Date.now()) {
  return `${Number(atMs).toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * Clip a summary to one line, at most SUMMARY_MAX chars.
 * The caller gets the text AND the truth about it — a clipped summary that
 * reports its own original length can be described honestly in a transcript.
 */
export function clipSummary(value) {
  const raw = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  const length = raw.length;
  if (length <= SUMMARY_MAX) return { summary: raw, summary_length: length, summary_truncated: false };
  return {
    summary: raw.slice(0, SUMMARY_MAX),
    summary_length: length,
    summary_truncated: true,
  };
}

/**
 * Append one event to a channel. Returns the stored record (with its id).
 *
 * Exactly one write of exactly one newline-terminated line: O_APPEND keeps two
 * writers from interleaving inside a line, and the trailing newline is what
 * makes the line complete for every reader.
 */
export function appendEvent(channel, input = {}) {
  const at = input.at || new Date().toISOString();
  const atMs = Date.parse(at);
  const clipped = clipSummary(input.summary);
  const event = {
    id: input.id || newEventId(Number.isFinite(atMs) ? atMs : Date.now()),
    at,
    type: String(input.type || 'event'),
    item: input.item == null ? null : String(input.item),
    by: input.by == null ? null : String(input.by),
    via: input.via == null ? null : String(input.via),
    ...clipped,
  };
  // Optional, additive, and absent when not supplied — readers must treat
  // absence as "not addressed", never invent a target.
  for (const key of ['to', 'to_session', 'ref', 'session']) {
    if (input[key] != null) event[key] = String(input[key]);
  }

  const file = channelPath(channel);
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, `${JSON.stringify(event)}\n`, { mode: 0o600 });
  return event;
}

/**
 * Read the complete events of a channel, optionally after a cursor.
 *
 * Returns:
 *   { events, cursor, cursor_unknown, partial_bytes, invalid_lines, total }
 *
 * - `cursor` is the id of the last event returned, or the `since` value passed
 *   in when nothing was new. With `since: '-'` (or omitted) everything is read.
 * - `cursor_unknown` is true when `since` was a real id the file does not
 *   contain (rotation, a new channel, a typo). Nothing is returned in that case:
 *   replaying a decision is the failure this discipline exists to prevent. The
 *   caller can reset deliberately with `since: '-'`.
 * - `partial_bytes` is the size of a trailing fragment with no newline — the
 *   signature of a writer killed mid-line. It is reported, never parsed.
 */
export function readEvents(channel, options = {}) {
  const file = channelPath(channel);
  const since = options.since == null ? '-' : String(options.since);
  const maxEvents = Math.max(0, Number(options.maxEvents ?? 0) || 0);

  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return { events: [], cursor: since === '-' ? null : since, cursor_unknown: false, partial_bytes: 0, invalid_lines: 0, total: 0 };
    }
    throw err;
  }

  const lines = text.split('\n');
  // `split` yields a final '' when the file ends in a newline. A non-empty final
  // element is an unterminated write: report its size, never parse it.
  const tail = lines.pop();
  const partial = tail === '' ? 0 : Buffer.byteLength(tail);
  if (tail !== '') lines.push(null); // keep the index but never parse it

  const parsed = [];
  let invalid = 0;
  lines.forEach((line, index) => {
    if (line === null) { parsed.push({ index, event: null, invalid: false, partial: true }); return; }
    if (!line.trim()) return;
    try {
      const event = JSON.parse(line);
      if (!event || typeof event !== 'object' || typeof event.id !== 'string') throw new Error('no id');
      parsed.push({ index, event, invalid: false, partial: false });
    } catch (_err) {
      invalid += 1;
      parsed.push({ index, event: null, invalid: true, partial: false });
    }
  });

  const complete = parsed.filter((row) => row.event);
  let start = 0;
  let cursorUnknown = false;
  if (since !== '-') {
    const at = complete.map((row) => row.event.id).lastIndexOf(since);
    if (at === -1) {
      cursorUnknown = true;
      start = complete.length; // nothing is after an id we cannot place
    } else {
      start = at + 1;
    }
  }

  const selected = complete.slice(start).map((row) => row.event);
  const events = maxEvents > 0 ? selected.slice(0, maxEvents) : selected;
  const cursor = events.length ? events[events.length - 1].id : (since === '-' ? null : since);

  return {
    events,
    cursor,
    cursor_unknown: cursorUnknown,
    partial_bytes: partial,
    invalid_lines: invalid,
    total: complete.length,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Block until at least one complete event arrives after `since`, or the idle
 * ceiling passes.
 *
 * `timed_out: true` with an empty `events` is the honest answer for silence: a
 * session must be able to decide to stay or leave, and a silent block is
 * indistinguishable from a wedge. Idleness costs one turn, not a spin.
 *
 * `onTick({result, elapsed_ms})` fires once per poll — the harness uses it to
 * refresh presence while it waits, so a listener with a 600s ceiling does not
 * go stale at minute five.
 */
export async function waitForEvents(channel, options = {}) {
  const maxWaitMs = Math.max(0, Number(options.maxWaitMs ?? 600_000) || 0);
  const pollMs = Math.min(Math.max(Number(options.pollMs ?? 400) || 400, 25), 5000);
  const startedAt = Date.now();

  for (;;) {
    const result = readEvents(channel, options);
    if (result.events.length) {
      return { ...result, timed_out: false, cancelled: false, waited_ms: Date.now() - startedAt };
    }
    if (options.signal && options.signal.aborted) {
      return { ...result, timed_out: false, cancelled: true, waited_ms: Date.now() - startedAt };
    }
    const elapsed = Date.now() - startedAt;
    if (typeof options.onTick === 'function') {
      try { options.onTick({ result, elapsed_ms: elapsed }); } catch (_err) { /* a tick must never end the wait */ }
    }
    if (elapsed >= maxWaitMs) {
      return { ...result, timed_out: true, cancelled: false, waited_ms: elapsed };
    }
    await sleep(Math.min(pollMs, Math.max(1, maxWaitMs - elapsed)));
  }
}

// ── presence ────────────────────────────────────────────────────────────────
//
// One file per entity, one entry per session:
//
//   { entity, updated, sessions: [
//       { session, mode, since, refreshed, cursor, accepts: ['message'] }
//   ] }
//
// A per-entity file rather than a per-session one because every reader named in
// the brief (the door's `presence`, the TUI segment, the entity card) asks the
// same question in the same place: "who of this entity is listening?" The array
// is what keeps that answer true when one entity has two sessions in standby —
// "at most one entry per session" is a dedupe rule, not a promise of singleton.
//
// Writes are tmp+rename so a reader never sees half a file.

/** Freshness of one presence entry, as a state plus an age. */
export function freshnessOf(refreshed, now = Date.now(), freshMs = PRESENCE_FRESH_MS) {
  const at = Date.parse(String(refreshed || ''));
  if (!Number.isFinite(at)) return { state: 'unknown', age_s: null, fresh: false };
  const ageMs = Math.max(0, now - at);
  return {
    state: ageMs <= freshMs ? 'listening' : 'last-seen',
    age_s: Math.round(ageMs / 1000),
    fresh: ageMs <= freshMs,
  };
}

/**
 * Publish (or refresh) one session's presence.
 *
 * Throws when the record cannot be written. That is deliberate: a subscription
 * that cannot say it is listening must not silently listen.
 */
export function writePresence(entry = {}) {
  const entity = String(entry.entity || '');
  const session = String(entry.session || '');
  assertEntity(entity);
  if (!session) throw new Error('presence requires a session id');

  const now = entry.now == null ? Date.now() : Number(entry.now);
  const file = presencePath(entity);
  const existing = readPresenceFile(entity);
  const sessions = (existing && Array.isArray(existing.sessions) ? existing.sessions : [])
    .filter((row) => row && row.session && row.session !== session)
    .filter((row) => {
      const at = Date.parse(String(row.refreshed || ''));
      return Number.isFinite(at) && now - at <= PRESENCE_PRUNE_MS;
    });

  const previous = (existing && Array.isArray(existing.sessions) ? existing.sessions : [])
    .find((row) => row && row.session === session) || null;

  sessions.push({
    session,
    mode: entry.mode == null ? null : String(entry.mode),
    since: previous && previous.since ? previous.since : (entry.since || new Date(now).toISOString()),
    refreshed: new Date(now).toISOString(),
    cursor: entry.cursor == null ? (previous ? previous.cursor ?? null : null) : String(entry.cursor),
    accepts: Array.isArray(entry.accepts) ? entry.accepts.map(String) : ['message'],
  });
  sessions.sort((a, b) => String(b.refreshed).localeCompare(String(a.refreshed)));

  const record = { entity, updated: new Date(now).toISOString(), sessions };
  ensureDir(presenceDir());
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
  return record;
}

/** Read one entity's presence file, or null when it has never published. */
export function readPresenceFile(entity) {
  try {
    return JSON.parse(fs.readFileSync(presencePath(entity), 'utf8'));
  } catch (err) {
    if (err && (err.code === 'ENOENT' || err instanceof SyntaxError)) return null;
    throw err;
  }
}

/** Forget one session's presence (a session that has left the mode). */
export function clearPresence(entity, session) {
  const file = presencePath(entity);
  const existing = readPresenceFile(entity);
  if (!existing) return { removed: false };
  const sessions = (existing.sessions || []).filter((row) => row.session !== session);
  if (sessions.length === (existing.sessions || []).length) return { removed: false };
  if (!sessions.length) {
    try { fs.unlinkSync(file); } catch (_err) { /* already gone */ }
    return { removed: true };
  }
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify({ ...existing, updated: new Date().toISOString(), sessions }, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
  return { removed: true };
}

/**
 * Who is listening, kingdom-wide.
 *
 * `listening` holds only fresh entries — an empty list is a TRUE answer and the
 * door says exactly that. `last_seen` holds the expired ones with their age, so
 * a reader can say "Juno was listening twelve minutes ago" instead of inventing
 * a listener or a silence.
 */
export function listPresence(options = {}) {
  const now = options.now == null ? Date.now() : Number(options.now);
  const freshMs = options.freshMs == null ? PRESENCE_FRESH_MS : Number(options.freshMs);
  const dir = presenceDir();

  let names = [];
  try {
    names = fs.readdirSync(dir).filter((name) => name.endsWith('.json'));
  } catch (err) {
    if (!err || err.code !== 'ENOENT') throw err;
  }

  const listening = [];
  const lastSeen = [];
  let unreadable = 0;

  for (const name of names) {
    let record;
    try {
      record = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
    } catch (_err) {
      unreadable += 1;
      continue;
    }
    const entity = record && record.entity ? String(record.entity) : name.replace(/\.json$/, '');
    const sessions = record && Array.isArray(record.sessions) ? record.sessions : [];
    for (const session of sessions) {
      if (!session || !session.session) continue;
      const freshness = freshnessOf(session.refreshed, now, freshMs);
      const row = {
        entity,
        mode: session.mode ?? null,
        session: session.session,
        since: session.since ?? null,
        refreshed: session.refreshed ?? null,
        age_s: freshness.age_s,
        freshness: freshness.state,
        accepts: Array.isArray(session.accepts) ? session.accepts : [],
        cursor: session.cursor ?? null,
      };
      if (freshness.fresh) listening.push(row);
      else lastSeen.push(row);
    }
  }

  listening.sort((a, b) => String(a.entity).localeCompare(String(b.entity)));
  lastSeen.sort((a, b) => String(a.entity).localeCompare(String(b.entity)));
  return { count: listening.length, listening, last_seen: lastSeen, unreadable };
}

/**
 * Is anybody fresh enough to receive a message addressed to `entity`?
 *
 * Returns the fresh entry to address, or null. `null` is the answer the door
 * must state in words — "nobody is listening" — rather than inventing delivery.
 */
export function findListener(entity, options = {}) {
  const now = options.now == null ? Date.now() : Number(options.now);
  const freshMs = options.freshMs == null ? PRESENCE_FRESH_MS : Number(options.freshMs);
  const record = readPresenceFile(String(entity || ''));
  if (!record || !Array.isArray(record.sessions)) return null;
  const fresh = record.sessions
    .map((session) => ({ session, freshness: freshnessOf(session.refreshed, now, freshMs) }))
    .filter((row) => row.freshness.fresh);
  if (!fresh.length) return null;
  fresh.sort((a, b) => String(b.session.refreshed).localeCompare(String(a.session.refreshed)));
  const best = fresh[0];
  return {
    entity: record.entity,
    session: best.session.session,
    mode: best.session.mode ?? null,
    since: best.session.since ?? null,
    refreshed: best.session.refreshed,
    age_s: best.freshness.age_s,
    accepts: Array.isArray(best.session.accepts) ? best.session.accepts : [],
  };
}

// ── relay budget ────────────────────────────────────────────────────────────
//
// A voice agent relaying forty messages is a denial of attention, not
// enthusiasm. Token bucket, on disk so a door restart is not a reset: burst 3,
// then one per minute. The refusal tells the sender plainly that it is
// throttled and when the next one is allowed.

function relayBudgetPath() {
  return path.join(notifyDir(), 'relay-budget.json');
}

function readBudgets() {
  try {
    const parsed = JSON.parse(fs.readFileSync(relayBudgetPath(), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    if (err && (err.code === 'ENOENT' || err instanceof SyntaxError)) return {};
    throw err;
  }
}

function writeBudgets(budgets) {
  ensureDir(notifyDir());
  const file = relayBudgetPath();
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(budgets, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/**
 * Spend one relay token for `key` (sender+session).
 *
 * → { allowed, remaining, retry_after_s, reason? }
 *
 * A refusal is not an error: it is a fact about the sender's rate and it is
 * returned in words the door can repeat.
 */
export function takeRelayToken(key, options = {}) {
  const now = options.now == null ? Date.now() : Number(options.now);
  const burst = options.burst == null ? RELAY_BURST : Number(options.burst);
  const refillMs = options.refillMs == null ? RELAY_REFILL_MS : Number(options.refillMs);
  const bucketKey = String(key || 'anonymous');

  const budgets = readBudgets();
  const prior = budgets[bucketKey];
  let tokens = burst;
  let at = now;
  if (prior && Number.isFinite(Number(prior.tokens)) && Number.isFinite(Number(prior.at))) {
    const elapsed = Math.max(0, now - Number(prior.at));
    tokens = Math.min(burst, Number(prior.tokens) + elapsed / refillMs);
    at = Number(prior.at);
  }

  if (tokens < 1) {
    const waitMs = Math.ceil((1 - tokens) * refillMs);
    budgets[bucketKey] = { tokens, at: now };
    writeBudgets(budgets);
    return {
      allowed: false,
      remaining: 0,
      retry_after_s: Math.max(1, Math.ceil(waitMs / 1000)),
      reason: `throttled: burst of ${burst}, then one per ${Math.round(refillMs / 1000)}s — next relay allowed in ${Math.max(1, Math.ceil(waitMs / 1000))}s`,
    };
  }

  tokens -= 1;
  budgets[bucketKey] = { tokens, at: now };
  writeBudgets(budgets);
  return { allowed: true, remaining: Math.floor(tokens), retry_after_s: 0 };
}

export default {
  PRESENCE_FRESH_MS,
  SUMMARY_MAX,
  RELAY_BURST,
  RELAY_REFILL_MS,
  CHANNELS,
  runtimePath,
  notifyDir,
  presenceDir,
  channelPath,
  presencePath,
  newEventId,
  clipSummary,
  appendEvent,
  readEvents,
  waitForEvents,
  freshnessOf,
  writePresence,
  readPresenceFile,
  clearPresence,
  listPresence,
  findListener,
  takeRelayToken,
};
