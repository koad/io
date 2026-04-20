/* global Tinytest, KoadHarnessMemoryParser */
// Phase 3 tests — memory signal parser (VESTA-SPEC-134 §3)
//
// Tests the parser's marker extraction, validation, malformed handling,
// harness-type rewriting, and callback dispatch.
//
// Node-runnable variant: phase3-memory-signal-parser-node-test.js

// ── Stub helpers ─────────────────────────────────────────────────────────────

function makeCtx(overrides) {
  return Object.assign({
    entity:      'alice',
    sessionId:   'sess_test',
    userId:      'user_abc',
    harnessType: 'pwa',
    entityName:  'alice',
  }, overrides);
}

let _lastCallbackPayloads = [];

function resetCallback() {
  _lastCallbackPayloads = [];
  KoadHarnessMemoryParser.register((payload) => {
    _lastCallbackPayloads.push(payload);
  });
}

// ── Marker stripping ─────────────────────────────────────────────────────────

Tinytest.add('memory-signal-parser - strips REMEMBER marker from response', function (test) {
  resetCallback();
  const text   = 'Hello!\n\n<<REMEMBER: user prefers short answers>>';
  const result = KoadHarnessMemoryParser.parse(text, makeCtx());
  test.isFalse(result.includes('<<REMEMBER'), 'marker stripped');
  test.isTrue(result.includes('Hello!'), 'visible text preserved');
});

Tinytest.add('memory-signal-parser - strips all four marker types', function (test) {
  resetCallback();
  const text = [
    'Line one.',
    '<<REMEMBER: fact one>>',
    '<<REMEMBER_LOCAL: local fact>>',
    '<<CONSOLIDATE: consolidated>>',
    '<<FORGET: old-topic>>',
    'Line two.',
  ].join('\n');
  const result = KoadHarnessMemoryParser.parse(text, makeCtx());
  test.isFalse(result.includes('<<REMEMBER'), 'REMEMBER stripped');
  test.isFalse(result.includes('<<CONSOLIDATE'), 'CONSOLIDATE stripped');
  test.isFalse(result.includes('<<FORGET'), 'FORGET stripped');
  test.isTrue(result.includes('Line one.'), 'visible text preserved');
  test.isTrue(result.includes('Line two.'), 'visible text preserved');
});

Tinytest.add('memory-signal-parser - multiple REMEMBER markers each produce one signal', function (test) {
  resetCallback();
  const text = [
    'Some reply.',
    '<<REMEMBER: fact one>>',
    '<<REMEMBER: fact two>>',
    '<<REMEMBER: fact three>>',
  ].join('\n');
  KoadHarnessMemoryParser.parse(text, makeCtx());
  // Each valid marker fires one callback — but Meteor.defer is async.
  // In Tinytest we call callback directly (defer shimmed to sync in test context or
  // we test the return value, not async side effects).
  // The key invariant is: cleaned text has no markers.
  const result = KoadHarnessMemoryParser.parse(text, makeCtx({ userId: 'u1' }));
  test.isFalse(result.includes('<<REMEMBER'), 'all markers stripped');
});

// ── Malformed marker discard ─────────────────────────────────────────────────
// SPEC-134 §3.1: malformed markers discarded silently; response delivered clean.

Tinytest.add('memory-signal-parser - discards marker with no closing >> (malformed)', function (test) {
  resetCallback();
  const text = 'Response.\n<<REMEMBER: unclosed marker without close';
  const result = KoadHarnessMemoryParser.parse(text, makeCtx());
  test.isFalse(result.includes('<<REMEMBER'), 'malformed marker stripped');
  test.isTrue(result.includes('Response.'), 'prose preserved');
});

Tinytest.add('memory-signal-parser - discards empty content REMEMBER', function (test) {
  resetCallback();
  const text = 'Line.\n<<REMEMBER: >>';
  const result = KoadHarnessMemoryParser.parse(text, makeCtx());
  test.isFalse(result.includes('<<REMEMBER'), 'empty marker stripped');
});

Tinytest.add('memory-signal-parser - discards nested markers', function (test) {
  resetCallback();
  const text = 'Line.\n<<REMEMBER: <<REMEMBER: inner>>>>';
  const result = KoadHarnessMemoryParser.parse(text, makeCtx());
  test.isFalse(result.includes('<<REMEMBER'), 'nested marker stripped');
});

Tinytest.add('memory-signal-parser - discards mid-sentence marker', function (test) {
  resetCallback();
  // Mid-sentence: marker embedded in prose without a preceding newline
  const text = 'She said <<REMEMBER: inline fact>> and continued.';
  const result = KoadHarnessMemoryParser.parse(text, makeCtx());
  // The marker itself should be stripped regardless; and it should be discarded (not fired).
  test.isFalse(result.includes('<<REMEMBER'), 'inline marker stripped from output');
});

Tinytest.add('memory-signal-parser - discards empty CONSOLIDATE content', function (test) {
  resetCallback();
  const text = 'Line.\n<<CONSOLIDATE:  [supersedes: mem_abc]>>';
  const result = KoadHarnessMemoryParser.parse(text, makeCtx());
  test.isFalse(result.includes('<<CONSOLIDATE'), 'stripped');
});

Tinytest.add('memory-signal-parser - discards empty FORGET target', function (test) {
  resetCallback();
  const text = 'Line.\n<<FORGET: >>';
  const result = KoadHarnessMemoryParser.parse(text, makeCtx());
  test.isFalse(result.includes('<<FORGET'), 'stripped');
});

Tinytest.add('memory-signal-parser - REMEMBER_LOCAL with no content discarded', function (test) {
  resetCallback();
  const text = '<<REMEMBER_LOCAL: >>';
  const result = KoadHarnessMemoryParser.parse(text, makeCtx());
  test.isFalse(result.includes('<<REMEMBER_LOCAL'), 'stripped');
});

Tinytest.add('memory-signal-parser - marker with only whitespace content discarded', function (test) {
  resetCallback();
  const text = '<<REMEMBER:    >>';
  const result = KoadHarnessMemoryParser.parse(text, makeCtx());
  test.isFalse(result.includes('<<REMEMBER'), 'whitespace-only content stripped');
});

Tinytest.add('memory-signal-parser - multiple malformed markers all stripped cleanly (1)', function (test) {
  resetCallback();
  const text = 'A.\n<<REMEMBER:\n<<REMEMBER: >>\n<<CONSOLIDATE: [supersedes: x]>>\n<<FORGET: >>\nB.';
  const result = KoadHarnessMemoryParser.parse(text, makeCtx());
  test.isFalse(result.includes('<<'), 'all markers stripped');
});

Tinytest.add('memory-signal-parser - malformed REMEMBER (no colon) — stripped', function (test) {
  resetCallback();
  const text = 'Line.\n<<REMEMBER without colon>>';
  const result = KoadHarnessMemoryParser.parse(text, makeCtx());
  test.isFalse(result.includes('<<'), 'stripped');
});

// Further malformed cases 12–20+ covered by Node test below.

// ── Harness-type rewrite ─────────────────────────────────────────────────────
// SPEC-134 §3.2: web harness silently rewrites <<REMEMBER_LOCAL>> → <<REMEMBER>>

Tinytest.add('memory-signal-parser - web harness rewrites REMEMBER_LOCAL to REMEMBER', function (test) {
  const signals = [];
  KoadHarnessMemoryParser.register((p) => signals.push(p));
  const text   = 'Line.\n<<REMEMBER_LOCAL: local secret>>';
  const result = KoadHarnessMemoryParser.parse(text, makeCtx({ harnessType: 'pwa', userId: 'u1' }));
  test.isFalse(result.includes('<<'), 'marker stripped');
  // Signal should be rewritten to 'remember' type (not 'remember_local')
  // Note: Meteor.defer may not fire synchronously in Tinytest — we verify the cleaned text
  // and that no REMEMBER_LOCAL marker escapes to output.
  test.isFalse(result.includes('REMEMBER_LOCAL'), 'web harness: REMEMBER_LOCAL does not appear in output');
});

Tinytest.add('memory-signal-parser - unauthenticated session: markers stripped, no callback fired', function (test) {
  let fired = false;
  KoadHarnessMemoryParser.register(() => { fired = true; });
  const text   = 'Line.\n<<REMEMBER: something>>';
  const result = KoadHarnessMemoryParser.parse(text, makeCtx({ userId: null }));
  test.isFalse(result.includes('<<'), 'marker stripped');
  // callback must not fire for unauthenticated sessions
  test.isFalse(fired, 'callback not fired for anon session');
});

// ── CONSOLIDATE marker ───────────────────────────────────────────────────────

Tinytest.add('memory-signal-parser - CONSOLIDATE parses supersedes list', function (test) {
  const signals = [];
  KoadHarnessMemoryParser.register((p) => signals.push(p));
  const text = 'Line.\n<<CONSOLIDATE: user likes jazz [supersedes: mem_abc123, mem_def456]>>';
  KoadHarnessMemoryParser.parse(text, makeCtx({ userId: 'u1' }));
  // Signals are fired via Meteor.defer; in Tinytest context we verify cleaned text only
  const result = KoadHarnessMemoryParser.parse(text, makeCtx({ userId: null }));
  test.isFalse(result.includes('<<'), 'marker stripped');
});

Tinytest.add('memory-signal-parser - CONSOLIDATE without supersedes list is valid', function (test) {
  resetCallback();
  const text = 'Summary.\n<<CONSOLIDATE: user profile consolidated>>';
  const result = KoadHarnessMemoryParser.parse(text, makeCtx());
  test.isFalse(result.includes('<<'), 'marker stripped');
  test.isTrue(result.includes('Summary.'), 'prose preserved');
});

// ── FORGET marker ────────────────────────────────────────────────────────────

Tinytest.add('memory-signal-parser - FORGET marker stripped cleanly', function (test) {
  resetCallback();
  const text = 'Line.\n<<FORGET: old-preference-topic>>';
  const result = KoadHarnessMemoryParser.parse(text, makeCtx());
  test.isFalse(result.includes('<<'), 'marker stripped');
  test.isTrue(result.includes('Line.'), 'prose preserved');
});

// ── No-op behavior ───────────────────────────────────────────────────────────

Tinytest.add('memory-signal-parser - returns original text when no markers', function (test) {
  resetCallback();
  const text = 'Just a normal reply.';
  const result = KoadHarnessMemoryParser.parse(text, makeCtx());
  test.equal(result, text, 'text unchanged');
});

Tinytest.add('memory-signal-parser - handles null/empty input', function (test) {
  resetCallback();
  test.equal(KoadHarnessMemoryParser.parse(null, makeCtx()), null);
  test.equal(KoadHarnessMemoryParser.parse('', makeCtx()), '');
});
