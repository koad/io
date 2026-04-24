// Session scanner — always on
// Watches ~/.<entity>/.local/state/harness/sessions/*.json across all entities
// Syncs harness session telemetry into the in-memory HarnessSessions collection
// so the overview dashboard and CLI see all active Claude Code sessions.
//
// All write paths converge on a single upsertSession(entity, host, pid, enrichment)
// function. The canonical _id is "<entity>:<host>:<pid>". No other _id shape is
// created. See VESTA-SPEC-142 for the full invariant.
//
// Three session origins:
//   source: 'pid-scanner'  — synthesized from harness.pid + last-payload.json, sparse
//   source: 'json'         — written by harness into sessions/*.json, rich telemetry
//   source: 'emission'     — heartbeat from emissions.js (refreshes lastSeen only)
//
// PID tracking: reads harness.pid from the entity's state dir. When a session
// is active but the harness PID is dead (and past a grace period), the session
// is marked 'killed' and an emission is fired. Clean exits are handled by the
// harness command's EXIT trap — the scanner only catches orphans.

const fs = Npm.require('fs');
const path = Npm.require('path');
const os = Npm.require('os');
const http = Npm.require('http');

const STALE_MS = 2 * 3600 * 1000; // 2h — sessions older than this are inactive
const PID_GRACE_MS = 60 * 1000; // 1m — don't trust pid-dead until session is this old

const watchers = new Map();

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (_) { return false; }
}

function readSessionJson(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function readHarnessPid(entityPath) {
  const pidFile = path.join(entityPath, '.local', 'state', 'harness', 'harness.pid');
  try {
    const raw = fs.readFileSync(pidFile, 'utf8').trim();
    const pid = parseInt(raw, 10);
    return isNaN(pid) ? null : pid;
  } catch (e) {
    return null;
  }
}

function readLastPayload(entityPath) {
  const payloadFile = path.join(entityPath, '.local', 'state', 'harness', 'last-payload.json');
  try {
    const raw = fs.readFileSync(payloadFile, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function pidStartedAt(pid) {
  // Read process start time from /proc/<pid>/stat field 22 (clock ticks from boot).
  // Combine with os.uptime() + Date.now() to get absolute start time.
  // Falls back to null on any error.
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    // Fields are space-separated; field 22 (0-indexed: 21) is starttime.
    // The comm field (index 1) can contain spaces and is wrapped in parens —
    // find the closing paren to locate the real field boundary.
    const commEnd = stat.lastIndexOf(')');
    if (commEnd === -1) return null;
    const rest = stat.slice(commEnd + 2); // skip ') '
    const fields = rest.split(' ');
    // field 22 overall = index 19 after the comm boundary (fields[0] = state = field 3)
    const starttimeField = fields[19];
    if (!starttimeField) return null;
    const startTicks = parseInt(starttimeField, 10);
    if (isNaN(startTicks)) return null;
    const clockHz = 100; // USER_HZ is almost always 100 on Linux
    const bootEpochMs = Date.now() - os.uptime() * 1000;
    return new Date(bootEpochMs + (startTicks / clockHz) * 1000);
  } catch (e) {
    return null;
  }
}

function detectHarness(pid) {
  // Best-effort: read /proc/<pid>/cmdline to identify the harness type.
  try {
    const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ').trim();
    if (/claude/i.test(cmdline)) return 'claude-code';
    if (/opencode/i.test(cmdline)) return 'opencode';
    if (/bash|sh\b/.test(cmdline)) return 'bash';
    return 'unknown';
  } catch (e) {
    return 'unknown';
  }
}

// ---------------------------------------------------------------------------
// SPEC-142: Shared canonical upsert
// ---------------------------------------------------------------------------
//
// All write paths call this function. The _id is always "<entity>:<host>:<pid>".
// enrichment fields are merged into the record; sources[] is accumulated with $addToSet.
//
// enrichment shape (all optional):
//   source: String          — 'pid-scanner' | 'json' | 'emission'
//   sessionId: String       — Claude Code stable UUID (null for opencode)
//   harness: String         — 'claude-code' | 'opencode' | 'bash' | 'unknown'
//   startedAt: Date         — best-available start time
//   model: String
//   modelId: String
//   cwd: String
//   version: String
//   cost: Number
//   durationMs: Number
//   apiDurationMs: Number
//   linesAdded: Number
//   linesRemoved: Number
//   contextPct: Number
//   contextSize: Number
//   tokensIn: Number
//   tokensOut: Number
//   transcriptPath: String
//   rateLimits: Object
//   enriched: Boolean
//
function upsertSession(handle, host, pid, enrichment) {
  const Sessions = globalThis.SessionsCollection;
  if (!Sessions) return;
  if (!pid) return;

  const id = `${handle}:${host}:${pid}`;
  const now = new Date();
  const source = enrichment.source;

  const existing = Sessions.findOne({ _id: id });

  // PID reuse guard (SPEC-142 §3.2): don't reactivate a terminal record from a
  // recycled PID unless the new process started after the old one ended.
  if (existing && (existing.status === 'killed' || existing.status === 'ended')) {
    const boundary = existing.endedAt || existing.lastSeen;
    const newStart = enrichment.startedAt || now;
    if (!boundary || new Date(newStart) <= new Date(boundary)) {
      // Same or earlier start — PID not yet recycled, skip
      return;
    }
    // New process genuinely started after the old one ended — fall through to insert
    // (existing record stays in collection with terminal status; new canonical _id
    // would collide, so we append a suffix to the old record to free the key).
    Sessions.update(id, { $set: { _id: id + ':retired', migratedTo: id + ':new' } });
    // Minimongo doesn't support _id mutation via update — instead mark retired in-place
    // and let the archiver clean it. The new upsert below will insert fresh.
    Sessions.update(id, { $set: { status: 'ended', endedAt: now, retiredBy: 'pid-reuse' } });
  }

  // Build the $set payload from enrichment (only defined keys)
  const setFields = {
    entity: handle,
    host,
    pid,
    lastSeen: now,
    status: 'active',
  };

  const copyFields = [
    'sessionId', 'harness', 'startedAt',
    'model', 'modelId', 'cwd', 'version',
    'cost', 'durationMs', 'apiDurationMs',
    'linesAdded', 'linesRemoved',
    'contextPct', 'contextSize', 'tokensIn', 'tokensOut',
    'transcriptPath', 'rateLimits', 'enriched',
  ];
  for (const f of copyFields) {
    if (enrichment[f] !== undefined) setFields[f] = enrichment[f];
  }

  if (existing) {
    // Preserve startedAt — don't overwrite a known start time with a later estimate
    if (existing.startedAt && setFields.startedAt &&
        new Date(setFields.startedAt) > new Date(existing.startedAt)) {
      delete setFields.startedAt;
    }
    Sessions.update(id, {
      $set: setFields,
      $addToSet: source ? { sources: source } : {},
    });
  } else {
    const doc = Object.assign({ _id: id }, setFields);
    if (!doc.startedAt) doc.startedAt = now;
    doc.sources = source ? [source] : [];
    doc.endedAt = null;
    Sessions.insert(doc);
    console.log(`[SESSION-SCANNER] session created: ${id} (${doc.harness || 'unknown'}) via ${source}`);
  }

  // Stamp entity lastActivity
  if (EntityScanner && EntityScanner.Entities) {
    const entity = EntityScanner.Entities.findOne({ handle });
    const existingActivity = entity && entity.lastActivity ? new Date(entity.lastActivity) : null;
    if (!existingActivity || now > existingActivity) {
      EntityScanner.Entities.update({ handle }, { $set: { lastActivity: now } });
    }
  }
}

function emitToDeamon(entity, type, body) {
  const url = process.env.KOAD_IO_DAEMON_URL || 'http://10.10.10.10:28282';
  try {
    const parsed = new URL(url + '/emit');
    const payload = JSON.stringify({ entity, type, body });
    const req = http.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: '/emit',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      timeout: 2000,
    });
    req.on('error', () => {});
    req.write(payload);
    req.end();
  } catch (e) {
    // fire and forget
  }
}

// ---------------------------------------------------------------------------
// pid-scanner write path
// ---------------------------------------------------------------------------
function scanEntityPidSessions(handle, entityPath) {
  // Scan harness.pid for this entity and create/refresh a pid-inferred session
  // if the process is alive.
  const pid = readHarnessPid(entityPath);
  if (!pid) return;
  if (!pidAlive(pid)) return;

  const host = os.hostname();

  // Build enrichment from available signals
  const enrichment = {
    source: 'pid-scanner',
    harness: detectHarness(pid),
  };

  // Start time — prefer /proc, fall back to pid-file mtime
  const startedAt = pidStartedAt(pid);
  if (startedAt) {
    enrichment.startedAt = startedAt;
  } else {
    try {
      const pidFile = path.join(entityPath, '.local', 'state', 'harness', 'harness.pid');
      enrichment.startedAt = new Date(fs.statSync(pidFile).mtimeMs);
    } catch (e) {
      enrichment.startedAt = new Date();
    }
  }

  // Enrich from last-payload.json when available
  const payload = readLastPayload(entityPath);
  if (payload) {
    enrichment.enriched = true;
    if (payload.model) {
      enrichment.model = payload.model.display_name || payload.model.id || '';
      enrichment.modelId = payload.model.id || '';
    }
    if (payload.context_window) {
      enrichment.contextPct = Number(payload.context_window.used_percentage || 0);
      enrichment.contextSize = Number(payload.context_window.context_window_size || 0);
      enrichment.tokensIn = Number(payload.context_window.total_input_tokens || 0);
      enrichment.tokensOut = Number(payload.context_window.total_output_tokens || 0);
    }
    if (payload.session_id) enrichment.sessionId = payload.session_id;
    if (payload.transcript_path) enrichment.transcriptPath = payload.transcript_path;
    if (payload.cost) {
      enrichment.cost = Number(payload.cost.total_cost_usd || 0);
    }
  }

  upsertSession(handle, host, pid, enrichment);
}

// ---------------------------------------------------------------------------
// json-scanner write path (SPEC-142 §4.2)
// ---------------------------------------------------------------------------
//
// Claude Code session JSON has no pid field (confirmed 2026-04-23).
// We fall back to harness.pid for the entity. This is safe because there is
// at most one active harness per entity per host (SPEC-142 §5.1).
function upsertFromSessionJson(handle, entityPath, payload, fileMtime) {
  const Sessions = globalThis.SessionsCollection;
  if (!Sessions) return;

  const sid = payload.session_id;
  if (!sid) return; // opencode sessions don't write statusline JSON — skip

  const host = os.hostname();

  // §4.2.1: pid not in session JSON — fall back to harness.pid
  const pid = readHarnessPid(entityPath);
  if (!pid) {
    // No pid available — can't form canonical _id. Skip this record.
    // (The pid-scanner will create the canonical record on next tick.)
    return;
  }

  const now = new Date();
  const lastSeen = fileMtime ? new Date(fileMtime * 1000) : now;
  const ageMs = now - lastSeen.getTime();

  const enrichment = {
    source: 'json',
    sessionId: sid,
    model: payload.model ? (payload.model.display_name || payload.model.id || '') : '',
    modelId: payload.model ? (payload.model.id || '') : '',
    cwd: payload.cwd || (payload.workspace && payload.workspace.current_dir) || '',
    version: payload.version || '',
    harness: 'claude-code', // json source is always Claude Code (opencode doesn't write these)

    cost: payload.cost ? Number(payload.cost.total_cost_usd || 0) : 0,
    durationMs: payload.cost ? Number(payload.cost.total_duration_ms || 0) : 0,
    apiDurationMs: payload.cost ? Number(payload.cost.total_api_duration_ms || 0) : 0,
    linesAdded: payload.cost ? Number(payload.cost.total_lines_added || 0) : 0,
    linesRemoved: payload.cost ? Number(payload.cost.total_lines_removed || 0) : 0,

    contextPct: payload.context_window ? Number(payload.context_window.used_percentage || 0) : 0,
    contextSize: payload.context_window ? Number(payload.context_window.context_window_size || 0) : 0,
    tokensIn: payload.context_window ? Number(payload.context_window.total_input_tokens || 0) : 0,
    tokensOut: payload.context_window ? Number(payload.context_window.total_output_tokens || 0) : 0,

    rateLimits: {
      fiveHour: payload.rate_limits && payload.rate_limits.five_hour ? {
        usedPct: Number(payload.rate_limits.five_hour.used_percentage || 0),
        resetsAt: payload.rate_limits.five_hour.resets_at
          ? new Date(payload.rate_limits.five_hour.resets_at * 1000)
          : null,
      } : null,
      sevenDay: payload.rate_limits && payload.rate_limits.seven_day ? {
        usedPct: Number(payload.rate_limits.seven_day.used_percentage || 0),
        resetsAt: payload.rate_limits.seven_day.resets_at
          ? new Date(payload.rate_limits.seven_day.resets_at * 1000)
          : null,
      } : null,
    },

    enriched: true,
    startedAt: pidStartedAt(pid), // null if /proc not available; upsertSession handles it
  };

  // If the file is stale, mark session stale — but let upsertSession create the record
  // first (pid-scanner will confirm liveness on next tick and may promote back to active).
  if (ageMs > STALE_MS) {
    // Don't override — let stale check handle it via periodicStaleCheck
    // Just don't create an 'active' record from a 2h+ stale file.
    return;
  }

  upsertSession(handle, host, pid, enrichment);
}

function scanEntitySessions(handle, entityPath) {
  const sessionsDir = path.join(entityPath, '.local', 'state', 'harness', 'sessions');
  try {
    fs.accessSync(sessionsDir);
  } catch (e) {
    return;
  }

  try {
    const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.json') && !f.startsWith('.'));
    for (const file of files) {
      const filePath = path.join(sessionsDir, file);
      const mtime = fs.statSync(filePath).mtimeMs / 1000;
      const payload = readSessionJson(filePath);
      if (payload) upsertFromSessionJson(handle, entityPath, payload, mtime);
    }
  } catch (e) {
    // Not readable
  }
}

function watchEntitySessions(handle, entityPath) {
  if (watchers.has(handle)) return;

  const sessionsDir = path.join(entityPath, '.local', 'state', 'harness', 'sessions');
  try {
    fs.accessSync(sessionsDir);
  } catch (e) {
    return;
  }

  try {
    const watcher = fs.watch(sessionsDir, { persistent: false }, (eventType, filename) => {
      if (!filename || !filename.endsWith('.json') || filename.startsWith('.')) return;
      Meteor.setTimeout(() => {
        const filePath = path.join(sessionsDir, filename);
        try {
          fs.accessSync(filePath);
          const mtime = fs.statSync(filePath).mtimeMs / 1000;
          const payload = readSessionJson(filePath);
          if (payload) {
            upsertFromSessionJson(handle, entityPath, payload, mtime);
          }
        } catch (e) {
          // File removed — if this was a legacy UUID-keyed record, remove it.
          // Canonical records are maintained by pid-scanner, not file presence.
          const sid = filename.replace('.json', '');
          const Sessions = globalThis.SessionsCollection;
          // Only remove if still using legacy UUID _id (no colons)
          if (Sessions && !sid.includes(':')) Sessions.remove({ _id: sid });
        }
      }, 300);
    });
    watchers.set(handle, watcher);
  } catch (e) {
    // Can't watch
  }
}

function scanAll() {
  const entities = EntityScanner.Entities.find().fetch();
  for (const entity of entities) {
    scanEntitySessions(entity.handle, entity.path);
    watchEntitySessions(entity.handle, entity.path);
    scanEntityPidSessions(entity.handle, entity.path);
  }
  const Sessions = globalThis.SessionsCollection;
  const total = Sessions ? Sessions.find().count() : 0;
  console.log(`[SESSION-SCANNER] Scan complete: ${total} sessions across ${entities.length} entities`);
}

// ---------------------------------------------------------------------------
// SPEC-142 §7: Migration sweep — run once after scanAll()
// ---------------------------------------------------------------------------
//
// Reconciles legacy UUID-keyed records (source: 'json', _id = sessionId) into
// canonical (entity:host:pid) records. Idempotent.
function runMigration() {
  const Sessions = globalThis.SessionsCollection;
  if (!Sessions) return;

  const host = os.hostname();
  let merged = 0, killed = 0, ended = 0;

  // Identify legacy records: _id is a UUID (contains '-' and no ':')
  const legacyRecords = Sessions.find({}).fetch().filter(doc => {
    return typeof doc._id === 'string' && doc._id.includes('-') && !doc._id.includes(':');
  });

  if (legacyRecords.length === 0) {
    console.log('[SESSION-MIGRATION] No legacy records found — collection already canonical.');
    return;
  }

  console.log(`[SESSION-MIGRATION] Found ${legacyRecords.length} legacy UUID-keyed records to reconcile.`);

  for (const legacy of legacyRecords) {
    const entity = legacy.entity;
    if (!entity) {
      Sessions.update(legacy._id, { $set: { status: 'ended', endedAt: new Date(), migratedTo: null } });
      ended++;
      continue;
    }

    // Get pid: stored in the doc if it was ever enriched, else read from harness.pid
    let pid = legacy.pid;
    if (!pid) {
      const entityPath = path.join(process.env.HOME, '.' + entity);
      pid = readHarnessPid(entityPath);
    }

    if (!pid) {
      // No pid available — can't form canonical id; mark ended
      Sessions.update(legacy._id, { $set: { status: 'ended', endedAt: new Date(), migratedNote: 'no-pid' } });
      ended++;
      continue;
    }

    const canonicalId = `${entity}:${host}:${pid}`;

    if (pidAlive(pid)) {
      // Process is alive — merge into canonical record
      const existing = Sessions.findOne({ _id: canonicalId });
      const enrichment = {
        source: 'json',
        sessionId: legacy.sessionId || legacy._id,
        model: legacy.model,
        modelId: legacy.modelId,
        cwd: legacy.cwd,
        version: legacy.version,
        cost: legacy.cost,
        durationMs: legacy.durationMs,
        apiDurationMs: legacy.apiDurationMs,
        linesAdded: legacy.linesAdded,
        linesRemoved: legacy.linesRemoved,
        contextPct: legacy.contextPct,
        contextSize: legacy.contextSize,
        tokensIn: legacy.tokensIn,
        tokensOut: legacy.tokensOut,
        transcriptPath: legacy.transcriptPath,
        rateLimits: legacy.rateLimits,
        enriched: legacy.enriched || true,
        startedAt: legacy.startedAt,
        harness: legacy.harness || 'claude-code',
      };

      if (existing) {
        // Merge telemetry into existing canonical record
        const setFields = {};
        for (const [k, v] of Object.entries(enrichment)) {
          if (k !== 'source' && v !== undefined && v !== null) setFields[k] = v;
        }
        Sessions.update(canonicalId, {
          $set: setFields,
          $addToSet: { sources: 'json' },
        });
      } else {
        upsertSession(entity, host, pid, enrichment);
      }

      // Mark legacy record as migrated
      Sessions.update(legacy._id, {
        $set: { status: 'ended', endedAt: new Date(), migratedTo: canonicalId }
      });
      merged++;
      console.log(`[SESSION-MIGRATION] merged ${legacy._id} → ${canonicalId}`);
    } else {
      // Process is dead — mark killed
      Sessions.update(legacy._id, { $set: { status: 'killed', endedAt: new Date() } });
      killed++;
    }
  }

  console.log(`[SESSION-MIGRATION] complete: merged=${merged}, killed=${killed}, ended=${ended} of ${legacyRecords.length} legacy records`);
}

// Periodic sweep: two checks per active session.
//
// 1. Time-based stale: session file hasn't been updated in STALE_MS → stale.
//    This catches sessions where the statusline just stopped firing (crash,
//    network loss, etc.) without any pid signal.
//
// 2. PID-based killed: the harness.pid file for the entity is readable, the
//    PID inside is dead, AND the session is past the PID_GRACE_MS grace
//    period (avoids false positives during startup). This catches SIGKILL'd
//    processes that never ran the EXIT trap. Emits a warning so the operator
//    sees it in the emissions feed.
//
// 3. Pid-scanner refresh: for sessions confirmed by pid-scanner, re-run
//    scanEntityPidSessions on each tick to pick up updated last-payload.json data,
//    refresh lastSeen, and create new records for post-boot harnesses.
function periodicStaleCheck() {
  const Sessions = globalThis.SessionsCollection;
  if (!Sessions) return;

  const now = Date.now();
  const staleCutoff = new Date(now - STALE_MS);

  // First: refresh/create pid-scanner records for all known entities.
  // This is what makes post-boot TUIs show up — the periodic worker runs every
  // minute and will upsert a canonical record for any entity whose harness started
  // after daemon boot.
  if (EntityScanner && EntityScanner.Entities) {
    EntityScanner.Entities.find().forEach(entity => {
      if (entity.handle && entity.path) {
        scanEntityPidSessions(entity.handle, entity.path);
      }
    });
  }

  Sessions.find({ status: 'active' }).forEach(session => {
    const ageMs = now - new Date(session.lastSeen).getTime();

    // Canonical sessions (entity:host:pid _id) — check PID directly
    if (session._id.includes(':') && session.host === os.hostname()) {
      if (session.pid && pidAlive(session.pid)) {
        // Still alive — pid-scanner refresh already handled above
        return;
      } else if (session.pid && ageMs > PID_GRACE_MS) {
        // Dead and past grace period — mark killed
        const costStr = session.cost ? ` ($${session.cost.toFixed(2)})` : '';
        Sessions.update(session._id, {
          $set: { status: 'killed', endedAt: new Date() },
        });
        emitToDeamon(
          session.entity,
          'warning',
          `harness killed: ${session.harness || session.model || 'harness'} (pid ${session.pid} dead)${costStr}`
        );
        console.log(`[SESSION-SCANNER] killed: ${session.entity}/${session._id} (pid ${session.pid})`);
        return;
      }
      // Within grace period — leave as-is
      return;
    }

    // Legacy json-sourced sessions not yet migrated: check PID liveness via harness.pid
    if (session.host === os.hostname() && ageMs > PID_GRACE_MS) {
      const entityPath = path.join(process.env.HOME, '.' + session.entity);
      const pid = readHarnessPid(entityPath);
      if (pid && !pidAlive(pid)) {
        const costStr = session.cost ? ` ($${session.cost.toFixed(2)})` : '';
        Sessions.update(session._id, {
          $set: { status: 'killed', endedAt: new Date() },
        });
        emitToDeamon(
          session.entity,
          'warning',
          `harness killed: ${session.model || 'claude'} (pid ${pid} dead)${costStr}`
        );
        console.log(`[SESSION-SCANNER] killed: ${session.entity}/${session._id} (pid ${pid})`);
        return;
      }
    }

    // Zero-cost ghost: session file exists but nothing ever happened.
    // If untouched for 5 minutes, mark ended and remove the file.
    const sources = session.sources || (session.source ? [session.source] : []);
    const isJsonOnly = sources.length === 0 || (sources.length === 1 && sources[0] === 'json');
    const isLegacyJson = session.source === 'json' && !session._id.includes(':');
    if ((isJsonOnly || isLegacyJson) && session.cost === 0 && session.tokensOut === 0 && ageMs > 5 * 60 * 1000) {
      Sessions.update(session._id, { $set: { status: 'ended', endedAt: new Date() } });
      // Remove the ghost file so it doesn't reappear on next scan
      const entityPath = path.join(process.env.HOME, '.' + session.entity);
      const sessFile = path.join(entityPath, '.local', 'state', 'harness', 'sessions', `${session.sessionId || session._id}.json`);
      try { fs.unlinkSync(sessFile); } catch (e) { /* already gone */ }
      return;
    }

    // Time-based stale
    if (session.lastSeen < staleCutoff) {
      Sessions.update(session._id, { $set: { status: 'stale' } });
    }
  });
}

Meteor.startup(async () => {
  Meteor.setTimeout(async () => {
    scanAll();
    runMigration();
    periodicStaleCheck();

    // Watch for new entities
    EntityScanner.Entities.find().observeChanges({
      added(id, fields) {
        if (fields.path && fields.handle) {
          scanEntitySessions(fields.handle, fields.path);
          watchEntitySessions(fields.handle, fields.path);
          scanEntityPidSessions(fields.handle, fields.path);
        }
      },
    });

    if (!globalThis.indexerReady) globalThis.indexerReady = {};
    globalThis.indexerReady.sessions = new Date().toISOString();

    // Periodic stale/killed check — move to koad.workers (1-minute interval, ~30s effective
    // since workers enforce a 1-minute minimum; previously ran every 30s via setInterval).
    if (typeof koad !== 'undefined' && koad.workers && typeof koad.workers.start === 'function') {
      await koad.workers.start({
        service: 'session-stale-check',
        type: 'indexer',
        interval: 1,
        runImmediately: true,
        task: async () => {
          let eid = null;
          try {
            const opened = await Meteor.callAsync('entity.emit', {
              entity: 'koad-io', type: 'service', body: 'session stale check running', lifecycle: 'open'
            });
            eid = opened && opened._id ? opened._id : null;
          } catch (e) {}
          try {
            const Sessions = globalThis.SessionsCollection;
            const before = Sessions ? Sessions.find({ status: 'active' }).count() : 0;
            periodicStaleCheck();
            const after = Sessions ? Sessions.find({ status: 'active' }).count() : 0;
            const marked = before - after;
            if (eid) {
              await Meteor.callAsync('entity.emit.update', eid, `stale check: ${marked} sessions marked inactive`, 'close');
            }
          } catch (err) {
            if (eid) {
              try {
                await Meteor.callAsync('entity.emit.update', eid, `stale check failed: ${err.message}`, 'close');
              } catch (e) {}
            }
            throw err;
          }
        }
      });
    } else {
      console.warn('[SESSION-SCANNER] koad.workers unavailable — falling back to Meteor.setInterval');
      Meteor.setInterval(() => periodicStaleCheck(), 60000);
    }
  }, 2000);
});
