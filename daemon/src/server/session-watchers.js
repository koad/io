// session-watchers.js — deliver matched emissions to active session inboxes
//
// Companion to `koad-io session watch`.  The watch command writes watcher
// registrations to:
//
//   ~/.koad-io/daemon/runtime/session-watchers/<session-id>.jsonl
//
// This module is the delivery side: on each emission, load (with caching)
// all active watcher files, evaluate each pattern, and deliver matches to:
//
//   ~/.koad-io/daemon/runtime/session-inbox/<session-id>.jsonl
//
// Pattern vocabulary (v1):
//   error                    type === 'error'
//   entity:<name>            emission.entity === name
//   topic:<slug>             emission.body contains slug (case-insensitive)
//   type:<name>              emission.type === name  (explicit form)
//   flight-close-error       type === 'flight' AND status === 'closed' with error context
//   <anything>               raw string match against emission.type (fallback)
//
// Delivery is fire-and-forget.  Watcher files older than SESSION_TTL_MS are
// skipped (stale session cleanup).  No delivery to self (watcher session_id
// must not match emission's own meta.session_id if present).
//
// This module hooks itself into the existing evaluateEmissionTriggers chain
// via a chained globalThis wrapper so it requires zero changes to existing
// call sites in emissions.js and api.js.

const fs = Npm.require('fs');
const path = Npm.require('path');
const os = Npm.require('os');

const RUNTIME_DIR = path.join(os.homedir(), '.koad-io', 'daemon', 'runtime');
const WATCHERS_DIR = path.join(RUNTIME_DIR, 'session-watchers');
const INBOX_DIR = path.join(RUNTIME_DIR, 'session-inbox');

// Sessions older than 8 hours are considered stale (skipped, not deleted).
// The watch command uses KOAD_IO_EMISSION_ID as the session ID, which is
// flight-scoped; 8 h covers any reasonable flight duration.
const SESSION_TTL_MS = 8 * 3600 * 1000;

// In-process cache: Map<session_id, { mtimeMs, watchers: Array<WatcherEntry> }>
const _cache = new Map();

// ---------------------------------------------------------------------------
// Watcher file loading (mtime-cached)
// ---------------------------------------------------------------------------

function loadWatchersFromFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const entries = [];
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        entries.push(JSON.parse(trimmed));
      } catch (e) {
        // Malformed JSONL line — skip silently
      }
    }
    return entries;
  } catch (e) {
    return [];
  }
}

function getWatchersForSession(sessionId, filePath) {
  try {
    const stat = fs.statSync(filePath);
    const cached = _cache.get(sessionId);
    if (cached && cached.mtimeMs === stat.mtimeMs) {
      return cached.watchers;
    }
    const watchers = loadWatchersFromFile(filePath);
    _cache.set(sessionId, { mtimeMs: stat.mtimeMs, watchers });
    return watchers;
  } catch (e) {
    _cache.delete(sessionId);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Pattern matching
// ---------------------------------------------------------------------------

function matchesPattern(pattern, doc) {
  if (!pattern || typeof pattern !== 'string') return false;

  // Exact built-in: error
  if (pattern === 'error') {
    return doc.type === 'error';
  }

  // entity:<name> — emission came from a specific entity
  if (pattern.startsWith('entity:')) {
    const name = pattern.slice('entity:'.length);
    return doc.entity === name;
  }

  // topic:<slug> — body contains the slug (case-insensitive)
  if (pattern.startsWith('topic:')) {
    const slug = pattern.slice('topic:'.length).toLowerCase();
    return typeof doc.body === 'string' && doc.body.toLowerCase().includes(slug);
  }

  // type:<name> — explicit type match
  if (pattern.startsWith('type:')) {
    const typeName = pattern.slice('type:'.length);
    return doc.type === typeName;
  }

  // flight-close-error — flight closed with error indicators
  if (pattern === 'flight-close-error') {
    if (doc.type !== 'flight') return false;
    if (doc.status !== 'closed') return false;
    // Check body or meta for error signals
    const body = (doc.body || '').toLowerCase();
    const hasErrorBody = body.includes('error') || body.includes('fail') || body.includes('exception');
    const hasMeta = doc.meta && (doc.meta.error || doc.meta.exitCode > 0);
    return hasErrorBody || hasMeta;
  }

  // Fallback: treat as a literal type match
  return doc.type === pattern;
}

// ---------------------------------------------------------------------------
// Inbox delivery
// ---------------------------------------------------------------------------

function ensureInboxDir() {
  try {
    fs.mkdirSync(INBOX_DIR, { recursive: true });
  } catch (e) {
    // Already exists or can't create — delivery will fail gracefully
  }
}

function deliverToInbox(sessionId, doc) {
  ensureInboxDir();
  const inboxFile = path.join(INBOX_DIR, sessionId + '.jsonl');
  try {
    const entry = {
      delivered_at: new Date().toISOString(),
      emission_id: doc._id || null,
      entity: doc.entity,
      type: doc.type,
      body: doc.body,
      timestamp: doc.timestamp,
      meta: doc.meta || null,
    };
    fs.appendFileSync(inboxFile, JSON.stringify(entry) + '\n', 'utf8');
    console.log(`[WATCHERS] delivered ${doc.entity}/${doc.type} → session ${sessionId}`);
  } catch (e) {
    console.error(`[WATCHERS] inbox write failed for ${sessionId}:`, e.message);
  }
}

// ---------------------------------------------------------------------------
// Main evaluation function
// ---------------------------------------------------------------------------

function evaluateSessionWatchers(doc, event) {
  // Only evaluate on new emissions and opens — skip update/close churn to
  // avoid duplicate deliveries.  Closes on type 'error' still come in as
  // 'emit' from the fire-and-forget path, so those are caught.
  if (event !== 'emit' && event !== 'open') return;

  let watcherFiles;
  try {
    watcherFiles = fs.readdirSync(WATCHERS_DIR).filter(f => f.endsWith('.jsonl'));
  } catch (e) {
    // Directory doesn't exist yet — no watchers registered
    return;
  }

  const now = Date.now();

  for (const fname of watcherFiles) {
    const sessionId = fname.replace(/\.jsonl$/, '');
    const filePath = path.join(WATCHERS_DIR, fname);

    // Skip stale watcher files
    try {
      const stat = fs.statSync(filePath);
      if (now - stat.mtimeMs > SESSION_TTL_MS) continue;
    } catch (e) {
      continue;
    }

    const watchers = getWatchersForSession(sessionId, filePath);
    if (!watchers.length) continue;

    // Don't deliver back to the session that originated this emission
    // (if the emission carries a meta.session_id matching this watcher's session)
    const emissionSessionId = doc.meta && doc.meta.session_id;
    if (emissionSessionId && emissionSessionId === sessionId) continue;

    for (const watcher of watchers) {
      if (matchesPattern(watcher.pattern, doc)) {
        deliverToInbox(sessionId, doc);
        break; // One delivery per emission per session, even if multiple patterns match
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Chain into existing evaluateEmissionTriggers
//
// Both emissions.js and api.js call globalThis.evaluateEmissionTriggers.
// We wrap it here so session-watcher delivery happens alongside trigger
// evaluation without modifying either caller.  This module loads after
// triggers-scanner.js alphabetically (s > t is false — check order below).
//
// Load order in Meteor: alphabetical within server/.
//   api.js, archiver.js, conversations.js, effectors.js, emissions.js,
//   flights.js, indexer-registry.js, jsonl-projector.js, main.js,
//   pluggable-indexers-startup.js, session-watchers.js, sessions.js,
//   workspace-entity.js
//   indexers/ loaded as subdirectory after parent — triggers-scanner.js is
//   in indexers/, which Meteor loads after the parent server/*.js files.
//
// Therefore: session-watchers.js loads BEFORE triggers-scanner.js sets
// globalThis.evaluateEmissionTriggers.  We defer the chain wrap to startup.
// ---------------------------------------------------------------------------

Meteor.startup(() => {
  Meteor.setTimeout(() => {
    // By startup + 1s, all server files have loaded.
    const original = globalThis.evaluateEmissionTriggers;
    if (typeof original === 'function') {
      globalThis.evaluateEmissionTriggers = function (doc, event) {
        original(doc, event);
        evaluateSessionWatchers(doc, event);
      };
      console.log('[WATCHERS] chained into evaluateEmissionTriggers');
    } else {
      // evaluateEmissionTriggers not yet set (shouldn't happen post-startup)
      // — expose our own evaluator and let api.js pick it up on next emit
      console.warn('[WATCHERS] evaluateEmissionTriggers not found at startup; standalone mode');
      globalThis.evaluateSessionWatchers = evaluateSessionWatchers;
    }
    console.log('[WATCHERS] active — watching', WATCHERS_DIR);
  }, 1000);
});
