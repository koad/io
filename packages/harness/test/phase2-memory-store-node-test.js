#!/usr/bin/env node
// Phase 2 tests — MemoryStore + MockIPFS (VESTA-SPEC-134 §4.2, §4.3, §6.4)
// Run: node test/phase2-memory-store-node-test.js
//
// The MemoryStore runs server-side (Node). We test it directly by:
// 1. Stubbing globalThis.UserMemoriesCollection (Mongo is not running)
// 2. Stubbing globalThis.KoadMemoryStoreIPFS with an in-memory Map
// 3. Running the full write/read pipeline with real Web Crypto

'use strict';

const nodeCrypto = require('crypto');
if (typeof globalThis.crypto === 'undefined') {
  globalThis.crypto = nodeCrypto.webcrypto;
}
if (typeof globalThis.btoa === 'undefined') {
  globalThis.btoa = (str) => Buffer.from(str, 'binary').toString('base64');
  globalThis.atob = (str) => Buffer.from(str, 'base64').toString('binary');
}

// ── Stubs ─────────────────────────────────────────────────────────────────────

// In-memory MockIPFS stub
const ipfsStore = new Map();
globalThis.KoadMemoryStoreIPFS = {
  async write(paddedBytes) {
    const hash = nodeCrypto.createHash('sha256').update(Buffer.from(paddedBytes)).digest('hex');
    const cid  = `mock-sha2-256-${hash}`;
    if (!ipfsStore.has(cid)) ipfsStore.set(cid, paddedBytes);
    return cid;
  },
  async read(cid) {
    if (!ipfsStore.has(cid)) throw new Error(`mockIPFSRead: CID not found: ${cid}`);
    return ipfsStore.get(cid);
  },
};

// In-memory UserMemories stub
const userMemoriesStore = [];
globalThis.UserMemoriesCollection = {
  find(query) {
    const { user_id, entity } = query;
    const results = userMemoriesStore.filter(doc =>
      doc.user_id === user_id &&
      doc.entity === entity &&
      doc.superseded_at === null &&
      doc.forgotten_at === null
    );
    return { async fetchAsync() { return results; } };
  },
  async insertAsync(doc) {
    const _id = `mem_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    userMemoriesStore.push({ ...doc, _id });
    return _id;
  },
};

// Load MemoryStore server code
// Since it uses ES module 'import' syntax, we replicate its logic inline for Node testing.
// This mirrors the established Vulcan pattern (assessment 2026-04-19, juno#88).

// Inline MemoryStore logic (same as memory-store.js but without Meteor/import)
const SIZE_BUCKETS = [
  { max: 3   * 1024, padded: 4   * 1024 },
  { max: 15  * 1024, padded: 16  * 1024 },
  { max: 63  * 1024, padded: 64  * 1024 },
  { max: 255 * 1024, padded: 256 * 1024 },
];

function padToSizeBucket(bytes) {
  const bucket = SIZE_BUCKETS.find(b => b.max >= bytes.length);
  if (!bucket) throw new Error(`blob too large: ${bytes.length}`);
  if (bytes.length === bucket.padded) return bytes;
  const padded = new Uint8Array(bucket.padded);
  padded.set(bytes);
  return padded;
}

async function serverGenerateDEK() {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

async function serverEncryptBlob(plaintext, dek) {
  const plaintextBytes = typeof plaintext === 'string' ? new TextEncoder().encode(plaintext) : plaintext;
  const cleartext = new Uint8Array(4 + plaintextBytes.length);
  new DataView(cleartext.buffer).setUint32(0, plaintextBytes.length, false);
  cleartext.set(plaintextBytes, 4);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, dek, cleartext);
  const aesOut = new Uint8Array(encrypted);
  const unpadded = new Uint8Array(4 + 12 + aesOut.length);
  new DataView(unpadded.buffer).setUint32(0, aesOut.length, false);
  unpadded.set(iv, 4);
  unpadded.set(aesOut, 4 + 12);
  return { ciphertextRaw: unpadded, iv };
}

async function serverDecryptBlob(ciphertext, dek) {
  const blobView     = new DataView(ciphertext.buffer, ciphertext.byteOffset, ciphertext.byteLength);
  const actualEncLen = blobView.getUint32(0, false);
  const iv           = ciphertext.slice(4, 16);
  const aesGcmData   = ciphertext.slice(16, 16 + actualEncLen);
  const decrypted    = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, dek, aesGcmData);
  const decArr       = new Uint8Array(decrypted);
  const realLength   = new DataView(decArr.buffer, decArr.byteOffset, decArr.byteLength).getUint32(0, false);
  return decArr.slice(4, 4 + realLength);
}

async function serverWrapDEK(dek, kek) {
  const wrapped = await crypto.subtle.wrapKey('raw', dek, kek, { name: 'AES-KW' });
  const b64 = Buffer.from(new Uint8Array(wrapped)).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function serverUnwrapDEK(wrapped_b64u, kek) {
  const b64    = wrapped_b64u.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - b64.length % 4) % 4);
  const wrapped = new Uint8Array(Buffer.from(padded, 'base64'));
  try {
    return await crypto.subtle.unwrapKey('raw', wrapped, kek, { name: 'AES-KW' }, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  } catch (err) {
    const e = new Error('KEY_ROTATION_REQUIRED: DEK unwrap failed');
    e.code  = 'KEY_ROTATION_REQUIRED';
    throw e;
  }
}

const MemoryStore = {
  async write(plaintext, metadata, kek) {
    const dek = await serverGenerateDEK();
    const { ciphertextRaw } = await serverEncryptBlob(plaintext, dek);
    const paddedCiphertext  = padToSizeBucket(ciphertextRaw);
    const cid               = await globalThis.KoadMemoryStoreIPFS.write(paddedCiphertext);
    const wrapped_dek       = await serverWrapDEK(dek, kek);
    return { cid, wrapped_dek, blob_size: paddedCiphertext.length };
  },
  async read(cid, wrapped_dek, kek) {
    let dek;
    try {
      dek = await serverUnwrapDEK(wrapped_dek, kek);
    } catch (err) {
      if (err.code === 'KEY_ROTATION_REQUIRED') throw err;
      const e = new Error('KEY_ROTATION_REQUIRED'); e.code = 'KEY_ROTATION_REQUIRED'; throw e;
    }
    const paddedCiphertext = await globalThis.KoadMemoryStoreIPFS.read(cid);
    return serverDecryptBlob(paddedCiphertext, dek);
  },
  async readAll(user_id, entity, kek) {
    const docs = await globalThis.UserMemoriesCollection.find({ user_id, entity, superseded_at: null, forgotten_at: null }).fetchAsync();
    const results = [];
    for (const doc of docs) {
      try {
        const plaintextBytes = await this.read(doc.cid, doc.wrapped_dek, kek);
        results.push({ _id: doc._id, plaintext: new TextDecoder().decode(plaintextBytes), doc });
      } catch (err) {
        if (err.code === 'KEY_ROTATION_REQUIRED') {
          results.push({ _id: doc._id, key_rotation_required: true, doc });
        } else { throw err; }
      }
    }
    return results;
  },
};

// ── Test helpers ──────────────────────────────────────────────────────────────

let passed = 0; let failed = 0;

function assert(label, cond, detail) {
  if (cond) { process.stdout.write(`  PASS  ${label}\n`); passed++; }
  else { process.stderr.write(`  FAIL  ${label}${detail ? ': ' + detail : ''}\n`); failed++; }
}

async function makeKEK() {
  return crypto.subtle.generateKey({ name: 'AES-KW', length: 256 }, false, ['wrapKey', 'unwrapKey']);
}

async function insertMemory(kek, plaintext, user_id, entity) {
  const { cid, wrapped_dek, blob_size } = await MemoryStore.write(plaintext, {}, kek);
  const _id = await globalThis.UserMemoriesCollection.insertAsync({
    spec: 'VESTA-SPEC-134',
    user_id, entity, cid,
    captured_at:   new Date(),
    captured_from: 'other',
    wrapped_dek,
    blob_size,
    surface:       'memory',
    topic:         null,
    visibility:    'private',
    supersedes:    null,
    superseded_at: null,
    forgotten_at:  null,
    key_version:   1,
  });
  return _id;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

async function run() {
  console.log('\nPhase 2: MemoryStore write/read round-trip');

  // Test 1: single write/read round-trip
  {
    const kek  = await makeKEK();
    const text = 'Alice learned that persistence is the most important skill.';
    const { cid, wrapped_dek, blob_size } = await MemoryStore.write(text, {}, kek);

    assert('write returns cid', typeof cid === 'string' && cid.startsWith('mock-'));
    assert('write returns wrapped_dek (base64url string)', typeof wrapped_dek === 'string' && wrapped_dek.length > 0);
    assert('write returns blob_size (padded to bucket)', blob_size === 4 * 1024);

    const plaintextBytes = await MemoryStore.read(cid, wrapped_dek, kek);
    const result         = new TextDecoder().decode(plaintextBytes);
    assert('single read recovers exact plaintext', result === text, result);
  }

  // Test 2: 10 memories write/read round-trip
  {
    const kek      = await makeKEK();
    const memories = Array.from({ length: 10 }, (_, i) => `Memory number ${i + 1}: unique content here`);
    const written  = [];

    for (const mem of memories) {
      const { cid, wrapped_dek, blob_size } = await MemoryStore.write(mem, {}, kek);
      written.push({ cid, wrapped_dek, blob_size, original: mem });
    }

    let allMatch = true;
    for (const { cid, wrapped_dek, original } of written) {
      const bytes   = await MemoryStore.read(cid, wrapped_dek, kek);
      const result  = new TextDecoder().decode(bytes);
      if (result !== original) { allMatch = false; break; }
    }
    assert('10 memory write/read round-trip: all match', allMatch);
  }

  // Test 3: identical plaintexts produce different CIDs (validates IV randomness)
  {
    const kek  = await makeKEK();
    const text = 'Same memory content repeated exactly.';
    const { cid: cid1 } = await MemoryStore.write(text, {}, kek);
    const { cid: cid2 } = await MemoryStore.write(text, {}, kek);
    assert('identical plaintexts → different CIDs (IV randomness)', cid1 !== cid2,
      `both: ${cid1}`);
  }

  // Test 4: stale key_version → KEY_ROTATION_REQUIRED distinguishable error
  {
    const kek1 = await makeKEK();
    const kek2 = await makeKEK(); // different key — simulates stale KEK
    const { cid, wrapped_dek } = await MemoryStore.write('test memory', {}, kek1);

    let threw              = false;
    let isKeyRotationRequired = false;
    try {
      await MemoryStore.read(cid, wrapped_dek, kek2);
    } catch (err) {
      threw = true;
      isKeyRotationRequired = err.code === 'KEY_ROTATION_REQUIRED';
    }
    assert('stale KEK throws', threw);
    assert('stale KEK error is KEY_ROTATION_REQUIRED (distinguishable)', isKeyRotationRequired);
  }

  // Test 5: readAll returns all active memories, skips stale-key ones gracefully
  {
    const user_id = 'test_user_readall';
    const entity  = 'alice';
    const kek     = await makeKEK();
    const texts   = ['Memory A for readAll', 'Memory B for readAll', 'Memory C for readAll'];

    for (const text of texts) {
      await insertMemory(kek, text, user_id, entity);
    }

    const results = await MemoryStore.readAll(user_id, entity, kek);
    assert('readAll returns 3 memories', results.length === 3, `got ${results.length}`);
    const allMatch = texts.every(t => results.some(r => r.plaintext === t));
    assert('readAll plaintext matches all inserted', allMatch);
  }

  // Test 6: readAll with stale KEK marks key_rotation_required (not silent fail)
  {
    const user_id = 'test_user_stale';
    const entity  = 'alice';
    const kek1    = await makeKEK();
    const kek2    = await makeKEK(); // stale

    await insertMemory(kek1, 'Memory encrypted with kek1', user_id, entity);

    const results = await MemoryStore.readAll(user_id, entity, kek2);
    assert('readAll with stale KEK returns 1 result', results.length === 1, `got ${results.length}`);
    assert('stale KEK result has key_rotation_required flag', results[0].key_rotation_required === true);
  }

  // Test 7: blob_size is always a padded bucket size
  {
    const kek   = await makeKEK();
    const VALID = [4 * 1024, 16 * 1024, 64 * 1024, 256 * 1024];
    for (const [len, label] of [[10, '10B'], [500, '500B'], [5000, '5KB']]) {
      const { blob_size } = await MemoryStore.write('x'.repeat(len), {}, kek);
      assert(`blob_size for ${label} is a valid bucket`, VALID.includes(blob_size),
        `got ${blob_size}`);
    }
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch(err => { console.error('FATAL:', err); process.exit(1); });
