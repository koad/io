// test-notify.js — the channel / cursor / presence primitive.
//
// Run: node modules/node/test-notify.js
//
// The two tests that matter most are here by name, because they are the two the
// brief said to run or call the tool unfinished:
//
//   • IDLE COSTS ONE TURN (test 2/3) — a re-subscribe with nothing new returns
//     `timed_out: true` after the ceiling with an empty event list. No spin, no
//     replay, no spend beyond the single turn.
//   • A CRASH CANNOT POISON THE CHANNEL (test 4) — a writer killed mid-line
//     leaves a tail with no newline; the reader returns the last COMPLETE line
//     and never a partial JSON object.
//
// Everything else proves a property the contract names: positional cursor,
// unknown cursor never replays, bounded summary with its true length, freshness
// expiry, and the relay burst.

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'koad-notify-test-'));
process.env.KOAD_IO_RUNTIME_PATH = scratch;

const notify = await import('./notify.js');

let passed = 0;
const failures = [];
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.log(`  ✗ ${name}\n      ${err && err.message ? err.message : err}`);
  }
}

function channel(name) {
  return name;
}

console.log('notify — channel, cursor, wake, presence, relay');

// ── 1. two events, cursor is the second id ────────────────────────────────
await test('append two events → read returns both, cursor is the second id', () => {
  const a = notify.appendEvent(channel('triage'), {
    type: 'item.opened', item: 'tr-1', by: 'juno', via: 'curator', summary: 'opened tr-1',
  });
  const b = notify.appendEvent(channel('triage'), {
    type: 'item.read', item: 'tr-1', by: 'sienna', via: 'mcp.koad.sh', summary: 'read tr-1',
  });
  assert.notEqual(a.id, b.id, 'two events must not share an id');

  const read = notify.readEvents(channel('triage'), { since: '-' });
  assert.equal(read.events.length, 2);
  assert.equal(read.events[0].id, a.id);
  assert.equal(read.events[1].id, b.id);
  assert.equal(read.cursor, b.id);
  assert.equal(read.cursor_unknown, false);
});

// ── 2. re-subscribe with the cursor, nothing new → idles, then times out ──
await test('re-subscribe with the last id and no new events → timed_out, zero events', async () => {
  const last = notify.readEvents(channel('triage'), { since: '-' }).cursor;
  const started = Date.now();
  const res = await notify.waitForEvents(channel('triage'), { since: last, maxWaitMs: 350, pollMs: 50 });
  const elapsed = Date.now() - started;
  assert.equal(res.events.length, 0);
  assert.equal(res.timed_out, true);
  assert.equal(res.cursor, last, 'cursor must be handed back unchanged');
  assert.ok(elapsed >= 300, `must actually wait the ceiling (waited ${elapsed}ms)`);
  assert.ok(elapsed < 3000, `must not spin (waited ${elapsed}ms)`);
});

// ── 3. append while blocked → returns immediately with exactly that event ──
await test('append while blocked → returns at once with exactly that event', async () => {
  const last = notify.readEvents(channel('triage'), { since: '-' }).cursor;
  const pending = notify.waitForEvents(channel('triage'), { since: last, maxWaitMs: 5000, pollMs: 50 });
  await new Promise((resolve) => setTimeout(resolve, 150));
  const appended = notify.appendEvent(channel('triage'), {
    type: 'item.decided', item: 'tr-2', by: 'koad', via: 'voice', summary: 'decided tr-2',
  });
  const res = await pending;
  assert.equal(res.timed_out, false);
  assert.equal(res.events.length, 1, 'exactly one event, not a batch');
  assert.equal(res.events[0].id, appended.id);
  assert.equal(res.cursor, appended.id);
  assert.ok(res.waited_ms < 4000, `must return on the write, not the ceiling (waited ${res.waited_ms}ms)`);
});

// ── 4. torn line: last COMPLETE line only, never a partial object ─────────
await test('writer killed mid-line → reader returns the last complete line only', () => {
  const file = notify.channelPath('questions');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const good = notify.appendEvent('questions', {
    type: 'question.asked', item: 'q-1', by: 'juno', via: 'ask_question', summary: 'asked q-1',
  });
  // Simulate a crash mid-append: a line that never got its newline.
  fs.appendFileSync(file, '{"id":"torn","at":"2026-11-07T04:00:00Z","type":"question.ans');

  const read = notify.readEvents('questions', { since: '-' });
  assert.equal(read.events.length, 1, 'the complete line survives');
  assert.equal(read.events[0].id, good.id);
  assert.ok(read.partial_bytes > 0, 'the unterminated tail is reported, not parsed');
  assert.equal(read.cursor, good.id);
});

// ── 5. unknown cursor never replays ───────────────────────────────────────
await test('cursor the channel does not contain → nothing returned, stated plainly', () => {
  const read = notify.readEvents('triage', { since: 'not-an-id-in-this-file' });
  assert.equal(read.events.length, 0, 're-delivering a decision is the failure mode; never replay');
  assert.equal(read.cursor_unknown, true);
  assert.equal(read.cursor, 'not-an-id-in-this-file');
});

// ── 6. bounded summary, true length stated ────────────────────────────────
await test('400-char summary → clipped to one line with the true length stated', () => {
  const body = 'x'.repeat(400);
  const event = notify.appendEvent('triage', {
    type: 'item.stale', item: 'tr-3', by: 'indexer', via: 'age', summary: body,
  });
  assert.equal(event.summary.length, notify.SUMMARY_MAX);
  assert.equal(event.summary_length, 400);
  assert.equal(event.summary_truncated, true);

  const read = notify.readEvents('triage', { since: '-' });
  const stored = read.events.find((row) => row.id === event.id);
  assert.equal(stored.summary.length, notify.SUMMARY_MAX);
  assert.equal(stored.summary_length, 400);
  assert.ok(!JSON.stringify(stored).includes(body), 'no body text anywhere in the payload');
});

// ── 7. presence: fresh reads listening, expired reads last-seen ───────────
await test('presence → listening while refreshed, last-seen after five minutes', () => {
  const now = Date.parse('2026-11-07T04:00:00.000Z');
  notify.writePresence({
    entity: 'juno', session: 'juno-test', mode: 'triage', cursor: null, accepts: ['message'], now,
  });

  const fresh = notify.listPresence({ now: now + 60_000 });
  assert.equal(fresh.count, 1);
  assert.equal(fresh.listening[0].session, 'juno-test');
  assert.equal(fresh.listening[0].freshness, 'listening');
  assert.equal(fresh.listening[0].age_s, 60);

  const stale = notify.listPresence({ now: now + 5 * 60_000 + 30_000 });
  assert.equal(stale.count, 0, 'an unrefreshed listener is not listening');
  assert.equal(stale.listening.length, 0, 'absent, not greyed out');
  assert.equal(stale.last_seen.length, 1);
  assert.equal(stale.last_seen[0].freshness, 'last-seen');
  assert.equal(stale.last_seen[0].age_s, 330);
});

// ── 8. presence: one entry per session, entities accumulate ───────────────
await test('presence → a re-subscribe refreshes in place, never duplicates', () => {
  notify.writePresence({ entity: 'hermes', session: 'hermes-a', mode: 'triage', cursor: 'e1' });
  notify.writePresence({ entity: 'hermes', session: 'hermes-b', mode: 'questions', cursor: null });
  const record = notify.readPresenceFile('hermes');
  assert.equal(record.sessions.length, 2, 'one entry per session');
  notify.writePresence({ entity: 'hermes', session: 'hermes-a', mode: 'triage', cursor: 'e2' });
  const again = notify.readPresenceFile('hermes');
  assert.equal(again.sessions.length, 2, 'refresh replaces, does not append');
  const a = again.sessions.find((row) => row.session === 'hermes-a');
  assert.equal(a.cursor, 'e2');
  assert.ok(a.since, 'since is the first time, not the refresh time');
});

// ── 9. nobody listening is a real answer ──────────────────────────────────
await test('findListener → null when no fresh presence (nobody is listening)', () => {
  assert.equal(notify.findListener('nobody-at-all'), null);
  assert.equal(notify.findListener('juno', { now: Date.now() + 60 * 60_000 }), null);
  const found = notify.findListener('juno', { now: Date.parse('2026-11-07T04:01:00.000Z') });
  assert.ok(found, 'a fresh entry is addressable');
  assert.equal(found.session, 'juno-test');
});

// ── 10. relay: burst of three, then one per minute ────────────────────────
await test('relay budget → 3 through, 4th throttled with a wait, allowed a minute later', () => {
  const t0 = Date.parse('2026-11-07T04:00:00.000Z');
  for (let i = 0; i < notify.RELAY_BURST; i += 1) {
    const grant = notify.takeRelayToken('sienna:s1', { now: t0 + i });
    assert.equal(grant.allowed, true, `relay ${i + 1} of the burst should pass`);
  }
  const refused = notify.takeRelayToken('sienna:s1', { now: t0 + 10 });
  assert.equal(refused.allowed, false);
  assert.equal(refused.remaining, 0);
  assert.match(refused.reason, /throttled/);
  assert.ok(refused.retry_after_s >= 1);

  const later = notify.takeRelayToken('sienna:s1', { now: t0 + 61_000 });
  assert.equal(later.allowed, true, 'one per minute, measured');
});

// ── 11. channel names are a bound ─────────────────────────────────────────
await test('channel name is a bound, not a path', () => {
  assert.throws(() => notify.appendEvent('../../etc/passwd', { type: 'x' }), /invalid channel name/);
  assert.throws(() => notify.appendEvent('Triage', { type: 'x' }), /invalid channel name/);
});

// ── 12. attribution survives the round trip ───────────────────────────────
await test('every event carries by + via', () => {
  const event = notify.appendEvent('triage', {
    type: 'message', item: 'juno', by: 'sienna', via: 'relay', summary: 'status?',
    to: 'juno', to_session: 'juno-test',
  });
  const read = notify.readEvents('triage', { since: '-' }).events.find((row) => row.id === event.id);
  assert.equal(read.by, 'sienna');
  assert.equal(read.via, 'relay');
  assert.equal(read.to, 'juno');
  assert.equal(read.to_session, 'juno-test');
});

fs.rmSync(scratch, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const failure of failures) console.error(`FAIL: ${failure.name}\n${failure.err && failure.err.stack}`);
  process.exit(1);
}
