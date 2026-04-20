// Memory signal parser — VESTA-SPEC-134 §3 — Phase 3
//
// Extracts <<REMEMBER>>, <<REMEMBER_LOCAL>>, <<CONSOLIDATE>>, <<FORGET>> markers
// from entity response text. Strips all markers before client delivery.
// Fires registered callback for each valid, well-formed signal.
//
// Harness-type awareness:
//   harnessType: "pwa" | "local-claude" | "local-opencode" | "other"
//   Web harness (pwa) silently rewrites <<REMEMBER_LOCAL>> → <<REMEMBER>> (SPEC-134 §3.2).
//   Local harnesses write <<REMEMBER_LOCAL>> to ~/.<entity>/memories/users/<user_id>/ on disk.
//
// Malformed handling (SPEC-134 §3.1):
//   <<REMEMBER without closing >>, empty content, nested markers, mid-sentence placement
//   → silent discard; log at debug level with session ID.
//   The rest of the response is delivered clean regardless.
//
// API:
//   KoadHarnessMemoryParser.register(callback)
//   KoadHarnessMemoryParser.parse(responseText, context) → cleanedText
//
// context shape:
//   { entity, sessionId, userId, harnessType, entityName }
//
// callback shape (called per parsed signal, fire-and-forget):
//   callback({ entity, sessionId, userId, harnessType, signal })
//   signal = {
//     type: 'remember' | 'remember_local' | 'consolidate' | 'forget',
//     content: String,         // text of the signal
//     supersedes: String[],    // for 'consolidate' only — list of memory IDs (may be empty)
//     target: String,          // for 'forget' only — memory_id or topic keyword
//   }

'use strict';

// ── Regex patterns ─────────────────────────────────────────────────────────────
// Each marker must start at the beginning of a line or after a blank line
// (i.e. not embedded mid-sentence). We enforce this by checking the extraction
// result against a placement rule after matching.
//
// Non-greedy on content to avoid cross-marker merging.
// The patterns allow for optional whitespace after the colon.

// Matches <<REMEMBER: content>> (and <<REMEMBER_LOCAL: content>>)
// We match all <<...: ...>> forms then dispatch by type.
const MARKER_RE = /<<(REMEMBER_LOCAL|REMEMBER|CONSOLIDATE|FORGET):\s*([\s\S]*?)>>/g;

// For CONSOLIDATE: extract optional [supersedes: id1, id2, ...]
// The supersedes list may be absent entirely.
const SUPERSEDES_RE = /\[supersedes:\s*([^\]]+)\]/i;

// For FORGET: the full content is the target (memory_id or topic keyword)
// Trimmed of whitespace.

// Memory ID pattern: looks like a generated _id (alphanum + underscore, 8+ chars)
// Topic keyword: anything else (treated as full-text topic search)
// We don't need to distinguish at parse time — the caller handles resolution.

// ── Debug logger ───────────────────────────────────────────────────────────────
// Uses console.debug when available; falls back to console.log
function debugLog(sessionId, msg) {
  (console.debug || console.log)(`[harness:memory-parser] session=${sessionId} ${msg}`);
}

function infoLog(msg) {
  console.info(`[harness:memory-parser] ${msg}`);
}

// ── Local filesystem write helper ─────────────────────────────────────────────
// Only called for <<REMEMBER_LOCAL>> on local harnesses.
// entityName: e.g. "alice" → writes to ~/.alice/memories/users/<user_id>/<memory_id>.md
// Uses Random or Date for ID generation (no Meteor dependency required here — we use
// a simple timestamp+random slug since this runs server-side).
//
// Returns the written file path (for debug logging).

let _fsModule = null;
let _pathModule = null;
let _osModule = null;

function getFs() {
  if (!_fsModule) {
    try { _fsModule = require('fs'); } catch (e) { _fsModule = null; }
  }
  return _fsModule;
}

function getPath() {
  if (!_pathModule) {
    try { _pathModule = require('path'); } catch (e) { _pathModule = null; }
  }
  return _pathModule;
}

function getOs() {
  if (!_osModule) {
    try { _osModule = require('os'); } catch (e) { _osModule = null; }
  }
  return _osModule;
}

function generateMemoryId() {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `mem_${ts}_${rand}`;
}

function writeLocalMemory(entityName, userId, content, sessionId) {
  const fs   = getFs();
  const path = getPath();
  const os   = getOs();
  if (!fs || !path || !os) {
    debugLog(sessionId, 'writeLocalMemory: fs/path/os unavailable — skipping local write');
    return null;
  }

  try {
    const homeDir  = os.homedir();
    const memDir   = path.join(homeDir, `.${entityName}`, 'memories', 'users', String(userId));
    fs.mkdirSync(memDir, { recursive: true });

    const memId    = generateMemoryId();
    const filename = `${memId}.md`;
    const filePath = path.join(memDir, filename);
    const ts       = new Date().toISOString();
    const body     = `---\nmemory_id: ${memId}\ncaptured_at: ${ts}\nsession: ${sessionId}\n---\n\n${content}\n`;

    fs.writeFileSync(filePath, body, 'utf8');
    return filePath;
  } catch (err) {
    debugLog(sessionId, `writeLocalMemory: write failed — ${err.message}`);
    return null;
  }
}

// ── Placement validator ───────────────────────────────────────────────────────
// Spec: marker must be on its own line or at the end of a paragraph — not mid-sentence.
// We check the character immediately before the <<MARKER in the full text.
// Allowed: start of string, newline, or end of a previous word (end of paragraph = blank line before).
// Disallowed: alphabetic/punctuation character without a preceding newline.
//
// Implementation: after extracting the match index, look back in the text.
// If the preceding non-whitespace context is inline prose (no newline between it and the marker)
// AND the character immediately before << is not a newline or start-of-string, it's mid-sentence.

function isMidSentence(fullText, matchIndex) {
  if (matchIndex === 0) return false;
  // Look at what's immediately before the <<
  const before = fullText.slice(0, matchIndex);
  // If there's a newline anywhere in the trailing content, it's on its own line
  if (before.length === 0) return false;
  const lastChar = before[before.length - 1];
  // Newline immediately before: OK
  if (lastChar === '\n' || lastChar === '\r') return false;
  // Space before: possibly inline — check if there's content on the same line
  const lastNewline = before.lastIndexOf('\n');
  const lineContent = before.slice(lastNewline + 1).trim();
  // Empty line content (only whitespace before on this line): OK
  if (lineContent.length === 0) return false;
  // Non-empty line content before marker: mid-sentence
  return true;
}

// ── Parser ────────────────────────────────────────────────────────────────────

let _callback = null;

KoadHarnessMemoryParser = {

  // Register the hosting app's memory signal sink.
  // callback(payload) where payload = { entity, sessionId, userId, harnessType, signal }
  // Fire-and-forget; callback may be async.
  register(callback) {
    _callback = callback;
  },

  // parse(responseText, context) → cleanedText
  //
  // Extracts all memory markers, validates each, fires callback for valid ones.
  // Returns cleaned text with ALL markers removed (valid and invalid alike).
  //
  // context = { entity, sessionId, userId, harnessType, entityName }
  //   entity:      entity handle, e.g. "alice"
  //   sessionId:   harness session ID (for debug logging)
  //   userId:      Meteor users._id (null if unauthenticated — discard all signals)
  //   harnessType: "pwa" | "local-claude" | "local-opencode" | "other"
  //   entityName:  same as entity, used for local filesystem path (e.g. "alice")
  parse(responseText, { entity, sessionId, userId, harnessType, entityName } = {}) {
    if (!responseText || typeof responseText !== 'string') return responseText;

    const sid        = sessionId || 'unknown';
    const validType  = (harnessType === 'pwa') ? 'web' : 'local';
    const signals    = [];
    const matchInfos = [];

    // Collect all matches with their positions (for placement check)
    MARKER_RE.lastIndex = 0;
    let match;
    while ((match = MARKER_RE.exec(responseText)) !== null) {
      matchInfos.push({
        fullMatch:  match[0],
        type:       match[1],   // REMEMBER | REMEMBER_LOCAL | CONSOLIDATE | FORGET
        rawContent: match[2],
        index:      match.index,
      });
    }

    for (const { fullMatch, type, rawContent, index } of matchInfos) {
      const typeLower = type.toLowerCase(); // 'remember' | 'remember_local' | 'consolidate' | 'forget'

      // Check for nested markers inside the raw content
      if (rawContent.includes('<<') || rawContent.includes('>>')) {
        debugLog(sid, `discarded ${type} — nested markers in content`);
        continue;
      }

      const content = rawContent.trim();

      // Empty content check
      if (!content) {
        debugLog(sid, `discarded ${type} — empty content`);
        continue;
      }

      // Placement check — mid-sentence markers are discarded
      if (isMidSentence(responseText, index)) {
        debugLog(sid, `discarded ${type} — mid-sentence placement`);
        continue;
      }

      // Build the signal object
      let signal = null;

      if (typeLower === 'remember') {
        signal = { type: 'remember', content };

      } else if (typeLower === 'remember_local') {
        // Web harness: silently rewrite to 'remember' (SPEC-134 §3.2 hard constraint)
        if (validType === 'web') {
          debugLog(sid, `rewrote REMEMBER_LOCAL → REMEMBER (web harness)`);
          signal = { type: 'remember', content };
        } else {
          // Local harness: write to filesystem directly; also fire callback for index tracking
          signal = { type: 'remember_local', content };
          if (userId && entityName) {
            // Filesystem write is synchronous here (server-side Node)
            const filePath = writeLocalMemory(entityName || entity, userId, content, sid);
            if (filePath) {
              debugLog(sid, `REMEMBER_LOCAL written to: ${filePath}`);
            }
          } else {
            debugLog(sid, `REMEMBER_LOCAL skipped — no userId or entityName`);
          }
        }

      } else if (typeLower === 'consolidate') {
        // Extract optional [supersedes: id1, id2, ...]
        const supersedMatch = SUPERSEDES_RE.exec(content);
        let supersedes = [];
        let consolidateContent = content;

        if (supersedMatch) {
          // Parse the supersedes list
          supersedes = supersedMatch[1]
            .split(',')
            .map(s => s.trim())
            .filter(Boolean);
          // Remove the [supersedes: ...] portion from the content
          consolidateContent = content.replace(SUPERSEDES_RE, '').trim();
        }

        if (!consolidateContent) {
          debugLog(sid, `discarded CONSOLIDATE — empty content after supersedes extraction`);
          continue;
        }

        signal = { type: 'consolidate', content: consolidateContent, supersedes };

      } else if (typeLower === 'forget') {
        // The entire content is the target (memory_id or topic keyword)
        signal = { type: 'forget', target: content };
      }

      if (signal) {
        signals.push({ signal, fullMatch });
      }
    }

    // Strip ALL markers from text (valid and invalid alike)
    // Reset regex and replace globally
    MARKER_RE.lastIndex = 0;
    let cleanedText = responseText.replace(MARKER_RE, '');

    // Second-pass: strip partial/malformed markers that the main regex didn't consume:
    //   <<REMEMBER: unclosed (no closing >>)
    //   <<REMEMBER without colon>> (no colon — won't match our main regex)
    // These are discarded per SPEC-134 §3.1; the output must not contain <<.
    // Strip any <<REMEMBER|REMEMBER_LOCAL|CONSOLIDATE|FORGET ... remnants.
    cleanedText = cleanedText
      // Partial marker without >> on same line: strip from << to end of line
      .replace(/<<(?:REMEMBER_LOCAL|REMEMBER|CONSOLIDATE|FORGET)[^>]*$/gm, '')
      // Marker-like <<WORD ...>> that wasn't caught by main regex (e.g. no colon)
      .replace(/<<(?:REMEMBER_LOCAL|REMEMBER|CONSOLIDATE|FORGET)[^>]*>>/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trimEnd();

    // Fire callback for each valid signal
    if (signals.length > 0) {
      if (!userId) {
        // Unauthenticated session — discard all signals (SPEC-134 §3: memories require auth)
        debugLog(sid, `${signals.length} signal(s) discarded — unauthenticated session`);
      } else if (!_callback) {
        debugLog(sid, `${signals.length} signal(s) captured but no callback registered — skipping`);
      } else {
        for (const { signal } of signals) {
          // Fire-and-forget — must not block response delivery
          if (typeof Meteor !== 'undefined' && Meteor.defer) {
            Meteor.defer(() => {
              try {
                const result = _callback({ entity, sessionId: sid, userId, harnessType, signal });
                if (result && typeof result.catch === 'function') {
                  result.catch(err => console.error('[harness:memory-parser] callback error:', err.message));
                }
              } catch (err) {
                console.error('[harness:memory-parser] callback threw:', err.message);
              }
            });
          } else {
            // Outside Meteor context (e.g. tests) — call directly
            try {
              const result = _callback({ entity, sessionId: sid, userId, harnessType, signal });
              if (result && typeof result.catch === 'function') {
                result.catch(err => console.error('[harness:memory-parser] callback error:', err.message));
              }
            } catch (err) {
              console.error('[harness:memory-parser] callback threw:', err.message);
            }
          }
        }
      }
    }

    return cleanedText;
  },
};
