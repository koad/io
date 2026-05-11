// claude-session-projector.js — project Claude Code JSONL session files into Mongo
//
// Handles indexer configs with format: claude-session
//
// Watches a projects/ directory for session JSONL files and subagent JSONL files.
// Produces three collections from the raw transcript data.
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
// Output collections (all connection: null, published as indexed.*):
//
//   Sessions — one doc per session JSONL:
//     _id:                  session UUID (from JSONL entries)
//     entity:               from config.entity
//     projectKey:           the project-key directory name
//     sessionId:            same as _id
//     cwd:                  from first user/assistant entry
//     gitBranch:            from first user/assistant entry
//     version:              harness version string
//     startedAt:            timestamp of first entry
//     lastActivityAt:       timestamp of last entry seen
//     messageCount:         number of user+assistant entries
//     toolCallCount:        total tool_use blocks seen
//     totalInputTokens:     sum of usage.input_tokens
//     totalOutputTokens:    sum of usage.output_tokens
//     totalCacheReadTokens: sum of usage.cache_read_input_tokens
//     subagentCount:        number of subagent files for this session
//     status:               "active" | "idle" | "closed"  (heuristic)
//     filePath:             absolute path to the JSONL file
//
//   SubagentFlights — one doc per subagent JSONL:
//     _id:               agentId (from filename)
//     parentSessionId:   parent session UUID
//     agentType:         from meta.json (or "unknown")
//     description:       from meta.json (or null)
//     entity:            from config.entity (or agentType if cross-entity)
//     startedAt:         timestamp of first entry
//     endedAt:           timestamp of last entry
//     durationMs:        endedAt − startedAt
//     toolCallCount:     total tool_use blocks
//     toolCallSequence:  ordered array of tool names
//     totalInputTokens:  sum of usage.input_tokens
//     totalOutputTokens: sum of usage.output_tokens
//     status:            "active" | "closed"
//     filePath:          absolute path
//
//   ToolCalls — one doc per tool_use block in any session or subagent:
//     _id:                     MD5(sessionId + ":" + toolUseId)
//     sessionId:               parent session UUID
//     agentId:                 agentId for subagent calls, null for main session
//     entity:                  the acting entity (config.entity or agentType)
//     toolName:                e.g. "Bash", "Read", "Edit", "Write", "Agent"
//     toolUseId:               raw tool_use.id from JSONL
//     targetPath:              file_path/notebook_path input for file tools, null otherwise
//     command:                 for Bash, first 200 chars of command; null otherwise
//     timestamp:               from the containing assistant message
//     inputTokens:             usage.input_tokens for the turn (or 0)
//     outputTokens:            usage.output_tokens for the turn (or 0)
//     cacheReadTokens:         usage.cache_read_input_tokens for the turn (or 0)
//
// Byte-offset tracking:
//   Each watched file keeps its last-read byte offset in a Map.
//   On watcher event, only new bytes (beyond the stored offset) are parsed.
//   This lets the projector handle large, append-only files efficiently.
//
// Publications: indexed.Sessions, indexed.SubagentFlights, indexed.ToolCalls

const fs     = Npm.require('fs');
const path   = Npm.require('path');
const crypto = Npm.require('crypto');

// Track running projectors for reload
const _running = {}; // name → { config, watcher, directoryWatchers, collections }

// ---------------------------------------------------------------------------
// Byte-offset store — per projector-name, per file path.
// ---------------------------------------------------------------------------

// offsets[projectorName][filePath] = byteOffset
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
// Generate a stable _id for a ToolCall: MD5(sessionId:toolUseId)
// ---------------------------------------------------------------------------

function toolCallId(sessionId, toolUseId) {
  return crypto
    .createHash('md5')
    .update(`${sessionId}:${toolUseId}`)
    .digest('hex');
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
// Read all JSONL lines from a file (full scan, no offset tracking).
// Used for initial session metadata derivation from existing files.
// ---------------------------------------------------------------------------

function readAllLines(filePath) {
  try {
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, 'utf8');
    const result = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (entry) result.push(entry);
      } catch (_) {}
    }
    return result;
  } catch (_) {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Extract tool uses from an assistant entry's content array.
// Returns array of { id, name, input }.
// ---------------------------------------------------------------------------

function extractToolUses(entry) {
  const content = entry.message && entry.message.content;
  if (!Array.isArray(content)) return [];
  return content.filter(item => item && item.type === 'tool_use');
}

// ---------------------------------------------------------------------------
// Derive targetPath from a tool_use block.
// File tools carry file_path, notebook_path, or path in their input.
// ---------------------------------------------------------------------------

function extractTargetPath(toolUse) {
  const input = toolUse.input || {};
  return input.file_path || input.notebook_path || input.path || null;
}

// ---------------------------------------------------------------------------
// Derive command snippet from a Bash tool_use block (first 200 chars).
// ---------------------------------------------------------------------------

function extractCommand(toolUse) {
  if (toolUse.name !== 'Bash') return null;
  const cmd = (toolUse.input || {}).command;
  if (!cmd) return null;
  return typeof cmd === 'string' ? cmd.slice(0, 200) : null;
}

// ---------------------------------------------------------------------------
// Compute session status heuristic.
// Active: last activity within 5 minutes.
// Idle: between 5 minutes and 2 hours.
// Closed: more than 2 hours ago.
// ---------------------------------------------------------------------------

function computeStatus(lastActivityAt) {
  if (!lastActivityAt) return 'active';
  const ageMs = Date.now() - new Date(lastActivityAt).getTime();
  if (ageMs < 5 * 60 * 1000) return 'active';
  if (ageMs < 2 * 60 * 60 * 1000) return 'idle';
  return 'closed';
}

// ---------------------------------------------------------------------------
// Read meta.json for a subagent (sibling to the .jsonl file).
// Returns { agentType, description } or defaults.
// ---------------------------------------------------------------------------

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
// Upsert or update a document in a collection.
// For Sessions and SubagentFlights: merge aggregates (use $set + $inc logic).
// We avoid $inc by computing full values and doing a full $set.
// ---------------------------------------------------------------------------

function upsertDoc(collection, _id, doc) {
  const existing = collection.findOne(_id);
  if (existing) {
    collection.update(_id, { $set: doc });
  } else {
    try {
      collection.insert(Object.assign({}, doc, { _id }));
    } catch (err) {
      // Race between initial scan and watcher — fall back to update
      if (err.message && err.message.includes('Duplicate _id')) {
        collection.update(_id, { $set: doc });
      } else {
        throw err;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Process new JSONL lines for a MAIN SESSION file.
// Updates Sessions doc and inserts new ToolCalls docs.
// Returns the updated session aggregate data (for upsert).
// ---------------------------------------------------------------------------

function processSessionLines(projName, filePath, newLines, sessionId, entity, projectKey, collections) {
  const { Sessions, ToolCalls } = collections;
  const existing = Sessions.findOne(sessionId) || {};

  // Aggregate running totals from existing doc
  let messageCount         = existing.messageCount         || 0;
  let toolCallCount        = existing.toolCallCount        || 0;
  let totalInputTokens     = existing.totalInputTokens     || 0;
  let totalOutputTokens    = existing.totalOutputTokens    || 0;
  let totalCacheReadTokens = existing.totalCacheReadTokens || 0;
  let startedAt            = existing.startedAt            || null;
  let lastActivityAt       = existing.lastActivityAt       || null;
  let cwd                  = existing.cwd                  || null;
  let gitBranch            = existing.gitBranch            || null;
  let version              = existing.version              || null;

  for (const entry of newLines) {
    const ts = entry.timestamp || null;

    // Track earliest timestamp
    if (ts && (!startedAt || ts < startedAt)) startedAt = ts;
    // Track latest timestamp
    if (ts && (!lastActivityAt || ts > lastActivityAt)) lastActivityAt = ts;

    // Grab cwd, gitBranch, version from user or assistant entries
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

      // Extract tool uses
      const toolUses = extractToolUses(entry);
      for (const toolUse of toolUses) {
        toolCallCount++;

        const tcId = toolCallId(sessionId, toolUse.id);
        // Skip if already inserted
        if (ToolCalls.findOne(tcId)) continue;

        const tc = {
          sessionId,
          agentId:          null,
          entity,
          toolName:         toolUse.name,
          toolUseId:        toolUse.id,
          targetPath:       extractTargetPath(toolUse),
          command:          extractCommand(toolUse),
          timestamp:        ts,
          inputTokens:      usage.input_tokens              || 0,
          outputTokens:     usage.output_tokens             || 0,
          cacheReadTokens:  usage.cache_read_input_tokens   || 0,
        };
        upsertDoc(ToolCalls, tcId, tc);
      }
    }
  }

  const sessionDoc = {
    entity,
    projectKey,
    sessionId,
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
  // subagentCount is managed separately when subagent dirs are scanned
  if (existing.subagentCount !== undefined) {
    sessionDoc.subagentCount = existing.subagentCount;
  }

  upsertDoc(Sessions, sessionId, sessionDoc);
}

// ---------------------------------------------------------------------------
// Process new JSONL lines for a SUBAGENT file.
// Updates SubagentFlights doc and inserts new ToolCalls docs.
// ---------------------------------------------------------------------------

function processSubagentLines(projName, filePath, newLines, agentId, parentSessionId, entity, collections) {
  const { SubagentFlights, ToolCalls } = collections;
  const existing = SubagentFlights.findOne(agentId) || {};

  let toolCallCount        = existing.toolCallCount        || 0;
  let toolCallSequence     = existing.toolCallSequence     || [];
  let totalInputTokens     = existing.totalInputTokens     || 0;
  let totalOutputTokens    = existing.totalOutputTokens    || 0;
  let startedAt            = existing.startedAt            || null;
  let endedAt              = existing.endedAt              || null;

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

        const tcId = toolCallId(parentSessionId, toolUse.id);
        if (ToolCalls.findOne(tcId)) continue;

        const tc = {
          sessionId:       parentSessionId,
          agentId,
          entity,
          toolName:        toolUse.name,
          toolUseId:       toolUse.id,
          targetPath:      extractTargetPath(toolUse),
          command:         extractCommand(toolUse),
          timestamp:       ts,
          inputTokens:     usage.input_tokens              || 0,
          outputTokens:    usage.output_tokens             || 0,
          cacheReadTokens: usage.cache_read_input_tokens   || 0,
        };
        upsertDoc(ToolCalls, tcId, tc);
      }
    }
  }

  // Derive duration and status
  let durationMs = null;
  if (startedAt && endedAt) {
    durationMs = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  }
  const status = computeStatus(endedAt);

  const meta = readSubagentMeta(filePath);

  const flightDoc = {
    parentSessionId,
    agentType:       existing.agentType   || meta.agentType,
    description:     existing.description || meta.description,
    entity,
    startedAt,
    endedAt,
    durationMs,
    toolCallCount,
    toolCallSequence,
    totalInputTokens,
    totalOutputTokens,
    status,
    filePath,
  };

  upsertDoc(SubagentFlights, agentId, flightDoc);
}

// ---------------------------------------------------------------------------
// Parse the session UUID from a JSONL filename (strip .jsonl extension).
// ---------------------------------------------------------------------------

function sessionIdFromFilename(filename) {
  // filename like: 6a3594db-43d2-4964-8b3e-b7eae160fa2a.jsonl
  return filename.replace(/\.jsonl$/, '');
}

// ---------------------------------------------------------------------------
// Parse the agent ID from a subagent JSONL filename.
// filename like: agent-abcd11d1851d09b89.jsonl → abcd11d1851d09b89
// ---------------------------------------------------------------------------

function agentIdFromFilename(filename) {
  return filename.replace(/^agent-/, '').replace(/\.jsonl$/, '');
}

// ---------------------------------------------------------------------------
// Check if a filename looks like a UUID (basic heuristic).
// ---------------------------------------------------------------------------

function looksLikeSessionFile(filename) {
  // Must be *.jsonl and look like a UUID
  if (!filename.endsWith('.jsonl')) return false;
  const base = filename.slice(0, -5);
  // UUID pattern: 8-4-4-4-12
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(base);
}

// ---------------------------------------------------------------------------
// Check if a filename looks like a subagent file.
// ---------------------------------------------------------------------------

function looksLikeSubagentFile(filename) {
  return filename.startsWith('agent-') && filename.endsWith('.jsonl');
}

// ---------------------------------------------------------------------------
// Discover and scan all subagent files under a session's subagents/ dir.
// Updates subagentCount on the parent Sessions doc.
// ---------------------------------------------------------------------------

function scanSubagentsDir(projName, subagentsDir, parentSessionId, entity, collections) {
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
    if (newLines.length > 0 || !collections.SubagentFlights.findOne(agentId)) {
      // Full scan needed for new files (newLines only has bytes since last offset)
      // If this file is new (no offset), readNewLines returns all content from 0
      processSubagentLines(projName, filePath, newLines, agentId, parentSessionId, entity, collections);
    }
    setOffset(projName, filePath, newOffset);
    count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Scan one project-key directory: find session JSONLs and their subagents/ dirs.
// ---------------------------------------------------------------------------

function scanProjectKeyDir(projName, projectKeyDir, projectKey, entity, collections) {
  let entries;
  try {
    entries = fs.readdirSync(projectKeyDir, { withFileTypes: true });
  } catch (_) {
    return;
  }

  // Build a set of session UUIDs that have subagent dirs
  for (const entry of entries) {
    if (entry.isFile() && looksLikeSessionFile(entry.name)) {
      const sessionId = sessionIdFromFilename(entry.name);
      const filePath  = path.join(projectKeyDir, entry.name);

      const { newLines, newOffset } = readNewLines(filePath, projName);
      if (newLines.length > 0 || !collections.Sessions.findOne(sessionId)) {
        processSessionLines(projName, filePath, newLines, sessionId, entity, projectKey, collections);
      }
      setOffset(projName, filePath, newOffset);
    }
  }

  // Now scan for subagent dirs (these are directories with UUID names)
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    // Check if it looks like a session UUID dir
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(entry.name)) continue;

    const parentSessionId = entry.name;
    const subagentsDir    = path.join(projectKeyDir, entry.name, 'subagents');
    const count           = scanSubagentsDir(projName, subagentsDir, parentSessionId, entity, collections);

    // Update subagentCount on the parent session doc if it exists
    if (count > 0) {
      const sessionDoc = collections.Sessions.findOne(parentSessionId);
      if (sessionDoc) {
        const existing = sessionDoc.subagentCount || 0;
        if (existing !== count) {
          collections.Sessions.update(parentSessionId, { $set: { subagentCount: count } });
        }
      } else {
        // Session file may not have been seen yet — store for when it arrives
        // (will be picked up when session file is scanned)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Full scan of the root source directory.
// Walks all project-key subdirectories.
// ---------------------------------------------------------------------------

function fullScan(projName, sourceDir, entity, collections) {
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
    scanProjectKeyDir(projName, projectKeyDir, entry.name, entity, collections);
  }
}

// ---------------------------------------------------------------------------
// Watch a directory and debounce events.
// Returns the fs.FSWatcher instance, or null on error.
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

  // --- Create or reuse collections ---

  function getOrCreateCollection(collectionName) {
    if (globalThis[collectionName] instanceof Mongo.Collection) {
      console.log(`[claude-session-projector] ${name}: reusing collection ${collectionName}`);
      return globalThis[collectionName];
    }
    const col = new Mongo.Collection(collectionName, { connection: null });
    globalThis[collectionName] = col;
    console.log(`[claude-session-projector] ${name}: created collection ${collectionName}`);
    return col;
  }

  function registerPublication(collectionName, col) {
    const pubName = `indexed.${collectionName}`;
    try {
      Meteor.publish(pubName, function () {
        return col.find();
      });
      console.log(`[claude-session-projector] ${name}: registered publication ${pubName}`);
    } catch (err) {
      if (!err.message || !err.message.includes('already registered')) {
        console.warn(`[claude-session-projector] ${name}: publish note for ${pubName}: ${err.message}`);
      }
    }
  }

  const sessionsName       = config.sessionsCollection       || 'Sessions';
  const subagentFlightsName = config.subagentFlightsCollection || 'SubagentFlights';
  const toolCallsName      = config.toolCallsCollection      || 'ToolCalls';

  const Sessions       = getOrCreateCollection(sessionsName);
  const SubagentFlights = getOrCreateCollection(subagentFlightsName);
  const ToolCalls      = getOrCreateCollection(toolCallsName);

  registerPublication(sessionsName,        Sessions);
  registerPublication(subagentFlightsName, SubagentFlights);
  registerPublication(toolCallsName,       ToolCalls);

  const collections = { Sessions, SubagentFlights, ToolCalls };

  // Ensure source dir exists
  try {
    if (!fs.existsSync(sourceDir)) {
      fs.mkdirSync(sourceDir, { recursive: true });
    }
  } catch (err) {
    console.warn(`[claude-session-projector] ${name}: sourceDir setup error: ${err.message}`);
  }

  // --- Initial full scan ---
  console.log(`[claude-session-projector] ${name}: initial scan of ${sourceDir} (entity: ${entity})`);
  fullScan(name, sourceDir, entity, collections);
  console.log(`[claude-session-projector] ${name}: startup complete — ${Sessions.find().count()} sessions, ${SubagentFlights.find().count()} subagents, ${ToolCalls.find().count()} tool calls`);

  // --- Watchers ---
  //
  // We watch three levels:
  //  1. sourceDir itself — new project-key directories appearing
  //  2. each project-key dir — new session JSONL files or session UUID subdirs appearing
  //  3. each subagents/ dir — new subagent JSONL files or appends
  //
  // For level 2 and 3 we install watchers on all directories found at startup,
  // and add new watchers when level-1 or level-2 events reveal new directories.

  const activeWatchers = []; // all fs.FSWatcher instances for cleanup on stop

  // Watch a project-key dir (level 2)
  function watchProjectKeyDir(projectKeyDir, projectKey) {
    const w = watchDir(name, projectKeyDir, `project-key:${projectKey}`, (eventType, filename, dir) => {
      const filePath = path.join(dir, filename);
      if (looksLikeSessionFile(filename)) {
        // New session JSONL or append to existing
        const sessionId = sessionIdFromFilename(filename);
        if (fs.existsSync(filePath)) {
          const { newLines, newOffset } = readNewLines(filePath, name);
          if (newLines.length > 0) {
            processSessionLines(name, filePath, newLines, sessionId, entity, projectKey, collections);
          }
          setOffset(name, filePath, newOffset);
        }
      } else if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
        // New session UUID directory appeared — watch its subagents/ dir
        const subagentsDir = path.join(filePath, 'subagents');
        watchSubagentsDir(subagentsDir, filename /* parentSessionId */);
      }
    });
    if (w) activeWatchers.push(w);

    // Also scan for any existing UUID subdirs and watch their subagents/ dirs
    try {
      const entries = fs.readdirSync(projectKeyDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(entry.name)) continue;
        const subagentsDir = path.join(projectKeyDir, entry.name, 'subagents');
        watchSubagentsDir(subagentsDir, entry.name);
      }
    } catch (_) {}
  }

  // Watch a subagents/ dir (level 3)
  function watchSubagentsDir(subagentsDir, parentSessionId) {
    const w = watchDir(name, subagentsDir, `subagents:${parentSessionId}`, (eventType, filename, dir) => {
      if (!looksLikeSubagentFile(filename)) return;
      const filePath = path.join(dir, filename);
      if (!fs.existsSync(filePath)) return;

      const agentId = agentIdFromFilename(filename);
      const { newLines, newOffset } = readNewLines(filePath, name);
      if (newLines.length > 0) {
        processSubagentLines(name, filePath, newLines, agentId, parentSessionId, entity, collections);
        setOffset(name, filePath, newOffset);

        // Update parent session subagentCount
        let count = 0;
        try {
          count = fs.readdirSync(dir).filter(f => looksLikeSubagentFile(f)).length;
        } catch (_) {}
        const sessionDoc = Sessions.findOne(parentSessionId);
        if (sessionDoc) {
          Sessions.update(parentSessionId, { $set: { subagentCount: count } });
        }
      }
    });
    if (w) activeWatchers.push(w);
  }

  // Watch sourceDir (level 1) for new project-key directories
  const sourceDirWatcher = watchDir(name, sourceDir, 'source', (eventType, filename, dir) => {
    const fullPath = path.join(dir, filename);
    try {
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
        // New project-key dir appeared — scan it immediately and set up watchers
        scanProjectKeyDir(name, fullPath, filename, entity, collections);
        watchProjectKeyDir(fullPath, filename);
      }
    } catch (_) {}
  });
  if (sourceDirWatcher) activeWatchers.push(sourceDirWatcher);

  // Install per-project-key watchers for all existing project-key dirs
  try {
    const pkEntries = fs.readdirSync(sourceDir, { withFileTypes: true });
    for (const entry of pkEntries) {
      if (!entry.isDirectory()) continue;
      const projectKeyDir = path.join(sourceDir, entry.name);
      watchProjectKeyDir(projectKeyDir, entry.name);
    }
  } catch (_) {}

  _running[name] = { config, activeWatchers, collections };
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

  // Remove docs belonging to this entity only (Sessions/SubagentFlights/ToolCalls)
  const entity = entry.config.entity || null;
  if (entry.collections && entity) {
    try { entry.collections.Sessions.remove({ entity });       } catch (_) {}
    try { entry.collections.SubagentFlights.remove({ entity }); } catch (_) {}
    try { entry.collections.ToolCalls.remove({ entity });      } catch (_) {}
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
      console.log(`[claude-session-projector] reload: ${cfg.name} already running — unchanged`);
    }
  }
}

// Export
globalThis.ClaudeSessionProjector = { start, stop, reload };
