// Tinytest wrapper for message-tool tests (server-side Meteor context)
// Delegates to the same inline parser logic validated in message-tool-node-test.js.
// Tinytest runs these inside Meteor so globals (KoadHarnessMessageTool) are live.

// ── Shared test payloads ──────────────────────────────────────────────────────

function runParse(text, context, callback) {
  // In Tinytest context, KoadHarnessMessageTool is live.
  // We register the callback, run parse, then deregister.
  const prevCallback = KoadHarnessMessageTool._testGetCallback
    ? KoadHarnessMessageTool._testGetCallback()
    : null;

  const captured = [];
  KoadHarnessMessageTool.register((p) => {
    captured.push(p);
    if (callback) callback(p);
  });

  const cleaned = KoadHarnessMessageTool.parse(text, context);

  // Restore previous callback (or null)
  KoadHarnessMessageTool.register(prevCallback);

  return { cleaned, captured };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

Tinytest.add('message-tool - happy path fires callback', function (test) {
  const text = `Before.
<<LEAVE_MESSAGE: {"target":"juno","action":"note","subject":"user observation","body":"The user seems engaged"}>>
After.`;

  const { cleaned, captured } = runParse(text, { entity: 'alice', sessionId: 's1', userId: 'u1' });

  test.equal(captured.length, 1, 'one callback fired');
  test.equal(captured[0].target, 'juno', 'target');
  test.equal(captured[0].action, 'note', 'action');
  test.equal(captured[0].entity, 'alice', 'sender entity');
  test.isTrue(!cleaned.includes('<<LEAVE_MESSAGE'), 'marker stripped');
  test.isTrue(cleaned.includes('Before.'), 'before text preserved');
  test.isTrue(cleaned.includes('After.'), 'after text preserved');
});

Tinytest.add('message-tool - multiple markers', function (test) {
  const text = `
<<LEAVE_MESSAGE: {"target":"juno","action":"note","subject":"first note","body":"First body"}>>
Middle.
<<LEAVE_MESSAGE: {"target":"muse","action":"feedback","subject":"design note","body":"More whitespace please"}>>`;

  const { captured } = runParse(text, { entity: 'alice', sessionId: 's2', userId: 'u2' });

  test.equal(captured.length, 2, 'two callbacks fired');
  test.equal(captured[0].target, 'juno', 'first target');
  test.equal(captured[1].target, 'muse', 'second target');
});

Tinytest.add('message-tool - missing target discarded', function (test) {
  const text = `<<LEAVE_MESSAGE: {"action":"note","subject":"sub","body":"body"}>>`;
  const { captured } = runParse(text, {});
  test.equal(captured.length, 0, 'discarded without target');
});

Tinytest.add('message-tool - invalid target discarded', function (test) {
  const text = `<<LEAVE_MESSAGE: {"target":"Juno","action":"note","subject":"sub","body":"body"}>>`;
  const { captured } = runParse(text, {});
  test.equal(captured.length, 0, 'uppercase target discarded');
});

Tinytest.add('message-tool - invalid JSON discarded and stripped', function (test) {
  const text = `Before <<LEAVE_MESSAGE: not valid json>> after.`;
  const { cleaned, captured } = runParse(text, {});
  test.equal(captured.length, 0, 'invalid JSON: no callback');
  test.isTrue(!cleaned.includes('<<LEAVE_MESSAGE'), 'invalid marker still stripped');
  test.isTrue(cleaned.includes('Before'), 'text preserved');
});

Tinytest.add('message-tool - no markers: text unchanged', function (test) {
  const text = `Just a normal response.`;
  const { cleaned, captured } = runParse(text, {});
  test.equal(captured.length, 0, 'no callbacks');
  test.equal(cleaned, text, 'text identical');
});

Tinytest.add('message-tool - with meta object', function (test) {
  const text = `<<LEAVE_MESSAGE: {"target":"vulcan","action":"brief","subject":"task note","body":"Ship it","meta":{"priority":"high"}}>>`;
  const { captured } = runParse(text, { entity: 'juno', sessionId: 's3', userId: 'u3' });
  test.equal(captured.length, 1, 'fires');
  test.equal(captured[0].meta.priority, 'high', 'meta preserved');
});
