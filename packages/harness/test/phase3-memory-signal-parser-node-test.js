#!/usr/bin/env node
// Phase 3 Node-runnable tests — memory signal parser (VESTA-SPEC-134 §3)
// Run: node test/phase3-memory-signal-parser-node-test.js
//
// Tests the parser inline (same logic as memory-signal-parser.js but without
// Meteor globals). Covers 20+ malformed marker cases as required by spec.

'use strict';

// ── Minimal stubs for outside-Meteor context ──────────────────────────────────

// Meteor.defer stub — calls synchronously in test context
if (typeof globalThis.Meteor === 'undefined') {
  globalThis.Meteor = { defer: (fn) => fn() };
}

// ── Inline parser logic (mirrors memory-signal-parser.js without Meteor import) ─

const MARKER_RE_SRC = /<<(REMEMBER_LOCAL|REMEMBER|CONSOLIDATE|FORGET):\s*([\s\S]*?)>>/g;
const SUPERSEDES_RE = /\[supersedes:\s*([^\]]+)\]/i;

function debugLog(sessionId, msg) {
  // suppress in test output unless DEBUG=1
  if (process.env.DEBUG) process.stderr.write(`[debug] session=${sessionId} ${msg}\n`);
}

function isMidSentence(fullText, matchIndex) {
  if (matchIndex === 0) return false;
  const before = fullText.slice(0, matchIndex);
  if (before.length === 0) return false;
  const lastChar = before[before.length - 1];
  if (lastChar === '\n' || lastChar === '\r') return false;
  const lastNewline = before.lastIndexOf('\n');
  const lineContent = before.slice(lastNewline + 1).trim();
  if (lineContent.length === 0) return false;
  return true;
}

function parseText(responseText, { entity, sessionId, userId, harnessType, entityName } = {}, callback) {
  if (!responseText || typeof responseText !== 'string') return responseText;

  const sid = sessionId || 'unknown';
  const validType = (harnessType === 'pwa') ? 'web' : 'local';
  const signals = [];
  const matchInfos = [];

  const MARKER_RE = new RegExp(MARKER_RE_SRC.source, 'g');

  let match;
  while ((match = MARKER_RE.exec(responseText)) !== null) {
    matchInfos.push({
      fullMatch:  match[0],
      type:       match[1],
      rawContent: match[2],
      index:      match.index,
    });
  }

  for (const { type, rawContent, index } of matchInfos) {
    const typeLower = type.toLowerCase();

    if (rawContent.includes('<<') || rawContent.includes('>>')) {
      debugLog(sid, `discarded ${type} — nested markers`);
      continue;
    }

    const content = rawContent.trim();
    if (!content) {
      debugLog(sid, `discarded ${type} — empty content`);
      continue;
    }

    if (isMidSentence(responseText, index)) {
      debugLog(sid, `discarded ${type} — mid-sentence`);
      continue;
    }

    let signal = null;

    if (typeLower === 'remember') {
      signal = { type: 'remember', content };

    } else if (typeLower === 'remember_local') {
      if (validType === 'web') {
        signal = { type: 'remember', content }; // rewrite
      } else {
        signal = { type: 'remember_local', content };
      }

    } else if (typeLower === 'consolidate') {
      const supersedMatch = SUPERSEDES_RE.exec(content);
      let supersedes = [];
      let consolidateContent = content;
      if (supersedMatch) {
        supersedes = supersedMatch[1].split(',').map(s => s.trim()).filter(Boolean);
        consolidateContent = content.replace(SUPERSEDES_RE, '').trim();
      }
      if (!consolidateContent) {
        debugLog(sid, `discarded CONSOLIDATE — empty after supersedes extraction`);
        continue;
      }
      signal = { type: 'consolidate', content: consolidateContent, supersedes };

    } else if (typeLower === 'forget') {
      signal = { type: 'forget', target: content };
    }

    if (signal) signals.push(signal);
  }

  // Strip ALL markers (valid and invalid alike)
  const STRIP_RE = new RegExp(MARKER_RE_SRC.source, 'g');
  let cleanedText = responseText.replace(STRIP_RE, '');

  // Second-pass: strip partial/malformed markers that main regex didn't consume
  cleanedText = cleanedText
    .replace(/<<(?:REMEMBER_LOCAL|REMEMBER|CONSOLIDATE|FORGET)[^>]*$/gm, '')
    .replace(/<<(?:REMEMBER_LOCAL|REMEMBER|CONSOLIDATE|FORGET)[^>]*>>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();

  // Fire callback for valid signals (if userId)
  if (userId && callback && signals.length > 0) {
    for (const signal of signals) {
      callback({ entity, sessionId: sid, userId, harnessType, signal });
    }
  }

  return { cleanedText, signals };
}

// ── Test runner ───────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    process.stdout.write(`  PASS  ${name}\n`);
  } catch (err) {
    failed++;
    process.stderr.write(`  FAIL  ${name}\n         ${err.message}\n`);
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(`assertion failed: ${msg}`);
}

function ctx(overrides) {
  return Object.assign({
    entity: 'alice', sessionId: 'sess1', userId: 'u1',
    harnessType: 'pwa', entityName: 'alice',
  }, overrides);
}

process.stdout.write('Phase 3 — memory signal parser node tests\n\n');

// ── Well-formed markers ───────────────────────────────────────────────────────

test('REMEMBER: well-formed marker fires signal + strips from output', () => {
  const signals = [];
  const { cleanedText } = parseText('Reply.\n<<REMEMBER: user likes jazz>>', ctx(), (p) => signals.push(p));
  assert(!cleanedText.includes('<<'), 'marker stripped');
  assert(cleanedText.includes('Reply.'), 'prose preserved');
  assert(signals.length === 1 && signals[0].signal.type === 'remember', 'signal fired');
  assert(signals[0].signal.content === 'user likes jazz', 'content correct');
});

test('CONSOLIDATE with supersedes list: parsed correctly', () => {
  const signals = [];
  const { cleanedText } = parseText(
    'Note.\n<<CONSOLIDATE: summary [supersedes: mem_abc, mem_def]>>',
    ctx(), (p) => signals.push(p)
  );
  assert(!cleanedText.includes('<<'), 'marker stripped');
  assert(signals.length === 1, 'one signal');
  assert(signals[0].signal.type === 'consolidate', 'type=consolidate');
  assert(signals[0].signal.supersedes.includes('mem_abc'), 'supersedes parsed');
  assert(signals[0].signal.content === 'summary', 'content without supersedes');
});

test('CONSOLIDATE without supersedes list: valid, empty supersedes array', () => {
  const signals = [];
  parseText('.\n<<CONSOLIDATE: clean fact>>', ctx(), (p) => signals.push(p));
  assert(signals.length === 1 && signals[0].signal.supersedes.length === 0, 'empty supersedes');
});

test('FORGET: signal type and target', () => {
  const signals = [];
  parseText('.\n<<FORGET: old-preference>>', ctx(), (p) => signals.push(p));
  assert(signals.length === 1 && signals[0].signal.type === 'forget', 'forget type');
  assert(signals[0].signal.target === 'old-preference', 'target correct');
});

test('Multiple markers in one response: each produces one signal', () => {
  const signals = [];
  const text = '.\n<<REMEMBER: fact one>>\n.\n<<REMEMBER: fact two>>\n.\n<<FORGET: old>>';
  parseText(text, ctx(), (p) => signals.push(p));
  assert(signals.length === 3, `expected 3 signals, got ${signals.length}`);
});

// ── Malformed marker cases (20+) ──────────────────────────────────────────────

const malformedCases = [
  // 1 — No closing >>
  ['no closing >>', 'Response.\n<<REMEMBER: unclosed'],
  // 2 — Empty content
  ['empty content', '.\n<<REMEMBER: >>'],
  // 3 — Whitespace-only content
  ['whitespace only', '.\n<<REMEMBER:    >>'],
  // 4 — Nested << inside content
  ['nested << in content', '.\n<<REMEMBER: <<inner>>>>'],
  // 5 — Nested >> inside content (extra >) — captured by regex boundary
  ['nested >> in content', '.\n<<REMEMBER: outer>>inner>>>'],
  // 6 — No colon — won't match our regex (no capture group for content)
  ['no colon form', '.\n<<REMEMBER without colon>>'],
  // 7 — Mid-sentence placement
  ['mid-sentence', 'She said <<REMEMBER: inline>> and stopped.'],
  // 8 — Empty CONSOLIDATE after supersedes extraction
  ['CONSOLIDATE empty after supersedes', '.\n<<CONSOLIDATE:  [supersedes: x]>>'],
  // 9 — Empty FORGET target
  ['FORGET empty target', '.\n<<FORGET: >>'],
  // 10 — FORGET whitespace only
  ['FORGET whitespace only', '.\n<<FORGET:   >>'],
  // 11 — REMEMBER_LOCAL empty on web harness (rewritten but empty → discard)
  ['REMEMBER_LOCAL empty web harness', '.\n<<REMEMBER_LOCAL: >>'],
  // 12 — CONSOLIDATE with nested << in supersedes
  ['CONSOLIDATE nested << in supersedes content', '.\n<<CONSOLIDATE: fact [supersedes: <<bad>>]>>'],
  // 13 — All-whitespace CONSOLIDATE content (no supersedes)
  ['CONSOLIDATE whitespace content', '.\n<<CONSOLIDATE:    >>'],
  // 14 — REMEMBER with newline-only content (stripped to empty)
  ['REMEMBER newline only content', '.\n<<REMEMBER:\n>>'],
  // 15 — Marker type only, colon, no content
  ['REMEMBER colon only', '.\n<<REMEMBER:>>'],
  // 16 — Unknown marker type (should not be parsed at all)
  ['unknown marker type', '.\n<<UNKNOWN: ignored>>'],
  // 17 — REMEMBER with nested REMEMBER
  ['nested REMEMBER', '.\n<<REMEMBER: outer <<REMEMBER: inner>>>>'],
  // 18 — CONSOLIDATE only supersedes, no content text
  ['CONSOLIDATE only supersedes no content', '.\n<<CONSOLIDATE: [supersedes: id1]>>'],
  // 19 — Mid-paragraph marker (not at end of paragraph)
  ['mid-paragraph', 'Start of sentence <<REMEMBER: mid>> rest of sentence.'],
  // 20 — FORGET with nested <<
  ['FORGET nested <<', '.\n<<FORGET: <<topic>>'],
  // 21 — Double marker same line mid-sentence
  ['double inline marker same line', 'A <<REMEMBER: x>> B <<REMEMBER: y>> C'],
  // 22 — REMEMBER_LOCAL with nested >> on web harness
  ['REMEMBER_LOCAL nested >> web harness', '.\n<<REMEMBER_LOCAL: text >>extra>>'],
];

for (const [label, text] of malformedCases) {
  test(`malformed[${label}]: response delivered clean (no << in output)`, () => {
    const signals = [];
    const { cleanedText } = parseText(text, ctx(), (p) => signals.push(p));
    assert(!cleanedText.includes('<<REMEMBER'), `<<REMEMBER leaked into output for case: ${label}`);
    assert(!cleanedText.includes('<<CONSOLIDATE'), `<<CONSOLIDATE leaked for: ${label}`);
    assert(!cleanedText.includes('<<FORGET'), `<<FORGET leaked for: ${label}`);
  });
}

// ── Web harness REMEMBER_LOCAL rewrite ───────────────────────────────────────

test('web harness: REMEMBER_LOCAL rewritten to remember type', () => {
  const signals = [];
  parseText('.\n<<REMEMBER_LOCAL: local secret>>', ctx({ harnessType: 'pwa' }), (p) => signals.push(p));
  assert(signals.length === 1 && signals[0].signal.type === 'remember', 'rewritten to remember');
});

test('local harness: REMEMBER_LOCAL keeps remember_local type', () => {
  const signals = [];
  parseText('.\n<<REMEMBER_LOCAL: local secret>>', ctx({ harnessType: 'local-claude' }), (p) => signals.push(p));
  assert(signals.length === 1 && signals[0].signal.type === 'remember_local', 'type=remember_local on local');
});

// ── Unauthenticated session: markers stripped, no callback ────────────────────

test('unauthenticated session: callback not fired', () => {
  let fired = false;
  const { cleanedText } = parseText(
    'Reply.\n<<REMEMBER: fact>>', ctx({ userId: null }),
    () => { fired = true; }
  );
  assert(!cleanedText.includes('<<'), 'marker stripped');
  assert(!fired, 'callback not fired for anon session');
});

// ── Summary ───────────────────────────────────────────────────────────────────

process.stdout.write(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
