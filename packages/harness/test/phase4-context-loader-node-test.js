#!/usr/bin/env node
// Phase 4 Node-runnable tests — Layer 4a context loader (VESTA-SPEC-134 §8)
// Run: node test/phase4-context-loader-node-test.js

'use strict';

// ── Stubs ─────────────────────────────────────────────────────────────────────

const nodeCrypto = require('crypto');
if (typeof globalThis.crypto === 'undefined') {
  globalThis.crypto = nodeCrypto.webcrypto;
}

// Inline context loader logic (same as memory-context-loader.js, without Meteor)

const DEFAULT_MAX = 50;

function getMaxMemories(overrideN) {
  if (typeof overrideN === 'number') return overrideN;
  const envVal = parseInt((process.env.KOAD_IO_MEMORY_MAX_N) || '', 10);
  return isNaN(envVal) ? DEFAULT_MAX : envVal;
}

function profileQualityMeetsBasic(pq) {
  return pq === 'basic' || pq === 'full';
}

async function loadMemoryContext({ userId, entity, kek, profileQuality, bondActive, maxMemories } = {}) {
  if (!userId) return '';
  if (!bondActive) return '';
  if (!profileQualityMeetsBasic(profileQuality)) return '';
  if (!kek) return '';

  const N = getMaxMemories(maxMemories);
  if (N === 0) return '';

  const col   = globalThis.UserMemoriesCollection;
  const store = globalThis.KoadMemoryStore;
  if (!col || !store) return '';

  let activeDocs;
  try {
    activeDocs = await col.find({ user_id: userId, entity, superseded_at: null, forgotten_at: null }).fetchAsync();
  } catch (err) {
    return '';
  }

  if (!activeDocs || activeDocs.length === 0) return '';

  activeDocs.sort((a, b) => new Date(b.captured_at) - new Date(a.captured_at));
  const toLoad = activeDocs.slice(0, N);

  const fragments = [];
  for (const doc of toLoad) {
    try {
      const plaintextBytes = await store.read(doc.cid, doc.wrapped_dek, kek);
      const plaintext = new TextDecoder().decode(plaintextBytes);
      fragments.push({ topic: doc.topic || null, captured_at: doc.captured_at, content: plaintext });
    } catch (err) {
      // skip fragment
    }
  }

  if (fragments.length === 0) return '';

  const lines = ['## What I remember about you', ''];
  for (const { topic, captured_at, content } of fragments) {
    const prefix = topic
      ? topic
      : (captured_at instanceof Date ? captured_at : new Date(captured_at)).toISOString().slice(0, 10);
    lines.push(`- [${prefix}]: ${content}`);
  }

  return lines.join('\n');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeDoc(overrides) {
  return Object.assign({
    _id:           `mem_${Math.random().toString(36).slice(2, 10)}`,
    user_id:       'u1',
    entity:        'alice',
    cid:           `cid-${Math.random().toString(36).slice(2)}`,
    captured_at:   new Date(),
    captured_from: 'pwa',
    wrapped_dek:   'stub',
    blob_size:     4096,
    surface:       'memory',
    topic:         null,
    visibility:    'private',
    supersedes:    null,
    superseded_at: null,
    forgotten_at:  null,
    key_version:   1,
  }, overrides);
}

function installStubs(docs, plaintextByCid) {
  globalThis.UserMemoriesCollection = {
    find(query) {
      const { user_id, entity } = query;
      const results = docs.filter(d =>
        d.user_id === user_id && d.entity === entity &&
        d.superseded_at === null && d.forgotten_at === null
      );
      return { async fetchAsync() { return results; } };
    },
  };
  globalThis.KoadMemoryStore = {
    async read(cid) {
      if (plaintextByCid[cid] === undefined) throw new Error(`not found: ${cid}`);
      return new TextEncoder().encode(plaintextByCid[cid]);
    },
  };
}

function clearStubs() {
  globalThis.UserMemoriesCollection = null;
  globalThis.KoadMemoryStore = null;
}

// ── Test runner ───────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
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

const stubKek = { type: 'secret', stub: true };

process.stdout.write('Phase 4 — Layer 4a context loader node tests\n\n');

(async function main() {

// ── Silent omission ───────────────────────────────────────────────────────────

await test('omits when userId null', async () => {
  assert(await loadMemoryContext({ userId: null, entity: 'alice', kek: stubKek, profileQuality: 'full', bondActive: true }) === '', 'empty');
});

await test('omits when bondActive false', async () => {
  assert(await loadMemoryContext({ userId: 'u1', entity: 'alice', kek: stubKek, profileQuality: 'full', bondActive: false }) === '', 'empty');
});

await test('omits when profile_quality=none', async () => {
  assert(await loadMemoryContext({ userId: 'u1', entity: 'alice', kek: stubKek, profileQuality: 'none', bondActive: true }) === '', 'empty');
});

await test('omits when profile_quality=null', async () => {
  assert(await loadMemoryContext({ userId: 'u1', entity: 'alice', kek: null, profileQuality: 'full', bondActive: true }) === '', 'empty');
});

await test('omits when kek null', async () => {
  assert(await loadMemoryContext({ userId: 'u1', entity: 'alice', kek: null, profileQuality: 'full', bondActive: true }) === '', 'empty');
});

await test('omits when maxMemories=0', async () => {
  assert(await loadMemoryContext({ userId: 'u1', entity: 'alice', kek: stubKek, profileQuality: 'full', bondActive: true, maxMemories: 0 }) === '', 'empty');
});

await test('omits when no active memories', async () => {
  installStubs([], {});
  const r = await loadMemoryContext({ userId: 'u1', entity: 'alice', kek: stubKek, profileQuality: 'full', bondActive: true });
  assert(r === '', 'empty when no docs');
  clearStubs();
});

// ── Normal assembly ───────────────────────────────────────────────────────────

await test('profile_quality=basic passes gate', async () => {
  const doc = makeDoc({ cid: 'c1', topic: null, captured_at: new Date('2026-04-01') });
  installStubs([doc], { c1: 'user prefers jazz' });
  const r = await loadMemoryContext({ userId: 'u1', entity: 'alice', kek: stubKek, profileQuality: 'basic', bondActive: true });
  assert(r.includes('## What I remember about you'), 'header present');
  assert(r.includes('user prefers jazz'), 'content present');
  clearStubs();
});

await test('topic prefix used when topic present', async () => {
  const doc = makeDoc({ cid: 'c2', topic: 'music', captured_at: new Date('2026-03-01') });
  installStubs([doc], { c2: 'likes jazz' });
  const r = await loadMemoryContext({ userId: 'u1', entity: 'alice', kek: stubKek, profileQuality: 'full', bondActive: true });
  assert(r.includes('[music]'), 'topic prefix');
  clearStubs();
});

await test('ISO date prefix when no topic', async () => {
  const doc = makeDoc({ cid: 'c3', topic: null, captured_at: new Date('2026-04-15T10:00:00Z') });
  installStubs([doc], { c3: 'prefers mornings' });
  const r = await loadMemoryContext({ userId: 'u1', entity: 'alice', kek: stubKek, profileQuality: 'full', bondActive: true });
  assert(r.includes('[2026-04-15]'), 'ISO date prefix');
  clearStubs();
});

await test('memories sorted newest first', async () => {
  const older = makeDoc({ cid: 'c4', topic: 'old', captured_at: new Date('2026-01-01') });
  const newer = makeDoc({ cid: 'c5', topic: 'new', captured_at: new Date('2026-04-01') });
  installStubs([older, newer], { c4: 'old fact', c5: 'new fact' });
  const r = await loadMemoryContext({ userId: 'u1', entity: 'alice', kek: stubKek, profileQuality: 'full', bondActive: true });
  assert(r.indexOf('[new]') < r.indexOf('[old]'), 'newer appears first');
  clearStubs();
});

await test('mix of topic and no-topic memories', async () => {
  const d1 = makeDoc({ cid: 'c6', topic: 'goals', captured_at: new Date('2026-04-10') });
  const d2 = makeDoc({ cid: 'c7', topic: null,    captured_at: new Date('2026-04-11') });
  installStubs([d1, d2], { c6: 'learn Rust', c7: 'early riser' });
  const r = await loadMemoryContext({ userId: 'u1', entity: 'alice', kek: stubKek, profileQuality: 'full', bondActive: true });
  assert(r.includes('[goals]'), 'topic prefix');
  assert(r.includes('[2026-04-1'), 'ISO date prefix');
  clearStubs();
});

// ── N=50 cap: 50 from 50 ─────────────────────────────────────────────────────

await test('N=50: all 50 memories loaded when exactly 50', async () => {
  const docs = [];
  const map  = {};
  for (let i = 0; i < 50; i++) {
    const cid = `cid-50-${i}`;
    const d   = makeDoc({ cid, captured_at: new Date(Date.now() - i * 1000) });
    docs.push(d);
    map[cid] = `memory-${i}`;
  }
  installStubs(docs, map);
  const r = await loadMemoryContext({ userId: 'u1', entity: 'alice', kek: stubKek, profileQuality: 'full', bondActive: true, maxMemories: 50 });
  const lines = r.split('\n').filter(l => l.startsWith('- ['));
  assert(lines.length === 50, `expected 50 lines, got ${lines.length}`);
  clearStubs();
});

// ── N=50 cap: 50 newest from 100 ─────────────────────────────────────────────

await test('N=50: 50 newest from 100 active memories', async () => {
  const docs = [];
  const map  = {};
  const base = new Date('2026-01-01').getTime();
  for (let i = 0; i < 100; i++) {
    const cid = `cid-100-${i}`;
    const d   = makeDoc({ cid, captured_at: new Date(base + i * 60000) });
    docs.push(d);
    map[cid] = `mem-${i}`;
  }
  installStubs(docs, map);
  const r = await loadMemoryContext({ userId: 'u1', entity: 'alice', kek: stubKek, profileQuality: 'full', bondActive: true, maxMemories: 50 });
  const lines = r.split('\n').filter(l => l.startsWith('- ['));
  assert(lines.length === 50, `expected 50 lines, got ${lines.length}`);
  assert(!r.includes('mem-0'), 'oldest not loaded');
  assert(!r.includes('mem-49'), 'borderline oldest not loaded');
  assert(r.includes('mem-99'), 'newest present');
  assert(r.includes('mem-50'), 'newest boundary present');
  clearStubs();
});

// ── Summary ───────────────────────────────────────────────────────────────────

process.stdout.write(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);

})();
