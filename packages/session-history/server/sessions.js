// Sessions indexer — file-watching, 500ms debounce
// Indexes ~/.forge/archive/sessions/**/*.jsonl and ~/.forge/archive/legacy/**/*.jsonl
// into two in-memory collections:
//   Sessions     — one record per JSONL file, with metadata + summary
//   SessionFiles — one record per (session, touched_file) pair (edges)
//
// Publishes: sessions.index (all Sessions), sessions.files (all SessionFiles)
// Gate: KOAD_IO_INDEX_SESSIONS env var
//
// Modeled on documents.js in the same dir.

const fs   = Npm.require('fs');
const path = Npm.require('path');
const os   = Npm.require('os');

const HOME = process.env.HOME || os.homedir();

// Kingdom-owned path prefixes — only track files under these roots.
const KINGDOM_PREFIXES = [
  HOME + '/.',          // ~/.<entity>/
  HOME + '/.forge/',
  HOME + '/.koad-io/',
];

function isKingdomPath(p) {
  if (!p || typeof p !== 'string') return false;
  for (const prefix of KINGDOM_PREFIXES) {
    if (p.startsWith(prefix)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Collections — connection: null → in-memory (daemon runs MONGO_URL=false)
// ---------------------------------------------------------------------------
const Sessions     = new Mongo.Collection('Sessions',     { connection: null });
const SessionFiles = new Mongo.Collection('SessionFiles', { connection: null });

if (!globalThis.indexerReady) globalThis.indexerReady = {};

// ---------------------------------------------------------------------------
// Deterministic _id for a (session_id, touched_path) pair
// ---------------------------------------------------------------------------
function sessionFileId(session_id, touched_path) {
  const s = session_id + '\0' + touched_path;
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
    h = h >>> 0;
  }
  return h.toString(36) + '_' + s.length.toString(36);
}

// ---------------------------------------------------------------------------
// Extract tool-use file paths from a parsed JSONL line object
// ---------------------------------------------------------------------------
const FILE_TOOLS = new Set(['Read', 'Edit', 'Write', 'NotebookEdit']);
const BASH_PATH_RE = /\/home\/koad\/(?:\.[^/\s"'\\]+|\.forge|\.koad-io)(?:\/[^\s"'\\]+)*/g;

function extractToolPaths(obj) {
  // Returns array of { tool, file_path }
  const results = [];

  const content = obj && obj.message && obj.message.content;
  if (!Array.isArray(content)) return results;

  for (const block of content) {
    if (!block || block.type !== 'tool_use') continue;
    const name = block.name;
    const inp  = block.input || {};

    if (FILE_TOOLS.has(name) && inp.file_path) {
      if (isKingdomPath(inp.file_path)) {
        results.push({ tool: name, file_path: inp.file_path });
      }
    } else if (name === 'Bash' && inp.command) {
      const matches = inp.command.match(BASH_PATH_RE);
      if (matches) {
        for (const p of matches) {
          if (isKingdomPath(p)) {
            results.push({ tool: 'Bash', file_path: p });
          }
        }
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Build a Sessions record + SessionFiles records from a JSONL file path
// ---------------------------------------------------------------------------
function parseSessionFile(filePath) {
  let text;
  try { text = fs.readFileSync(filePath, 'utf8'); }
  catch { return null; }

  const lines = text.split('\n').filter(Boolean);

  let session_id = null;
  let started_at = null;
  let harness    = 'unknown';
  let entity     = null;
  let turn_count = 0;
  let tool_call_count = 0;
  let summary    = null;

  // touched_path → { tool, count }
  const touchedMap = new Map();

  for (const line of lines) {
    let obj;
    try { obj = JSON.parse(line); }
    catch { continue; }

    // Session ID: prefer agentId (modern), fall back to sessionId (legacy)
    if (!session_id) {
      session_id = obj.agentId || obj.sessionId || null;
    }

    // Timestamp: first timestamped turn
    if (!started_at && obj.timestamp) {
      try { started_at = new Date(obj.timestamp); }
      catch {}
    }

    // Harness detection: presence of agentId indicates claude-code shape
    if (!harness || harness === 'unknown') {
      if (obj.agentId) {
        harness = 'claude-code';
      } else if (obj.sessionId && !obj.agentId) {
        harness = 'claude-code'; // legacy opencode/claude shape
      }
    }

    // Entity: from cwd field (e.g. /home/koad/.vulcan → vulcan)
    if (!entity && obj.cwd) {
      const cwdMatch = obj.cwd.match(/\/home\/koad\/\.([^/]+)/);
      if (cwdMatch && cwdMatch[1] !== 'forge' && cwdMatch[1] !== 'koad-io') {
        entity = cwdMatch[1];
      }
    }

    // Turns: count user/assistant lines
    if (obj.type === 'user' || obj.type === 'assistant') {
      turn_count++;
    }

    // Summary: first user message body, truncated to 300 chars
    if (!summary && obj.type === 'user') {
      const msg = obj.message;
      if (msg) {
        let body = '';
        if (typeof msg.content === 'string') {
          body = msg.content;
        } else if (Array.isArray(msg.content)) {
          const textBlock = msg.content.find(b => b && b.type === 'text');
          if (textBlock) body = textBlock.text || '';
        } else if (typeof msg === 'string') {
          body = msg;
        }
        if (body) summary = body.slice(0, 300);
      }
    }

    // Tool calls: extract file paths
    if (obj.type === 'assistant') {
      const paths = extractToolPaths(obj);
      for (const { tool, file_path } of paths) {
        tool_call_count++;
        if (touchedMap.has(file_path)) {
          const entry = touchedMap.get(file_path);
          entry.count++;
          // Keep the first tool name (most significant)
        } else {
          touchedMap.set(file_path, { tool, count: 1 });
        }
      }
    }
  }

  // Fall back: derive session_id from filename if not found in content
  if (!session_id) {
    session_id = path.basename(filePath, '.jsonl');
  }

  // Fall back: started_at from dir date
  if (!started_at) {
    const dirName = path.basename(path.dirname(filePath));
    if (/^\d{4}-\d{2}-\d{2}$/.test(dirName)) {
      try { started_at = new Date(dirName + 'T00:00:00.000Z'); }
      catch {}
    }
  }

  let stat;
  try { stat = fs.statSync(filePath); }
  catch { return null; }

  const sessionRecord = {
    _id:            session_id,
    path:           filePath,
    started_at:     started_at || null,
    harness,
    entity:         entity || null,
    turn_count,
    tool_call_count,
    summary:        summary || null,
    mtime:          stat.mtime,
    asof:           new Date(),
  };

  const fileRecords = [];
  for (const [touched_path, { tool, count }] of touchedMap) {
    fileRecords.push({
      _id:          sessionFileId(session_id, touched_path),
      session_id,
      touched_path,
      tool,
      count,
      asof:         new Date(),
    });
  }

  return { sessionRecord, fileRecords };
}

// ---------------------------------------------------------------------------
// Upsert a session + its file-touch records
// ---------------------------------------------------------------------------
function upsertSession(sessionRecord, fileRecords) {
  if (!sessionRecord) return;

  const existing = Sessions.findOne({ _id: sessionRecord._id });
  if (existing) {
    Sessions.update(sessionRecord._id, { $set: sessionRecord });
  } else {
    try { Sessions.insert(sessionRecord); }
    catch { Sessions.update(sessionRecord._id, { $set: sessionRecord }); }
  }

  // Remove stale file-touch records for this session, then re-insert
  SessionFiles.remove({ session_id: sessionRecord._id });
  for (const r of fileRecords) {
    try { SessionFiles.insert(r); }
    catch { SessionFiles.update(r._id, { $set: r }); }
  }
}

// ---------------------------------------------------------------------------
// Index a single JSONL file
// ---------------------------------------------------------------------------
function indexFile(filePath) {
  if (!filePath.endsWith('.jsonl')) return;

  const result = parseSessionFile(filePath);
  if (result) {
    upsertSession(result.sessionRecord, result.fileRecords);
  } else {
    // File gone — remove it
    const id = path.basename(filePath, '.jsonl');
    Sessions.remove({ _id: id });
    SessionFiles.remove({ session_id: id });
  }
}

// ---------------------------------------------------------------------------
// Walk a directory for .jsonl files
// ---------------------------------------------------------------------------
function walkJsonl(dir) {
  const out = [];
  function walk(d) {
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); }
    catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        walk(p);
      } else if (e.isFile() && e.name.endsWith('.jsonl')) {
        out.push(p);
      }
    }
  }
  walk(dir);
  return out;
}

// ---------------------------------------------------------------------------
// Archive directories to index
// ---------------------------------------------------------------------------
const ARCHIVE_DIRS = [
  path.join(HOME, '.forge', 'archive', 'sessions'),
  path.join(HOME, '.forge', 'archive', 'legacy'),
];

// ---------------------------------------------------------------------------
// Full scan of all archive dirs
// ---------------------------------------------------------------------------
function fullScan() {
  const t0 = Date.now();
  console.log('[SESSIONS] Starting full scan...');

  let sessionCount = 0;
  let edgeCount = 0;

  for (const dir of ARCHIVE_DIRS) {
    if (!fs.existsSync(dir)) continue;
    const files = walkJsonl(dir);
    for (const f of files) {
      const result = parseSessionFile(f);
      if (result) {
        upsertSession(result.sessionRecord, result.fileRecords);
        sessionCount++;
        edgeCount += result.fileRecords.length;
      }
    }
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
  console.log(`[SESSIONS] Scan complete: ${sessionCount} sessions, ${edgeCount} file-touch edges in ${elapsed}s`);

  globalThis.indexerReady.sessions = new Date().toISOString();
  koad.ready.signal('sessions');
}

// ---------------------------------------------------------------------------
// File-watching — debounce per file path
// ---------------------------------------------------------------------------
const _debounceTimers = new Map();
const _watchers       = new Map();

function debounce(key, fn, delay) {
  if (_debounceTimers.has(key)) {
    Meteor.clearTimeout(_debounceTimers.get(key));
  }
  _debounceTimers.set(key, Meteor.setTimeout(() => {
    _debounceTimers.delete(key);
    fn();
  }, delay));
}

function watchArchiveDir(dir) {
  if (_watchers.has(dir)) return;
  if (!fs.existsSync(dir)) return;

  try {
    const watcher = fs.watch(dir, { recursive: true, persistent: false }, (event, filename) => {
      if (!filename || !filename.endsWith('.jsonl')) return;
      const fullPath = path.join(dir, filename);
      debounce(fullPath, () => indexFile(fullPath), 500);
    });
    _watchers.set(dir, watcher);
  } catch (e) {
    // Some dirs may not support recursive watching — silent.
  }
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
Meteor.startup(() => {
  koad.ready.register('sessions');
  const mode = process.env.KOAD_IO_INDEX_SESSIONS;
  if (!mode) {
    koad.ready.signal('sessions');
    return;
  }

  // Run scan after 3s to let other indexers settle
  Meteor.setTimeout(() => {
    fullScan();

    // Set up file watchers on archive dirs
    for (const dir of ARCHIVE_DIRS) {
      watchArchiveDir(dir);
    }
  }, 3000);
});

// ---------------------------------------------------------------------------
// DDP publications
// ---------------------------------------------------------------------------
Meteor.publish('sessions.index', async function () {
  await koad.ready.await('sessions');
  return Sessions.find();
});

Meteor.publish('sessions.files', async function () {
  await koad.ready.await('sessions');
  return SessionFiles.find();
});
