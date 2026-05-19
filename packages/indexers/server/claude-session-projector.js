// claude-session-projector.js — project Claude Code JSONL session files into Postgres
//
// Handles indexer configs with format: claude-session
//
// Watches a projects/ directory for session JSONL files and subagent JSONL files.
// Writes to three Postgres tables in the control_tower database:
//
//   claude_sessions         — one row per session JSONL
//   subagent_flights        — one row per subagent JSONL
//   tool_calls              — one row per tool_use block
//
// Additionally maintains a small Mongo ring buffer collection:
//
//   ToolCallsLive — last 60s / 200 docs for atlas live reactivity (DDP).
//                   Periodically pruned. NOT a mirror of the PG table.
//
// File layout (discovered by this projector):
//
//   <source>/                              ← config.source (the projects/ dir)
//     <project-key>/
//       <session-uuid>.jsonl               ← main session transcript
//       <session-uuid>/
//         subagents/
//           agent-<agentId>.jsonl          ← subagent transcript
//           agent-<agentId>.meta.json      ← { agentType, description }
//
// Byte-offset tracking:
//   Each watched file keeps its last-read byte offset in a Map.
//   On watcher event, only new bytes (beyond the stored offset) are parsed.
//   This lets the projector handle large, append-only files efficiently.
//
// Publications: indexed.ToolCallsLive (for atlas reactivity only)

const fs     = Npm.require('fs');
const path   = Npm.require('path');
const os     = Npm.require('os');
const crypto = Npm.require('crypto');

// Track running projectors for reload
const _running = {}; // name → { config, watcher, directoryWatchers }

// ---------------------------------------------------------------------------
// Per-file fs.watch — fires on appends on Linux (unlike directory watches).
// We install one per JSONL file the first time we see it.
// ---------------------------------------------------------------------------

const _fileWatchers = {}; // projName → Map<filePath, FSWatcher>

function ensureFileWatcher(projName, filePath, onAppend) {
  if (!_fileWatchers[projName]) _fileWatchers[projName] = new Map();
  if (_fileWatchers[projName].has(filePath)) return; // already watching

  try {
    const debounce = { t: null };
    const w = fs.watch(filePath, { persistent: false }, () => {
      if (debounce.t) clearTimeout(debounce.t);
      debounce.t = Meteor.setTimeout(() => {
        debounce.t = null;
        onAppend();
      }, 150);
    });
    w.on('error', err => {
      console.warn(`[claude-session-projector] ${projName}: per-file watcher error on ${filePath}: ${err.message}`);
      _fileWatchers[projName].delete(filePath);
    });
    _fileWatchers[projName].set(filePath, w);
  } catch (err) {
    // Non-fatal — directory watcher still runs as fallback
    console.warn(`[claude-session-projector] ${projName}: could not watch file ${filePath}: ${err.message}`);
  }
}

function closeFileWatchers(projName) {
  const map = _fileWatchers[projName];
  if (!map) return;
  for (const w of map.values()) {
    try { w.close(); } catch (_) {}
  }
  delete _fileWatchers[projName];
}

// ---------------------------------------------------------------------------
// ToolCallsLive ring buffer — Mongo collection for atlas live reactivity.
// Hard cap: last 60 seconds OR last 200 docs, whichever is smaller.
// Periodically pruned every 30s (timer set in start()).
// ---------------------------------------------------------------------------

const LIVE_RING_MAX_DOCS = 200;
const LIVE_RING_MAX_AGE_MS = 60 * 1000; // 60 seconds

function getOrCreateToolCallsLive() {
  if (globalThis.ToolCallsLive instanceof Mongo.Collection) {
    return globalThis.ToolCallsLive;
  }
  const col = new Mongo.Collection('ToolCallsLive', { connection: null });
  globalThis.ToolCallsLive = col;
  try {
    Meteor.publish('indexed.ToolCallsLive', function () {
      return col.find();
    });
    console.log('[claude-session-projector] registered publication indexed.ToolCallsLive');
  } catch (err) {
    if (!err.message || !err.message.includes('already registered')) {
      console.warn('[claude-session-projector] ToolCallsLive publish note:', err.message);
    }
  }
  return col;
}

function pruneToolCallsLive(col) {
  if (!col) return;
  const cutoff = new Date(Date.now() - LIVE_RING_MAX_AGE_MS);
  try {
    col.remove({ timestamp: { $lt: cutoff } });
  } catch (_) {}

  // Hard cap: if still over max, remove oldest
  try {
    const count = col.find().count();
    if (count > LIVE_RING_MAX_DOCS) {
      const excess = count - LIVE_RING_MAX_DOCS;
      const oldest = col.find({}, { sort: { timestamp: 1 }, limit: excess }).fetch();
      for (const doc of oldest) {
        try { col.remove(doc._id); } catch (_) {}
      }
    }
  } catch (_) {}
}

function insertLive(col, tc) {
  if (!col) return;
  try {
    col.insert(tc);
  } catch (err) {
    if (!err.message || !err.message.includes('Duplicate _id')) {
      console.warn('[claude-session-projector] ToolCallsLive insert error:', err.message);
    }
  }
}

// ---------------------------------------------------------------------------
// file.touched emission — fired after each live ToolCall with a targetPath.
// Fire-and-forget: never blocks insertion.
// ---------------------------------------------------------------------------

const TOUCH_TOOLS = new Set(['Read', 'Edit', 'Write', 'NotebookEdit']);

const IGNORE_PREFIXES = [
  path.join(os.homedir(), '.git') + '/',
  '/tmp/',
  '/var/folders/',
];
const IGNORE_DIRS = new Set(['.git', 'node_modules', '.meteor', '.npm', '.trash', '.archive']);

function shouldEmitTouch(toolName) {
  return TOUCH_TOOLS.has(toolName);
}

function normalizeTouchPath(rawPath, cwd) {
  if (!rawPath || typeof rawPath !== 'string') return null;

  let resolved = rawPath;

  if (resolved.startsWith('~/')) {
    resolved = path.join(os.homedir(), resolved.slice(2));
  }

  if (!path.isAbsolute(resolved)) {
    if (cwd) {
      resolved = path.resolve(cwd, resolved);
    } else {
      return null;
    }
  }

  const parts = resolved.split(path.sep);
  for (const part of parts) {
    if (IGNORE_DIRS.has(part)) return null;
  }

  for (const prefix of IGNORE_PREFIXES) {
    if (resolved.startsWith(prefix)) return null;
  }

  try {
    if (!fs.existsSync(resolved)) return null;
  } catch (_) {
    return null;
  }

  return resolved;
}

const _touchRateWindow = { count: 0, windowStart: 0 };
const TOUCH_RATE_WARN_PER_SEC = 100;
const TOUCH_RATE_WINDOW_MS    = 1000;

function _checkTouchFloodRate() {
  const now = Date.now();
  if (now - _touchRateWindow.windowStart > TOUCH_RATE_WINDOW_MS) {
    _touchRateWindow.windowStart = now;
    _touchRateWindow.count       = 0;
  }
  _touchRateWindow.count++;
  if (_touchRateWindow.count === TOUCH_RATE_WARN_PER_SEC + 1) {
    console.warn(`[claude-session-projector] WARNING: file.touched rate exceeds ${TOUCH_RATE_WARN_PER_SEC}/sec`);
  }
}

function emitFileTouch(entity, toolName, targetPath, sessionId, parentSessionId) {
  try {
    const Emissions = globalThis.EmissionsCollection;
    if (!Emissions) return;
    const now = new Date();
    const doc = {
      entity,
      type: 'file.touched',
      body: `${toolName} ${targetPath}`,
      timestamp: now,
      meta: {
        payload: {
          path: targetPath,
          toolName,
          sessionId,
          parentSessionId: parentSessionId || null,
        },
      },
    };
    Emissions.insert(doc);
    _checkTouchFloodRate();
    if (globalThis.EntityScanner) {
      EntityScanner.Entities.update({ handle: entity }, { $set: { lastActivity: now } });
    }
  } catch (err) {
    console.warn(`[claude-session-projector] emitFileTouch failed: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Byte-offset store — per projector-name, per file path.
// ---------------------------------------------------------------------------

const _offsets = {};

function getOffset(projName, filePath) {
  if (!_offsets[projName]) return 0;
  return _offsets[projName][filePath] || 0;
}

function setOffset(projName, filePath, offset) {
  if (!_offsets[projName]) _offsets[projName] = {};
  _offsets[projName][filePath] = offset;
}

function clearOffsets(projName) {
  delete _offsets[projName];
}

// ---------------------------------------------------------------------------
// Read new JSONL lines from a file since last byte offset.
// Returns { newLines: [...parsed entries], newOffset }.
// ---------------------------------------------------------------------------

function readNewLines(filePath, projName) {
  const lastOffset = getOffset(projName, filePath);
  let fd = null;
  try {
    const stat = fs.statSync(filePath);
    if (stat.size <= lastOffset) return { newLines: [], newOffset: lastOffset };

    fd = fs.openSync(filePath, 'r');
    const readSize = stat.size - lastOffset;
    const buf = Buffer.alloc(readSize);
    const bytesRead = fs.readSync(fd, buf, 0, readSize, lastOffset);
    fs.closeSync(fd);
    fd = null;

    const chunk = buf.slice(0, bytesRead).toString('utf8');
    const rawLines = chunk.split('\n');

    const newLines = [];
    for (const line of rawLines) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (entry) newLines.push(entry);
      } catch (_) { /* skip unparseable */ }
    }

    return { newLines, newOffset: lastOffset + bytesRead };
  } catch (err) {
    if (fd !== null) { try { fs.closeSync(fd); } catch (_) {} }
    return { newLines: [], newOffset: lastOffset };
  }
}

// ---------------------------------------------------------------------------
// Helpers — tool use extraction
// ---------------------------------------------------------------------------

function extractToolUses(entry) {
  const content = entry.message && entry.message.content;
  if (!Array.isArray(content)) return [];
  return content.filter(item => item && item.type === 'tool_use');
}

function extractTargetPath(toolUse) {
  const input = toolUse.input || {};
  return input.file_path || input.notebook_path || input.path || null;
}

function extractCommand(toolUse) {
  if (toolUse.name !== 'Bash') return null;
  const cmd = (toolUse.input || {}).command;
  if (!cmd) return null;
  return typeof cmd === 'string' ? cmd.slice(0, 200) : null;
}

function computeStatus(lastActivityAt) {
  if (!lastActivityAt) return 'active';
  const ageMs = Date.now() - new Date(lastActivityAt).getTime();
  if (ageMs < 5 * 60 * 1000) return 'active';
  if (ageMs < 2 * 60 * 60 * 1000) return 'idle';
  return 'closed';
}

function readSubagentMeta(jsonlPath) {
  const metaPath = jsonlPath.replace(/\.jsonl$/, '.meta.json');
  try {
    const raw = fs.readFileSync(metaPath, 'utf8');
    const meta = JSON.parse(raw);
    return {
      agentType:   meta.agentType   || 'unknown',
      description: meta.description || null,
    };
  } catch (_) {
    return { agentType: 'unknown', description: null };
  }
}

// ---------------------------------------------------------------------------
// PG write helpers — fire-and-forget wrappers so PG errors don't block writes
// ---------------------------------------------------------------------------

function pgUpsertSession(doc) {
  const pg = globalThis.PgSessions;
  if (!pg || !pg.ready()) return;
  Promise.resolve(pg.upsertSession(doc)).catch(err => {
    console.warn('[claude-session-projector] pgUpsertSession error:', err.message);
  });
}

function pgUpsertSubagentFlight(doc) {
  const pg = globalThis.PgSessions;
  if (!pg || !pg.ready()) return;
  Promise.resolve(pg.upsertSubagentFlight(doc)).catch(err => {
    console.warn('[claude-session-projector] pgUpsertSubagentFlight error:', err.message);
  });
}

function pgInsertToolCall(doc) {
  const pg = globalThis.PgSessions;
  if (!pg || !pg.ready()) return;
  Promise.resolve(pg.insertToolCall(doc)).catch(err => {
    console.warn('[claude-session-projector] pgInsertToolCall error:', err.message);
  });
}

// ---------------------------------------------------------------------------
// Process new JSONL lines for a MAIN SESSION file.
// Writes session aggregate to PG. Inserts new ToolCalls to PG + ToolCallsLive.
//
// isBackfill: true during initial fullScan startup — suppresses emitFileTouch.
// ---------------------------------------------------------------------------

function processSessionLines(projName, filePath, newLines, sessionId, entity, projectKey, liveCol, isBackfill) {
  // Accumulate session aggregate from new lines only.
  // PG upsert uses GREATEST/COALESCE so we can safely pass partial updates.
  let messageCount         = 0;
  let toolCallCount        = 0;
  let totalInputTokens     = 0;
  let totalOutputTokens    = 0;
  let totalCacheReadTokens = 0;
  let startedAt            = null;
  let lastActivityAt       = null;
  let cwd                  = null;
  let gitBranch            = null;
  let version              = null;

  for (const entry of newLines) {
    const ts = entry.timestamp || null;

    if (ts && (!startedAt || ts < startedAt)) startedAt = ts;
    if (ts && (!lastActivityAt || ts > lastActivityAt)) lastActivityAt = ts;

    if ((entry.type === 'user' || entry.type === 'assistant') && entry.cwd && !cwd) {
      cwd = entry.cwd;
    }
    if ((entry.type === 'user' || entry.type === 'assistant') && entry.gitBranch && !gitBranch) {
      gitBranch = entry.gitBranch;
    }
    if ((entry.type === 'user' || entry.type === 'assistant') && entry.version && !version) {
      version = entry.version;
    }

    if (entry.type === 'user') {
      messageCount++;
    }

    if (entry.type === 'assistant') {
      messageCount++;

      const usage = (entry.message && entry.message.usage) || {};
      totalInputTokens     += usage.input_tokens              || 0;
      totalOutputTokens    += usage.output_tokens             || 0;
      totalCacheReadTokens += usage.cache_read_input_tokens   || 0;

      const toolUses = extractToolUses(entry);
      for (const toolUse of toolUses) {
        toolCallCount++;

        const rawTargetPath = extractTargetPath(toolUse);
        const tc = {
          sessionId,
          parentSessionId: null,
          agentId:         null,
          entity,
          toolName:        toolUse.name,
          toolUseId:       toolUse.id,
          targetPath:      rawTargetPath,
          command:         extractCommand(toolUse),
          timestamp:       ts,
          inputTokens:     usage.input_tokens              || 0,
          outputTokens:    usage.output_tokens             || 0,
          cacheReadTokens: usage.cache_read_input_tokens   || 0,
        };

        // Primary write — Postgres (idempotent)
        pgInsertToolCall(tc);

        // Live ring buffer — Mongo (atlas only)
        if (!isBackfill) {
          insertLive(liveCol, Object.assign({}, tc, {
            _id: crypto.createHash('md5').update(`${sessionId}:${toolUse.id}`).digest('hex'),
          }));
        }

        // file.touched emission (live only)
        if (!isBackfill && shouldEmitTouch(toolUse.name) && rawTargetPath) {
          const normalizedPath = normalizeTouchPath(rawTargetPath, cwd);
          if (normalizedPath) {
            emitFileTouch(entity, toolUse.name, normalizedPath, sessionId, null);
          }
        }
      }
    }
  }

  // Always upsert session to PG — GREATEST/COALESCE handles partial updates.
  // This ensures every session file on disk has a PG row after the initial scan,
  // even if this particular call only processed a subset of its lines.
  const sessionDoc = {
    sessionId,
    entity,
    projectKey,
    cwd,
    gitBranch,
    version,
    startedAt,
    lastActivityAt,
    messageCount,
    toolCallCount,
    totalInputTokens,
    totalOutputTokens,
    totalCacheReadTokens,
    status: computeStatus(lastActivityAt),
    filePath,
  };
  pgUpsertSession(sessionDoc);
}

// ---------------------------------------------------------------------------
// Process new JSONL lines for a SUBAGENT file.
// Writes flight aggregate to PG. Inserts new ToolCalls to PG + ToolCallsLive.
//
// isBackfill: true during initial fullScan — suppresses emitFileTouch.
// ---------------------------------------------------------------------------

function processSubagentLines(projName, filePath, newLines, agentId, parentSessionId, entity, liveCol, cwdResolver, isBackfill) {
  const meta           = readSubagentMeta(filePath);
  const subagentEntity = meta.agentType !== 'unknown'
    ? meta.agentType.toLowerCase()
    : entity;

  let toolCallCount        = 0;
  let toolCallSequence     = [];
  let totalInputTokens     = 0;
  let totalOutputTokens    = 0;
  let startedAt            = null;
  let endedAt              = null;

  for (const entry of newLines) {
    const ts = entry.timestamp || null;
    if (ts && (!startedAt || ts < startedAt)) startedAt = ts;
    if (ts && (!endedAt   || ts > endedAt))   endedAt   = ts;

    if (entry.type === 'assistant') {
      const usage = (entry.message && entry.message.usage) || {};
      totalInputTokens  += usage.input_tokens  || 0;
      totalOutputTokens += usage.output_tokens || 0;

      const toolUses = extractToolUses(entry);
      for (const toolUse of toolUses) {
        toolCallCount++;
        toolCallSequence.push(toolUse.name);

        const rawTargetPath = extractTargetPath(toolUse);
        const tc = {
          sessionId:       parentSessionId,
          parentSessionId,
          agentId,
          entity:          subagentEntity,
          toolName:        toolUse.name,
          toolUseId:       toolUse.id,
          targetPath:      rawTargetPath,
          command:         extractCommand(toolUse),
          timestamp:       ts,
          inputTokens:     usage.input_tokens              || 0,
          outputTokens:    usage.output_tokens             || 0,
          cacheReadTokens: usage.cache_read_input_tokens   || 0,
        };

        // Primary write — Postgres
        pgInsertToolCall(tc);

        // Live ring buffer — Mongo
        if (!isBackfill) {
          insertLive(liveCol, Object.assign({}, tc, {
            _id: crypto.createHash('md5').update(`${parentSessionId}:${toolUse.id}`).digest('hex'),
          }));
        }

        // file.touched emission (live only)
        if (!isBackfill && shouldEmitTouch(toolUse.name) && rawTargetPath) {
          const subagentCwd = cwdResolver ? cwdResolver(parentSessionId) : null;
          const normalizedPath = normalizeTouchPath(rawTargetPath, subagentCwd);
          if (normalizedPath) {
            emitFileTouch(subagentEntity, toolUse.name, normalizedPath, parentSessionId, agentId);
          }
        }
      }
    }
  }

  let durationMs = null;
  if (startedAt && endedAt) {
    durationMs = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  }

  const flightDoc = {
    agentId,
    parentSessionId,
    entity:          subagentEntity,
    agentType:       meta.agentType,
    description:     meta.description,
    startedAt,
    endedAt,
    durationMs,
    toolCallCount,
    toolCallSequence,
    totalInputTokens,
    totalOutputTokens,
    status:          computeStatus(endedAt),
    filePath,
  };
  pgUpsertSubagentFlight(flightDoc);
}

// ---------------------------------------------------------------------------
// Filename helpers
// ---------------------------------------------------------------------------

function sessionIdFromFilename(filename) {
  return filename.replace(/\.jsonl$/, '');
}

function agentIdFromFilename(filename) {
  return filename.replace(/^agent-/, '').replace(/\.jsonl$/, '');
}

function looksLikeSessionFile(filename) {
  if (!filename.endsWith('.jsonl')) return false;
  const base = filename.slice(0, -6); // .jsonl is 6 chars
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(base);
}

function looksLikeSubagentFile(filename) {
  return filename.startsWith('agent-') && filename.endsWith('.jsonl');
}

// ---------------------------------------------------------------------------
// Scan subagents/ dir — all subagent JSONLs under a session.
// ---------------------------------------------------------------------------

function scanSubagentsDir(projName, subagentsDir, parentSessionId, entity, liveCol, cwdResolver, isBackfill) {
  let entries;
  try {
    entries = fs.readdirSync(subagentsDir, { withFileTypes: true });
  } catch (_) {
    return 0;
  }

  let count = 0;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!looksLikeSubagentFile(entry.name)) continue;

    const filePath = path.join(subagentsDir, entry.name);
    const agentId  = agentIdFromFilename(entry.name);

    const { newLines, newOffset } = readNewLines(filePath, projName);
    // Always process subagent files — even if no new lines, we need the PG row.
    // readNewLines from offset=0 gives all lines on first scan.
    processSubagentLines(projName, filePath, newLines, agentId, parentSessionId, entity, liveCol, cwdResolver, isBackfill);
    setOffset(projName, filePath, newOffset);
    count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Scan one project-key directory.
// ---------------------------------------------------------------------------

function scanProjectKeyDir(projName, projectKeyDir, projectKey, entity, liveCol, cwdResolver, isBackfill) {
  let entries;
  try {
    entries = fs.readdirSync(projectKeyDir, { withFileTypes: true });
  } catch (_) {
    return;
  }

  // Scan session JSONL files
  for (const entry of entries) {
    if (entry.isFile() && looksLikeSessionFile(entry.name)) {
      const sessionId = sessionIdFromFilename(entry.name);
      const filePath  = path.join(projectKeyDir, entry.name);

      const { newLines, newOffset } = readNewLines(filePath, projName);
      // Always call processSessionLines — PG upsert is idempotent and
      // GREATEST/COALESCE handles partial updates safely. This ensures every
      // session file on disk has a PG row even if all content was already read.
      processSessionLines(projName, filePath, newLines, sessionId, entity, projectKey, liveCol, isBackfill);
      setOffset(projName, filePath, newOffset);
    }
  }

  // Scan subagent dirs (UUID-named subdirs)
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(entry.name)) continue;

    const parentSessionId = entry.name;
    const subagentsDir    = path.join(projectKeyDir, entry.name, 'subagents');
    scanSubagentsDir(projName, subagentsDir, parentSessionId, entity, liveCol, cwdResolver, isBackfill);
  }
}

// ---------------------------------------------------------------------------
// Full scan of the root source directory.
// ---------------------------------------------------------------------------

function fullScan(projName, sourceDir, entity, liveCol, cwdResolver) {
  let entries;
  try {
    entries = fs.readdirSync(sourceDir, { withFileTypes: true });
  } catch (err) {
    console.warn(`[claude-session-projector] ${projName}: cannot read source dir ${sourceDir}: ${err.message}`);
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const projectKeyDir = path.join(sourceDir, entry.name);
    scanProjectKeyDir(projName, projectKeyDir, entry.name, entity, liveCol, cwdResolver, true);
  }
}

// ---------------------------------------------------------------------------
// Directory watcher helper
// ---------------------------------------------------------------------------

function watchDir(projName, dirPath, label, onEvent) {
  try {
    if (!fs.existsSync(dirPath)) return null;

    const debounces = {};
    const watcher = fs.watch(dirPath, { persistent: false }, (eventType, filename) => {
      if (!filename) return;
      const key = `${label}:${filename}`;
      if (debounces[key]) clearTimeout(debounces[key]);
      debounces[key] = Meteor.setTimeout(() => {
        delete debounces[key];
        onEvent(eventType, filename, dirPath);
      }, 200);
    });

    watcher.on('error', err => {
      console.warn(`[claude-session-projector] ${projName}: watcher error on ${label}: ${err.message}`);
    });

    return watcher;
  } catch (err) {
    console.warn(`[claude-session-projector] ${projName}: could not watch ${dirPath} (${label}): ${err.message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Start a claude-session projector.
// ---------------------------------------------------------------------------

function start(config) {
  const { name } = config;
  const entity   = config.entity || 'unknown';

  const sourceDir = config.sourcePath || config.source || null;
  if (!sourceDir) {
    console.warn(`[claude-session-projector] ${name}: no source path — skipping`);
    return;
  }

  // Ensure ToolCallsLive ring buffer collection exists
  const liveCol = getOrCreateToolCallsLive();

  // Resolve CWD for subagent file.touched from PG sessions table.
  // This is best-effort — if PG isn't ready we skip normalization.
  function cwdResolver(sessionId) {
    const pg = globalThis.PgSessions;
    if (!pg || !pg.ready()) return null;
    // Synchronous lookup not possible in async PG context; return null and
    // skip normalization for subagent touch events during live path.
    return null;
  }

  // Ensure source dir exists
  try {
    if (!fs.existsSync(sourceDir)) {
      fs.mkdirSync(sourceDir, { recursive: true });
    }
  } catch (err) {
    console.warn(`[claude-session-projector] ${name}: sourceDir setup error: ${err.message}`);
  }

  // --- Initial full scan ---
  // PgSessions bootstrap is async. Poll until ready (up to 30s) before scanning
  // so session upserts don't silently no-op when PG isn't connected yet.
  // Tool calls and subagent flights write to PG via the same guard, so this
  // delay ensures all three tables are populated from the initial scan.
  console.log(`[claude-session-projector] ${name}: waiting for PgSessions...`);

  let _pgWaitAttempts = 0;
  const _pgWaitMax    = 60; // 60 × 500ms = 30s max wait

  function _doScan() {
    const pg = globalThis.PgSessions;
    if (pg && pg.ready()) {
      console.log(`[claude-session-projector] ${name}: PgSessions ready — initial scan of ${sourceDir} (entity: ${entity})`);
      fullScan(name, sourceDir, entity, liveCol, cwdResolver);
      console.log(`[claude-session-projector] ${name}: startup scan dispatched to PG — counts settling asynchronously`);
      // Log PG counts after a short settle to confirm writes landed
      Meteor.setTimeout(() => {
        const pg2 = globalThis.PgSessions;
        if (pg2 && pg2.ready()) {
          pg2.counts().then(c => {
            console.log(`[claude-session-projector] ${name}: PG counts after settle — sessions:${c.sessions} subagents:${c.subagentFlights} toolCalls:${c.toolCalls}`);
          }).catch(() => {});
        }
      }, 10000);
    } else {
      _pgWaitAttempts++;
      if (_pgWaitAttempts >= _pgWaitMax) {
        console.warn(`[claude-session-projector] ${name}: PgSessions not ready after 30s — scanning anyway (writes may fail silently)`);
        fullScan(name, sourceDir, entity, liveCol, cwdResolver);
        console.log(`[claude-session-projector] ${name}: startup scan complete (PG unavailable)`);
      } else {
        Meteor.setTimeout(_doScan, 500);
      }
    }
  }

  _doScan();

  // --- Prune ToolCallsLive every 30s ---
  const pruneTimer = Meteor.setInterval(() => {
    pruneToolCallsLive(liveCol);
  }, 30 * 1000);

  // --- Watchers ---

  const activeWatchers = [];

  function processSessionFile(filePath, sessionId, projectKey) {
    if (!fs.existsSync(filePath)) return;
    const { newLines, newOffset } = readNewLines(filePath, name);
    if (newLines.length > 0) {
      processSessionLines(name, filePath, newLines, sessionId, entity, projectKey, liveCol, false);
    }
    setOffset(name, filePath, newOffset);
  }

  function processSubagentFile(filePath, agentId, parentSessionId) {
    if (!fs.existsSync(filePath)) return;
    const { newLines, newOffset } = readNewLines(filePath, name);
    if (newLines.length > 0) {
      processSubagentLines(name, filePath, newLines, agentId, parentSessionId, entity, liveCol, cwdResolver, false);
      setOffset(name, filePath, newOffset);
    }
  }

  function watchProjectKeyDir(projectKeyDir, projectKey) {
    const w = watchDir(name, projectKeyDir, `project-key:${projectKey}`, (eventType, filename, dir) => {
      const filePath = path.join(dir, filename);
      if (looksLikeSessionFile(filename)) {
        const sessionId = sessionIdFromFilename(filename);
        processSessionFile(filePath, sessionId, projectKey);
        attachSessionFileWatcher(filePath, sessionId, projectKey);
      } else if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
        const subagentsDir = path.join(filePath, 'subagents');
        watchSubagentsDir(subagentsDir, filename /* parentSessionId */);
      }
    });
    if (w) activeWatchers.push(w);

    try {
      const entries = fs.readdirSync(projectKeyDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && looksLikeSessionFile(entry.name)) {
          const sessionId = sessionIdFromFilename(entry.name);
          const filePath  = path.join(projectKeyDir, entry.name);
          attachSessionFileWatcher(filePath, sessionId, projectKey);
        }
        if (entry.isDirectory() &&
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(entry.name)) {
          const subagentsDir = path.join(projectKeyDir, entry.name, 'subagents');
          watchSubagentsDir(subagentsDir, entry.name);
        }
      }
    } catch (_) {}
  }

  function attachSessionFileWatcher(filePath, sessionId, projectKey) {
    ensureFileWatcher(name, filePath, () => {
      processSessionFile(filePath, sessionId, projectKey);
    });
  }

  function attachSubagentFileWatcher(filePath, agentId, parentSessionId) {
    ensureFileWatcher(name, filePath, () => {
      processSubagentFile(filePath, agentId, parentSessionId);
    });
  }

  function watchSubagentsDir(subagentsDir, parentSessionId) {
    const w = watchDir(name, subagentsDir, `subagents:${parentSessionId}`, (eventType, filename, dir) => {
      if (!looksLikeSubagentFile(filename)) return;
      const filePath = path.join(dir, filename);
      if (!fs.existsSync(filePath)) return;

      const agentId = agentIdFromFilename(filename);
      processSubagentFile(filePath, agentId, parentSessionId);
      attachSubagentFileWatcher(filePath, agentId, parentSessionId);
    });
    if (w) activeWatchers.push(w);

    try {
      const entries = fs.readdirSync(subagentsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !looksLikeSubagentFile(entry.name)) continue;
        const filePath = path.join(subagentsDir, entry.name);
        const agentId  = agentIdFromFilename(entry.name);
        attachSubagentFileWatcher(filePath, agentId, parentSessionId);
      }
    } catch (_) {}
  }

  const sourceDirWatcher = watchDir(name, sourceDir, 'source', (eventType, filename, dir) => {
    const fullPath = path.join(dir, filename);
    try {
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
        scanProjectKeyDir(name, fullPath, filename, entity, liveCol, cwdResolver, false);
        watchProjectKeyDir(fullPath, filename);
      }
    } catch (_) {}
  });
  if (sourceDirWatcher) activeWatchers.push(sourceDirWatcher);

  try {
    const pkEntries = fs.readdirSync(sourceDir, { withFileTypes: true });
    for (const entry of pkEntries) {
      if (!entry.isDirectory()) continue;
      const projectKeyDir = path.join(sourceDir, entry.name);
      watchProjectKeyDir(projectKeyDir, entry.name);
    }
  } catch (_) {}

  _running[name] = { config, activeWatchers, pruneTimer };
}

// ---------------------------------------------------------------------------
// Stop a named projector.
// ---------------------------------------------------------------------------

function stop(name) {
  const entry = _running[name];
  if (!entry) return;

  for (const w of (entry.activeWatchers || [])) {
    try { w.close(); } catch (_) {}
  }

  closeFileWatchers(name);

  if (entry.pruneTimer) {
    try { Meteor.clearInterval(entry.pruneTimer); } catch (_) {}
  }

  clearOffsets(name);
  delete _running[name];
  console.log(`[claude-session-projector] stopped projector: ${name}`);
}

// ---------------------------------------------------------------------------
// Reload — stop removed, start new, leave running unchanged.
// ---------------------------------------------------------------------------

function reload(newConfigs) {
  const claudeSessionConfigs = newConfigs.filter(c => c.format === 'claude-session');
  const newNames  = new Set(claudeSessionConfigs.map(c => c.name));
  const oldNames  = new Set(Object.keys(_running));

  for (const name of oldNames) {
    if (!newNames.has(name)) {
      console.log(`[claude-session-projector] reload: removing ${name}`);
      stop(name);
    }
  }

  for (const cfg of claudeSessionConfigs) {
    if (!oldNames.has(cfg.name)) {
      console.log(`[claude-session-projector] reload: starting new indexer ${cfg.name}`);
      start(cfg);
    } else {
      const hashFn = globalThis.IndexerRegistry && globalThis.IndexerRegistry.configHash;
      const oldConfig = _running[cfg.name] && _running[cfg.name].config;
      const oldHash = oldConfig && (oldConfig._configHash || (hashFn && hashFn(oldConfig)));
      const newHash = cfg._configHash || (hashFn && hashFn(cfg));
      if (newHash && oldHash && newHash !== oldHash) {
        console.log(`[claude-session-projector] reload: ${cfg.name} config changed — restarting`);
        stop(cfg.name);
        start(cfg);
      } else {
        console.log(`[claude-session-projector] reload: ${cfg.name} unchanged — no-op`);
      }
    }
  }
}

// Export
globalThis.ClaudeSessionProjector = { start, stop, reload };
