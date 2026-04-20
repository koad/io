/* global Tinytest, KoadHarnessMemoryContextLoader */
// Phase 4 tests — Layer 4a context loader (VESTA-SPEC-134 §8)
//
// Tests the context loader's prompt assembly, N_MAX_MEMORIES truncation,
// silent-omission conditions, topic/timestamp prefix logic.
//
// All crypto is stubbed — no real AES-GCM in Tinytest context.
// Node-runnable variant: phase4-context-loader-node-test.js

// ── Stubs ─────────────────────────────────────────────────────────────────────

function makeMockKek() {
  // Stub CryptoKey — MemoryStore.read() is also stubbed so this is never used for real crypto.
  return { type: 'secret', algorithm: { name: 'AES-KW' }, stub: true };
}

function makeDoc(overrides) {
  const now = new Date();
  return Object.assign({
    _id:           `mem_${Math.random().toString(36).slice(2)}`,
    user_id:       'user_abc',
    entity:        'alice',
    cid:           `mock-cid-${Math.random().toString(36).slice(2)}`,
    captured_at:   now,
    captured_from: 'pwa',
    wrapped_dek:   'mock-wrapped-dek',
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

function installMockStore(docs, plaintextByDocId) {
  globalThis._testUserMemoriesDocs = docs;
  globalThis._testPlaintextByDocId = plaintextByDocId;

  globalThis.UserMemoriesCollection = {
    find(query) {
      const { user_id, entity } = query;
      const results = (globalThis._testUserMemoriesDocs || []).filter(doc =>
        doc.user_id === user_id &&
        doc.entity  === entity  &&
        doc.superseded_at === null &&
        doc.forgotten_at  === null
      );
      return { async fetchAsync() { return results; } };
    },
  };

  globalThis.KoadMemoryStore = {
    async read(cid, wrapped_dek, kek) {
      const map = globalThis._testPlaintextByDocId || {};
      const docEntry = Object.entries(map).find(([id, val]) => val.cid === cid);
      if (!docEntry) throw new Error(`stub: CID not found: ${cid}`);
      return new TextEncoder().encode(docEntry[1].plaintext);
    },
  };
}

function clearMockStore() {
  globalThis.UserMemoriesCollection = null;
  globalThis.KoadMemoryStore        = null;
  globalThis._testUserMemoriesDocs  = null;
  globalThis._testPlaintextByDocId  = null;
}

// ── Silent omission tests ─────────────────────────────────────────────────────

Tinytest.addAsync('memory-context-loader - omits when userId null', async function (test) {
  clearMockStore();
  const result = await KoadHarnessMemoryContextLoader.load({
    userId: null, entity: 'alice', kek: makeMockKek(),
    profileQuality: 'full', bondActive: true,
  });
  test.equal(result, '', 'empty string when no userId');
});

Tinytest.addAsync('memory-context-loader - omits when bondActive false', async function (test) {
  clearMockStore();
  const result = await KoadHarnessMemoryContextLoader.load({
    userId: 'u1', entity: 'alice', kek: makeMockKek(),
    profileQuality: 'full', bondActive: false,
  });
  test.equal(result, '', 'empty string when bond not active');
});

Tinytest.addAsync('memory-context-loader - omits when profile_quality none', async function (test) {
  clearMockStore();
  const result = await KoadHarnessMemoryContextLoader.load({
    userId: 'u1', entity: 'alice', kek: makeMockKek(),
    profileQuality: 'none', bondActive: true,
  });
  test.equal(result, '', 'empty when profile_quality=none');
});

Tinytest.addAsync('memory-context-loader - omits when profile_quality missing', async function (test) {
  clearMockStore();
  const result = await KoadHarnessMemoryContextLoader.load({
    userId: 'u1', entity: 'alice', kek: makeMockKek(),
    profileQuality: null, bondActive: true,
  });
  test.equal(result, '', 'empty when profile_quality null');
});

Tinytest.addAsync('memory-context-loader - omits when kek null', async function (test) {
  clearMockStore();
  const result = await KoadHarnessMemoryContextLoader.load({
    userId: 'u1', entity: 'alice', kek: null,
    profileQuality: 'full', bondActive: true,
  });
  test.equal(result, '', 'empty when no KEK');
});

Tinytest.addAsync('memory-context-loader - omits when maxMemories=0', async function (test) {
  clearMockStore();
  const result = await KoadHarnessMemoryContextLoader.load({
    userId: 'u1', entity: 'alice', kek: makeMockKek(),
    profileQuality: 'full', bondActive: true, maxMemories: 0,
  });
  test.equal(result, '', 'empty when N=0');
});

Tinytest.addAsync('memory-context-loader - omits when UserMemoriesCollection absent', async function (test) {
  clearMockStore();
  // Explicitly leave collection null
  globalThis.UserMemoriesCollection = null;
  globalThis.KoadMemoryStore = { async read() { return new Uint8Array(); } };
  const result = await KoadHarnessMemoryContextLoader.load({
    userId: 'u1', entity: 'alice', kek: makeMockKek(),
    profileQuality: 'full', bondActive: true,
  });
  test.equal(result, '', 'empty when collection unavailable');
});

Tinytest.addAsync('memory-context-loader - omits when no active memories', async function (test) {
  installMockStore([], {});
  const result = await KoadHarnessMemoryContextLoader.load({
    userId: 'u1', entity: 'alice', kek: makeMockKek(),
    profileQuality: 'full', bondActive: true,
  });
  test.equal(result, '', 'empty when no memories');
  clearMockStore();
});

// ── Normal assembly ───────────────────────────────────────────────────────────

Tinytest.addAsync('memory-context-loader - basic=true passes gate', async function (test) {
  const doc = makeDoc({ user_id: 'u1', entity: 'alice', cid: 'cid-1', topic: null });
  installMockStore([doc], { [doc._id]: { cid: 'cid-1', plaintext: 'user likes jazz' } });
  const result = await KoadHarnessMemoryContextLoader.load({
    userId: 'u1', entity: 'alice', kek: makeMockKek(),
    profileQuality: 'basic', bondActive: true,
  });
  test.isTrue(result.includes('## What I remember about you'), 'header present');
  test.isTrue(result.includes('user likes jazz'), 'content present');
  clearMockStore();
});

Tinytest.addAsync('memory-context-loader - topic prefix used when topic present', async function (test) {
  const doc = makeDoc({
    user_id: 'u1', entity: 'alice', cid: 'cid-2',
    topic: 'preferences', captured_at: new Date('2026-03-01'),
  });
  installMockStore([doc], { [doc._id]: { cid: 'cid-2', plaintext: 'prefers dark mode' } });
  const result = await KoadHarnessMemoryContextLoader.load({
    userId: 'u1', entity: 'alice', kek: makeMockKek(),
    profileQuality: 'full', bondActive: true,
  });
  test.isTrue(result.includes('[preferences]'), 'topic prefix used');
  clearMockStore();
});

Tinytest.addAsync('memory-context-loader - ISO date prefix when no topic', async function (test) {
  const capturedAt = new Date('2026-04-15T10:00:00Z');
  const doc = makeDoc({
    user_id: 'u1', entity: 'alice', cid: 'cid-3',
    topic: null, captured_at: capturedAt,
  });
  installMockStore([doc], { [doc._id]: { cid: 'cid-3', plaintext: 'a past fact' } });
  const result = await KoadHarnessMemoryContextLoader.load({
    userId: 'u1', entity: 'alice', kek: makeMockKek(),
    profileQuality: 'full', bondActive: true,
  });
  test.isTrue(result.includes('[2026-04-15]'), 'ISO date prefix used');
  clearMockStore();
});

Tinytest.addAsync('memory-context-loader - mix of topic and no-topic memories', async function (test) {
  const d1 = makeDoc({ user_id: 'u1', entity: 'alice', cid: 'cid-4', topic: 'goals', captured_at: new Date('2026-04-10') });
  const d2 = makeDoc({ user_id: 'u1', entity: 'alice', cid: 'cid-5', topic: null,    captured_at: new Date('2026-04-11') });
  installMockStore([d1, d2], {
    [d1._id]: { cid: 'cid-4', plaintext: 'wants to learn Rust' },
    [d2._id]: { cid: 'cid-5', plaintext: 'early morning person' },
  });
  const result = await KoadHarnessMemoryContextLoader.load({
    userId: 'u1', entity: 'alice', kek: makeMockKek(),
    profileQuality: 'full', bondActive: true,
  });
  test.isTrue(result.includes('[goals]'), 'topic prefix present');
  test.isTrue(result.includes('[2026-04-1'), 'ISO date prefix present');
  clearMockStore();
});

// ── N_MAX_MEMORIES truncation ────────────────────────────────────────────────

Tinytest.addAsync('memory-context-loader - N=50 cap: 50 memories loaded from 50', async function (test) {
  const docs = [];
  const map  = {};
  for (let i = 0; i < 50; i++) {
    const cid = `cid-n50-${i}`;
    const d   = makeDoc({ user_id: 'u1', entity: 'alice', cid, captured_at: new Date(Date.now() - i * 1000) });
    docs.push(d);
    map[d._id] = { cid, plaintext: `memory ${i}` };
  }
  installMockStore(docs, map);
  const result = await KoadHarnessMemoryContextLoader.load({
    userId: 'u1', entity: 'alice', kek: makeMockKek(),
    profileQuality: 'full', bondActive: true, maxMemories: 50,
  });
  // Count lines starting with "- ["
  const lines = result.split('\n').filter(l => l.startsWith('- ['));
  test.equal(lines.length, 50, 'all 50 memories loaded');
  clearMockStore();
});

Tinytest.addAsync('memory-context-loader - N=50 cap: 50 newest loaded from 100', async function (test) {
  const docs = [];
  const map  = {};
  const base  = new Date('2026-01-01').getTime();
  for (let i = 0; i < 100; i++) {
    const cid = `cid-n100-${i}`;
    // i=0 is oldest, i=99 is newest
    const d   = makeDoc({ user_id: 'u1', entity: 'alice', cid, captured_at: new Date(base + i * 60000) });
    docs.push(d);
    map[d._id] = { cid, plaintext: `memory-${i}` };
  }
  installMockStore(docs, map);
  const result = await KoadHarnessMemoryContextLoader.load({
    userId: 'u1', entity: 'alice', kek: makeMockKek(),
    profileQuality: 'full', bondActive: true, maxMemories: 50,
  });
  const lines = result.split('\n').filter(l => l.startsWith('- ['));
  test.equal(lines.length, 50, 'exactly 50 memories');
  // Oldest 50 (memory-0 through memory-49) must NOT appear
  test.isFalse(result.includes('memory-0'), 'oldest not loaded');
  test.isFalse(result.includes('memory-49'), 'borderline oldest not loaded');
  // Newest 50 (memory-50 through memory-99) must all appear
  test.isTrue(result.includes('memory-99'), 'newest present');
  test.isTrue(result.includes('memory-50'), 'newest boundary present');
  clearMockStore();
});

// ── Sort order ───────────────────────────────────────────────────────────────

Tinytest.addAsync('memory-context-loader - memories sorted newest first', async function (test) {
  const older = makeDoc({ user_id: 'u1', entity: 'alice', cid: 'cid-older', captured_at: new Date('2026-03-01'), topic: 'older-topic' });
  const newer = makeDoc({ user_id: 'u1', entity: 'alice', cid: 'cid-newer', captured_at: new Date('2026-04-01'), topic: 'newer-topic' });
  installMockStore([older, newer], {
    [older._id]: { cid: 'cid-older', plaintext: 'old content' },
    [newer._id]: { cid: 'cid-newer', plaintext: 'new content' },
  });
  const result = await KoadHarnessMemoryContextLoader.load({
    userId: 'u1', entity: 'alice', kek: makeMockKek(),
    profileQuality: 'full', bondActive: true,
  });
  const newerPos = result.indexOf('newer-topic');
  const olderPos = result.indexOf('older-topic');
  test.isTrue(newerPos < olderPos, 'newer memory appears first');
  clearMockStore();
});
