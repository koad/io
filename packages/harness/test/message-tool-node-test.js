#!/usr/bin/env node
// message-tool Node-runnable tests
// Run: node test/message-tool-node-test.js
//
// Tests the <<LEAVE_MESSAGE>> marker extraction logic inline
// (same logic as server/pipeline/message-tool.js without Meteor globals).

'use strict';

// ── Minimal stubs for outside-Meteor context ──────────────────────────────────

if (typeof globalThis.Meteor === 'undefined') {
  globalThis.Meteor = { defer: (fn) => fn() };
}

// ── Inline parser logic (mirrors message-tool.js without Meteor import) ──────

const LEAVE_MESSAGE_RE_SRC = /<<LEAVE_MESSAGE:\s*(\{[^>]*?\})>>/g;
const VALID_HANDLE_RE       = /^[a-z0-9-]+$/;
const SUBJECT_MIN = 3;
const SUBJECT_MAX = 200;
const BODY_MIN    = 1;
const BODY_MAX    = 4000;

function parseTool(responseText, { entity, sessionId, userId } = {}, callback) {
  if (!responseText || typeof responseText !== 'string') return responseText;

  const sid    = sessionId || 'unknown';
  const sender = entity   || 'unknown';
  const messages = [];

  const RE = new RegExp(LEAVE_MESSAGE_RE_SRC.source, 'g');
  let match;
  while ((match = RE.exec(responseText)) !== null) {
    const rawJson = match[1];

    if (rawJson.includes('<<') || rawJson.includes('>>')) continue;

    let data;
    try { data = JSON.parse(rawJson); } catch (e) { continue; }

    if (!data || typeof data !== 'object' || Array.isArray(data)) continue;

    const target = typeof data.target === 'string' ? data.target.trim() : '';
    if (!target || !VALID_HANDLE_RE.test(target)) continue;

    const action = typeof data.action === 'string' ? data.action.trim() : '';
    if (!action || action.length > 64 || !/^[a-zA-Z0-9_-]+$/.test(action)) continue;

    const subject = typeof data.subject === 'string' ? data.subject.trim() : '';
    if (subject.length < SUBJECT_MIN || subject.length > SUBJECT_MAX) continue;

    const body = typeof data.body === 'string' ? data.body.trim() : '';
    if (body.length < BODY_MIN || body.length > BODY_MAX) continue;

    let meta = {};
    if (data.meta !== undefined && data.meta !== null) {
      if (typeof data.meta === 'object' && !Array.isArray(data.meta)) meta = data.meta;
    }

    messages.push({ target, action, subject, body, meta });
  }

  const cleanRE = new RegExp(LEAVE_MESSAGE_RE_SRC.source, 'g');
  let cleanedText = responseText.replace(cleanRE, '');
  // Second pass: catch any <<LEAVE_MESSAGE: ...>> not caught by the main regex
  cleanedText = cleanedText
    .replace(/<<LEAVE_MESSAGE:[^>]*>>/g, '')
    .trimEnd();

  if (messages.length > 0 && callback) {
    for (const msg of messages) {
      try {
        callback({
          entity:    sender,
          sessionId: sid,
          userId,
          target:    msg.target,
          action:    msg.action,
          subject:   msg.subject,
          body:      msg.body,
          meta:      msg.meta,
        });
      } catch (err) {
        console.error('[test] callback threw:', err.message);
      }
    }
  }

  return cleanedText;
}

// ── Test harness ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    passed++;
    console.log(`  [PASS] ${label}`);
  } else {
    failed++;
    console.error(`  [FAIL] ${label}`);
  }
}

function assertEqual(a, b, label) {
  if (a === b) {
    passed++;
    console.log(`  [PASS] ${label}`);
  } else {
    failed++;
    console.error(`  [FAIL] ${label}`);
    console.error(`         expected: ${JSON.stringify(b)}`);
    console.error(`         got:      ${JSON.stringify(a)}`);
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

console.log('\n=== message-tool: happy path ===');
{
  const captured = [];
  const text = `Here is my response.
<<LEAVE_MESSAGE: {"target":"juno","action":"note","subject":"user feedback","body":"The user seems confused about onboarding"}>>
Let me know if you need anything else.`;

  const cleaned = parseTool(text, { entity: 'alice', sessionId: 'sess1', userId: 'user1' }, (p) => captured.push(p));

  assertEqual(captured.length, 1, 'fires callback once');
  assertEqual(captured[0].target, 'juno', 'target is juno');
  assertEqual(captured[0].action, 'note', 'action is note');
  assertEqual(captured[0].subject, 'user feedback', 'subject correct');
  assertEqual(captured[0].body, 'The user seems confused about onboarding', 'body correct');
  assert(!cleaned.includes('<<LEAVE_MESSAGE'), 'marker stripped from text');
  assert(cleaned.includes('Here is my response.'), 'surrounding text preserved');
  assertEqual(captured[0].entity, 'alice', 'sender entity is alice');
  assertEqual(captured[0].userId, 'user1', 'userId passed through');
}

console.log('\n=== message-tool: with meta ===');
{
  const captured = [];
  const text = `<<LEAVE_MESSAGE: {"target":"vulcan","action":"brief","subject":"build priority","body":"Ship the tool first","meta":{"priority":"high","flight":"abc123"}}>>`;

  parseTool(text, { entity: 'juno', sessionId: 'sess2', userId: 'u2' }, (p) => captured.push(p));

  assertEqual(captured.length, 1, 'fires with meta');
  assertEqual(captured[0].meta.priority, 'high', 'meta.priority preserved');
  assertEqual(captured[0].meta.flight, 'abc123', 'meta.flight preserved');
}

console.log('\n=== message-tool: multiple markers ===');
{
  const captured = [];
  const text = `First message.
<<LEAVE_MESSAGE: {"target":"juno","action":"note","subject":"note one","body":"Body one"}>>
Middle text.
<<LEAVE_MESSAGE: {"target":"muse","action":"feedback","subject":"design feedback","body":"The layout needs more whitespace"}>>
End text.`;

  const cleaned = parseTool(text, { entity: 'alice', sessionId: 'sess3', userId: 'u3' }, (p) => captured.push(p));

  assertEqual(captured.length, 2, 'fires twice for two markers');
  assertEqual(captured[0].target, 'juno', 'first target');
  assertEqual(captured[1].target, 'muse', 'second target');
  assert(!cleaned.includes('<<LEAVE_MESSAGE'), 'both markers stripped');
  assert(cleaned.includes('First message.'), 'first segment preserved');
  assert(cleaned.includes('Middle text.'), 'middle segment preserved');
  assert(cleaned.includes('End text.'), 'end segment preserved');
}

console.log('\n=== message-tool: no callback registered ===');
{
  // Should not throw; just silently drops
  const text = `<<LEAVE_MESSAGE: {"target":"juno","action":"note","subject":"test subject","body":"test body"}>>`;
  let threw = false;
  try {
    parseTool(text, { entity: 'alice', sessionId: 'sess4', userId: 'u4' }, null);
  } catch (e) {
    threw = true;
  }
  assert(!threw, 'no callback: does not throw');
}

console.log('\n=== message-tool: missing required fields ===');
{
  const captured = [];
  const cb = (p) => captured.push(p);

  // Missing target
  parseTool(`<<LEAVE_MESSAGE: {"action":"note","subject":"x","body":"y"}>>`, {}, cb);
  assertEqual(captured.length, 0, 'missing target: discarded');

  // Missing action
  parseTool(`<<LEAVE_MESSAGE: {"target":"juno","subject":"x","body":"y"}>>`, {}, cb);
  assertEqual(captured.length, 0, 'missing action: discarded');

  // Missing subject
  parseTool(`<<LEAVE_MESSAGE: {"target":"juno","action":"note","body":"y"}>>`, {}, cb);
  assertEqual(captured.length, 0, 'missing subject: discarded');

  // Missing body
  parseTool(`<<LEAVE_MESSAGE: {"target":"juno","action":"note","subject":"a subject here"}>>`, {}, cb);
  assertEqual(captured.length, 0, 'missing body: discarded');
}

console.log('\n=== message-tool: invalid target ===');
{
  const captured = [];
  const cb = (p) => captured.push(p);

  // Uppercase
  parseTool(`<<LEAVE_MESSAGE: {"target":"Juno","action":"note","subject":"test subject","body":"body"}>>`, {}, cb);
  assertEqual(captured.length, 0, 'uppercase target: discarded');

  // Spaces
  parseTool(`<<LEAVE_MESSAGE: {"target":"some entity","action":"note","subject":"test subject","body":"body"}>>`, {}, cb);
  assertEqual(captured.length, 0, 'target with spaces: discarded');

  // Injection attempt
  parseTool(`<<LEAVE_MESSAGE: {"target":"juno/../../etc","action":"note","subject":"test subject","body":"body"}>>`, {}, cb);
  assertEqual(captured.length, 0, 'path-traversal target: discarded');
}

console.log('\n=== message-tool: invalid action ===');
{
  const captured = [];
  const cb = (p) => captured.push(p);

  // Spaces in action
  parseTool(`<<LEAVE_MESSAGE: {"target":"juno","action":"note with spaces","subject":"sub","body":"body"}>>`, {}, cb);
  assertEqual(captured.length, 0, 'action with spaces: discarded');

  // Too long action
  const longAction = 'a'.repeat(65);
  parseTool(`<<LEAVE_MESSAGE: {"target":"juno","action":"${longAction}","subject":"sub","body":"body"}>>`, {}, cb);
  assertEqual(captured.length, 0, 'action too long: discarded');
}

console.log('\n=== message-tool: subject length ===');
{
  const captured = [];
  const cb = (p) => captured.push(p);

  // Too short (< 3 chars)
  parseTool(`<<LEAVE_MESSAGE: {"target":"juno","action":"note","subject":"ab","body":"body"}>>`, {}, cb);
  assertEqual(captured.length, 0, 'subject too short: discarded');

  // Too long (> 200 chars)
  const longSubject = 'x'.repeat(201);
  parseTool(`<<LEAVE_MESSAGE: {"target":"juno","action":"note","subject":"${longSubject}","body":"body"}>>`, {}, cb);
  assertEqual(captured.length, 0, 'subject too long: discarded');
}

console.log('\n=== message-tool: body length ===');
{
  const captured = [];
  const cb = (p) => captured.push(p);

  // Empty body
  parseTool(`<<LEAVE_MESSAGE: {"target":"juno","action":"note","subject":"good subject","body":""}>>`, {}, cb);
  assertEqual(captured.length, 0, 'empty body: discarded');

  // Too long (> 4000 chars)
  const longBody = 'x'.repeat(4001);
  parseTool(`<<LEAVE_MESSAGE: {"target":"juno","action":"note","subject":"good subject","body":"${longBody}"}>>`, {}, cb);
  assertEqual(captured.length, 0, 'body too long: discarded');
}

console.log('\n=== message-tool: invalid JSON ===');
{
  const captured = [];
  const cb = (p) => captured.push(p);

  parseTool(`<<LEAVE_MESSAGE: not json at all>>`, {}, cb);
  assertEqual(captured.length, 0, 'non-JSON content: discarded');

  parseTool(`<<LEAVE_MESSAGE: {"target":"juno","action":"note","subject":"sub","body":}>>`, {}, cb);
  assertEqual(captured.length, 0, 'malformed JSON: discarded');

  // JSON array (not object)
  parseTool(`<<LEAVE_MESSAGE: ["juno","note","sub","body"]>>`, {}, cb);
  assertEqual(captured.length, 0, 'JSON array: discarded');
}

console.log('\n=== message-tool: marker is stripped even when invalid ===');
{
  // Even invalid markers must be stripped from client text
  const text = `Before <<LEAVE_MESSAGE: not json at all>> after.`;
  const cleaned = parseTool(text, {}, null);
  assert(!cleaned.includes('<<LEAVE_MESSAGE'), 'invalid marker stripped from text');
  assert(cleaned.includes('Before'), 'text before preserved');
  assert(cleaned.includes('after.'), 'text after preserved');
}

console.log('\n=== message-tool: meta as array ignored gracefully ===');
{
  const captured = [];
  const text = `<<LEAVE_MESSAGE: {"target":"juno","action":"note","subject":"meta test","body":"body content","meta":["bad"]}>>`;
  parseTool(text, { entity: 'alice', sessionId: 's', userId: 'u' }, (p) => captured.push(p));
  // meta is invalid (array) so it defaults to {} but the message itself is still valid
  assertEqual(captured.length, 1, 'valid message fires even with bad meta');
  assert(Object.keys(captured[0].meta).length === 0, 'meta defaults to empty object');
}

console.log('\n=== message-tool: no markers in text ===');
{
  const captured = [];
  const text = `Just a normal response with no markers at all.`;
  const cleaned = parseTool(text, { entity: 'alice' }, (p) => captured.push(p));
  assertEqual(captured.length, 0, 'no markers: no callback fired');
  assertEqual(cleaned, text, 'text unchanged');
}

console.log('\n=== message-tool: null/empty input ===');
{
  let threw = false;
  try {
    const r1 = parseTool(null, {}, null);
    const r2 = parseTool('', {}, null);
    assert(r1 === null, 'null input: returns null');
    assert(r2 === '', 'empty string: returns empty string');
  } catch (e) {
    threw = true;
  }
  assert(!threw, 'null/empty input: does not throw');
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
console.log(`message-tool: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
