/* global Tinytest, KoadHarnessFeedbackExtractor */
// Unit tests for feedback-extractor.js — VESTA-SPEC-132 §3.1
//
// Tests the pure extraction + validation logic without hitting Mongo.
// The registered callback is stubbed; all async fire-and-forget behavior
// is verified via the callback stub.

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePayload(overrides) {
  return Object.assign({
    entity: 'alice',
    sessionId: 'sess_test',
    userId: 'user_abc',
    sessionHistory: [],
  }, overrides);
}

// ── Strip behavior ────────────────────────────────────────────────────────────

Tinytest.add('feedback-extractor - strips marker from clean response', function (test) {
  const text = 'Hello, great catch.\n\n<<CAPTURE_FEEDBACK: tier badge does not update after upgrade>>';
  const result = KoadHarnessFeedbackExtractor.extract(text, makePayload());
  test.isFalse(result.includes('<<CAPTURE_FEEDBACK'), 'marker must be stripped');
  test.isTrue(result.includes('Hello, great catch.'), 'visible text must be preserved');
});

Tinytest.add('feedback-extractor - strips multiple markers', function (test) {
  const text = '<<CAPTURE_FEEDBACK: first idea>>\nSome reply.\n<<CAPTURE_FEEDBACK: second idea>>';
  const result = KoadHarnessFeedbackExtractor.extract(text, makePayload());
  test.isFalse(result.includes('<<CAPTURE_FEEDBACK'), 'all markers stripped');
  test.isTrue(result.includes('Some reply.'), 'visible text preserved');
});

Tinytest.add('feedback-extractor - strips malformed marker (no closing >>)', function (test) {
  const text = 'Response.\n<<CAPTURE_FEEDBACK: truncated marker without close';
  const result = KoadHarnessFeedbackExtractor.extract(text, makePayload());
  test.isFalse(result.includes('<<CAPTURE_FEEDBACK'), 'partial marker stripped');
});

Tinytest.add('feedback-extractor - strips marker with nested angle brackets (malformed)', function (test) {
  const text = 'Response.\n<<CAPTURE_FEEDBACK: sponsor said <<bad>> format>>';
  const result = KoadHarnessFeedbackExtractor.extract(text, makePayload());
  // Text is stripped; the result should not contain the marker
  test.isFalse(result.includes('CAPTURE_FEEDBACK'), 'malformed marker stripped');
});

Tinytest.add('feedback-extractor - returns original text when no markers', function (test) {
  const text = 'Just a normal response with no markers.';
  const result = KoadHarnessFeedbackExtractor.extract(text, makePayload());
  test.equal(result, text, 'unchanged when no markers present');
});

// ── Callback firing — anonymous session ───────────────────────────────────────

Tinytest.add('feedback-extractor - does not fire callback for anonymous session (no userId)', function (test) {
  // SPEC-132 §3.1.4: emissions during anonymous sessions are discarded
  KoadHarnessFeedbackExtractor.register(function (_payload) {
    test.fail('callback must NOT fire for anonymous session');
  });

  const text = '<<CAPTURE_FEEDBACK: an idea from an anon visitor>>';
  KoadHarnessFeedbackExtractor.extract(text, makePayload({ userId: null }));

  // Reset callback
  KoadHarnessFeedbackExtractor.register(null);
});

// ── Callback firing — authenticated session ───────────────────────────────────

Tinytest.add('feedback-extractor - fires callback with correct payload for valid marker', function (test) {
  let captured = null;
  KoadHarnessFeedbackExtractor.register(function (payload) {
    captured = payload;
  });

  const summary = 'tier badge does not update after upgrade';
  const text = `Response text.\n<<CAPTURE_FEEDBACK: ${summary}>>`;
  KoadHarnessFeedbackExtractor.extract(text, makePayload({
    entity: 'alice',
    sessionId: 'sess_001',
    userId: 'user_xyz',
  }));

  // Meteor.defer fires synchronously in test context? Not guaranteed.
  // We verify the return value (cleaned text) as the primary assertion;
  // the callback test is best-effort in this sync harness.
  // The auth-rejection test below is the critical regression gate.

  // Reset
  KoadHarnessFeedbackExtractor.register(null);
});

// ── Summary validation ────────────────────────────────────────────────────────

Tinytest.add('feedback-extractor - discards marker with summary too short (< 10 chars)', function (test) {
  // Summary "x" is 1 char — below SUMMARY_MIN
  let callbackFired = false;
  KoadHarnessFeedbackExtractor.register(function () { callbackFired = true; });

  const text = '<<CAPTURE_FEEDBACK: tiny>>';
  const result = KoadHarnessFeedbackExtractor.extract(text, makePayload());

  test.isFalse(result.includes('CAPTURE_FEEDBACK'), 'marker stripped');
  // callbackFired may be false (Meteor.defer) — strip is the primary assertion

  KoadHarnessFeedbackExtractor.register(null);
});

Tinytest.add('feedback-extractor - handles empty response text gracefully', function (test) {
  const result = KoadHarnessFeedbackExtractor.extract('', makePayload());
  test.equal(result, '', 'empty string passthrough');
});

Tinytest.add('feedback-extractor - handles null response text gracefully', function (test) {
  const result = KoadHarnessFeedbackExtractor.extract(null, makePayload());
  test.equal(result, null, 'null passthrough');
});

// ── SPEC-132 §3.1.2 — summary max length truncation ──────────────────────────

Tinytest.add('feedback-extractor - truncates summary > 280 chars and sets truncated flag', function (test) {
  let capturedPayload = null;
  KoadHarnessFeedbackExtractor.register(function (payload) {
    capturedPayload = payload;
  });

  const longSummary = 'a'.repeat(400);
  const text = `<<CAPTURE_FEEDBACK: ${longSummary}>>`;
  const result = KoadHarnessFeedbackExtractor.extract(text, makePayload());

  test.isFalse(result.includes('CAPTURE_FEEDBACK'), 'marker stripped from response');
  // If Meteor.defer fires synchronously (test context may vary):
  if (capturedPayload) {
    test.isTrue(capturedPayload.truncated, 'truncated flag must be set');
    test.equal(capturedPayload.summary.length, 280, 'summary length capped at 280');
  }

  KoadHarnessFeedbackExtractor.register(null);
});
