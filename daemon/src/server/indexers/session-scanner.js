// Session scanner — always on
// Watches ~/.<entity>/.local/state/harness/sessions/*.json across all entities
// Syncs harness session telemetry into the in-memory HarnessSessions collection
// so the overview dashboard and CLI see all active Claude Code sessions.
//
// Two session origins are tracked:
//   source: 'json'         — written by harness into sessions/*.json, rich telemetry
//   source: 'pid-inferred' — synthesized from harness.pid + last-payload.json, sparse
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

function upsertPidSession(handle, entityPath, pid) {
  const Sessions = globalThis.SessionsCollection;
  if (!Sessions) return;

  const id = `${handle}:${os.hostname()}:${pid}`;
  const now = new Date();

  // Build base doc
  const doc = {
    entity: handle,
    host: os.hostname(),
    pid,
    status: 'active',
    lastSeen: now,
    source: 'pid-inferred',
    harness: detectHarness(pid),
  };

  // Start time — prefer /proc, fall back to pid-file mtime
  const startedAt = pidStartedAt(pid);
  if (startedAt) {
    doc.startedAt = startedAt;
  } else {
    try {
      const pidFile = path.join(entityPath, '.local', 'state', 'harness', 'harness.pid');
      doc.startedAt = new Date(fs.statSync(pidFile).mtimeMs);
    } catch (e) {
      doc.startedAt = now;
    }
  }

  // Enrich from last-payload.json when available
  const payload = readLastPayload(entityPath);
  if (payload) {
    doc.enriched = true;
    if (payload.model) {
      doc.model = payload.model.display_name || payload.model.id || '';
      doc.modelId = payload.model.id || '';
    }
    if (payload.context_window) {
      doc.contextPct = Number(payload.context_window.used_percentage || 0);
      doc.contextSize = Number(payload.context_window.context_window_size || 0);
      doc.tokensIn = Number(payload.context_window.total_input_tokens || 0);
      doc.tokensOut = Number(payload.context_window.total_output_tokens || 0);
    }
    if (payload.session_id) doc.sessionId = payload.session_id;
    if (payload.transcript_path) doc.transcriptPath = payload.transcript_path;
    if (payload.cost) {
      doc.cost = Number(payload.cost.total_cost_usd || 0);
    }
  }

  const existing = Sessions.findOne({ _id: id });
  if (existing) {
    if (existing.status === 'killed' || existing.status === 'ended') return;
    Sessions.update(id, { $set: doc });
  } else {
    Sessions.insert(Object.assign({ _id: id }, doc));
    console.log(`[SESSION-SCANNER] pid-inferred session created: ${id} (${doc.harness})`);
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

function upsertSession(handle, payload, fileMtime) {
  const Sessions = globalThis.SessionsCollection;
  if (!Sessions) return;

  const sid = payload.session_id;
  if (!sid) return;

  const doc = {
    entity: handle,
    sessionId: sid,
    host: os.hostname(),
    model: payload.model ? (payload.model.display_name || payload.model.id || '') : '',
    modelId: payload.model ? (payload.model.id || '') : '',
    cwd: payload.cwd || (payload.workspace && payload.workspace.current_dir) || '',
    version: payload.version || '',

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

    lastSeen: fileMtime ? new Date(fileMtime * 1000) : new Date(),
    status: 'active',
    source: 'json',
  };

  // Mark stale if file is old
  const ageMs = Date.now() - doc.lastSeen.getTime();
  if (ageMs > STALE_MS) {
    doc.status = 'stale';
  }

  const existing = Sessions.findOne({ _id: sid });
  if (existing) {
    // Don't overwrite killed/ended status with active from a stale file read
    if (existing.status === 'killed' || existing.status === 'ended') return;
    Sessions.update(sid, { $set: doc });
  } else {
    Sessions.insert(Object.assign({ _id: sid }, doc));
  }

  // Stamp entity lastActivity
  if (handle && doc.status === 'active') {
    const entity = EntityScanner.Entities.findOne({ handle });
    const existingActivity = entity && entity.lastActivity ? new Date(entity.lastActivity) : null;
    if (!existingActivity || doc.lastSeen > existingActivity) {
      EntityScanner.Entities.update({ handle }, { $set: { lastActivity: doc.lastSeen } });
    }
  }
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
      if (payload) upsertSession(handle, payload, mtime);
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
            upsertSession(handle, payload, mtime);
          }
        } catch (e) {
          // File removed — remove from collection
          const sid = filename.replace('.json', '');
          const Sessions = globalThis.SessionsCollection;
          if (Sessions) Sessions.remove({ _id: sid });
        }
      }, 300);
    });
    watchers.set(handle, watcher);
  } catch (e) {
    // Can't watch
  }
}

function scanEntityPidSessions(handle, entityPath) {
  // Scan harness.pid for this entity and create/refresh a pid-inferred session
  // if the process is alive.
  const pid = readHarnessPid(entityPath);
  if (!pid) return;
  if (!pidAlive(pid)) return;
  upsertPidSession(handle, entityPath, pid);
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
// 3. Pid-inferred refresh: for source:'pid-inferred' sessions, re-run
//    upsertPidSession on each tick to pick up updated last-payload.json data
//    and refresh lastSeen while the process is alive.
function periodicStaleCheck() {
  const Sessions = globalThis.SessionsCollection;
  if (!Sessions) return;

  const now = Date.now();
  const staleCutoff = new Date(now - STALE_MS);

  Sessions.find({ status: 'active' }).forEach(session => {
    const ageMs = now - new Date(session.lastSeen).getTime();

    // Pid-inferred sessions: check PID directly since they carry their own pid field.
    if (session.source === 'pid-inferred' && session.host === os.hostname()) {
      if (pidAlive(session.pid)) {
        // Still alive — refresh lastSeen and re-enrich from last-payload.json
        const entityPath = path.join(process.env.HOME, '.' + session.entity);
        upsertPidSession(session.entity, entityPath, session.pid);
        return;
      } else if (ageMs > PID_GRACE_MS) {
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
        console.log(`[SESSION-SCANNER] pid-inferred killed: ${session.entity}/${session._id} (pid ${session.pid})`);
        return;
      }
      // Within grace period — leave as-is
      return;
    }

    // json-sourced sessions: check PID liveness via harness.pid file (same-host only)
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
    if (session.source === 'json' && session.cost === 0 && session.tokensOut === 0 && ageMs > 5 * 60 * 1000) {
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
      Meteor.setInterval(() => periodicStaleCheck(), 30000);
    }
  }, 2000);
});
