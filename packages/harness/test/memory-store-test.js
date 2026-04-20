// VESTA-SPEC-134 Phase 2 — Tinytest suite for MemoryStore
// Full integration tests run via Node: test/phase2-memory-store-node-test.js
// This file provides Tinytest stubs that reference the global KoadMemoryStore
// (available in server context after memory-store.js loads).
//
// Note: Full async round-trip tests require Mongo (not available in Tinytest sandbox).
// The structural tests here verify the module loaded correctly and exports the right shape.

Tinytest.add('memory-store: MemoryStore is available as global', function (test) {
  test.isNotNull(globalThis.KoadMemoryStore, 'KoadMemoryStore should be defined');
  test.equal(typeof globalThis.KoadMemoryStore.write, 'function');
  test.equal(typeof globalThis.KoadMemoryStore.read, 'function');
  test.equal(typeof globalThis.KoadMemoryStore.readAll, 'function');
});

Tinytest.add('memory-store: MockIPFS is available as global', function (test) {
  test.isNotNull(globalThis.KoadMemoryStoreIPFS, 'KoadMemoryStoreIPFS should be defined');
  test.equal(typeof globalThis.KoadMemoryStoreIPFS.write, 'function');
  test.equal(typeof globalThis.KoadMemoryStoreIPFS.read, 'function');
});

Tinytest.add('memory-store: UserMemoriesCollection is available as global', function (test) {
  test.isNotNull(globalThis.UserMemoriesCollection, 'UserMemoriesCollection should be defined');
});

Tinytest.add('memory-store: MockIPFSBlobsCollection is available as global', function (test) {
  test.isNotNull(globalThis.MockIPFSBlobsCollection, 'MockIPFSBlobsCollection should be defined');
});

Tinytest.addAsync('memory-store: write rejects missing kek', async function (test) {
  let threw = false;
  try {
    await globalThis.KoadMemoryStore.write('test', {}, null);
  } catch (_) { threw = true; }
  test.isTrue(threw, 'write with null kek should throw');
});

Tinytest.addAsync('memory-store: read rejects missing cid', async function (test) {
  const kek = await crypto.subtle.generateKey({ name: 'AES-KW', length: 256 }, false, ['wrapKey', 'unwrapKey']);
  let threw = false;
  try {
    await globalThis.KoadMemoryStore.read(null, 'wrapped', kek);
  } catch (_) { threw = true; }
  test.isTrue(threw, 'read with null cid should throw');
});
