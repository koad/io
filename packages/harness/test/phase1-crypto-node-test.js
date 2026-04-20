#!/usr/bin/env node
// Phase 1 tests — client-side crypto primitives (VESTA-SPEC-134 §5.2, §5.3, §6.2)
// Run: node test/phase1-crypto-node-test.js
//
// Uses Node 19+ globalThis.crypto (Web Crypto API compatible with browsers).
// argon2fn is stubbed with a fast deterministic pseudo-implementation for testing
// (NOT Argon2id — only used to verify derivation pipeline; Argon2 params are
//  checked structurally, not cryptographically).

'use strict';

// Polyfill Web Crypto for Node
const nodeCrypto = require('crypto');
if (typeof globalThis.crypto === 'undefined') {
  globalThis.crypto = nodeCrypto.webcrypto;
}

// Buffer polyfill for btoa/atob in Node
if (typeof globalThis.btoa === 'undefined') {
  globalThis.btoa = (str) => Buffer.from(str, 'binary').toString('base64');
  globalThis.atob = (str) => Buffer.from(str, 'base64').toString('binary');
}

// Load the modules
const blobCrypto = require('./blob-crypto-export.js');

let passed = 0;
let failed = 0;

function assert(label, cond, detail) {
  if (cond) { process.stdout.write(`  PASS  ${label}\n`); passed++; }
  else { process.stderr.write(`  FAIL  ${label}${detail ? ': ' + detail : ''}\n`); failed++; }
}

function assertEqual(label, a, b) {
  assert(label, a === b, `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

async function run() {
  const {
    generateDEK, encryptBlob, decryptBlob,
    wrapDEK, unwrapDEK,
    padToSizeBucket, SIZE_BUCKETS,
    base64urlEncode, base64urlDecode,
  } = blobCrypto;

  const { deriveKEK, deriveKEKPathA, deriveKEKPathB } = require('./kek-derive-export.js');

  // ── Argon2 stub for testing ────────────────────────────────────────────────
  // Records parameter calls to verify SPEC-134 §6.2 params are passed correctly.
  let lastArgon2Params = null;
  async function argon2Stub(passphrase, salt, t, m, p, len) {
    lastArgon2Params = { passphrase, salt, t, m, p, len };
    // Deterministic output: HKDF-expand of passphrase+salt (NOT real Argon2id)
    const enc    = new TextEncoder();
    const key    = await crypto.subtle.importKey('raw', enc.encode(passphrase), { name: 'HKDF' }, false, ['deriveKey']);
    const raw    = await crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: salt, info: enc.encode('argon2-stub') },
      key,
      { name: 'AES-GCM', length: 256 },
      true, ['encrypt', 'decrypt']
    );
    const exported = await crypto.subtle.exportKey('raw', raw);
    return new Uint8Array(exported);
  }

  console.log('\nPhase 1: Blob encryption / decryption');

  // Test: round-trip encrypt/decrypt
  {
    const dek = await generateDEK();
    const plaintext = 'Alice has completed Level 3. Belt: purple.';
    const { ciphertext } = await encryptBlob(plaintext, dek);
    const decrypted = await decryptBlob(ciphertext, dek);
    const result = new TextDecoder().decode(decrypted);
    assert('encrypt/decrypt round-trip preserves plaintext', result === plaintext, result);
  }

  // Test: encrypt returns padded ciphertext
  {
    const dek = await generateDEK();
    const { ciphertext } = await encryptBlob('hello', dek);
    assert('100-byte plaintext pads to 4KB', ciphertext.length === 4 * 1024);
  }

  // Test: 10KB plaintext pads to 16KB
  {
    const dek = await generateDEK();
    const tenKB = 'x'.repeat(10 * 1024);
    const { ciphertext } = await encryptBlob(tenKB, dek);
    assert('10KB plaintext pads to 16KB', ciphertext.length === 16 * 1024, `got ${ciphertext.length}`);
  }

  // Test: 100 sequential encrypts produce 100 distinct IVs
  {
    const dek = await generateDEK();
    const ivs = new Set();
    for (let i = 0; i < 100; i++) {
      const { iv } = await encryptBlob('test', dek);
      ivs.add(base64urlEncode(iv));
    }
    assert('100 sequential encrypts produce 100 distinct IVs', ivs.size === 100, `got ${ivs.size} distinct`);
  }

  // Test: identical plaintexts produce different CIDs (validates IV randomness)
  {
    const dek = await generateDEK();
    const { ciphertext: c1 } = await encryptBlob('same content', dek);
    const { ciphertext: c2 } = await encryptBlob('same content', dek);
    // CID is SHA-256 of ciphertext — different IVs → different ciphertext → different CIDs
    const hash1 = nodeCrypto.createHash('sha256').update(c1).digest('hex');
    const hash2 = nodeCrypto.createHash('sha256').update(c2).digest('hex');
    assert('identical plaintexts produce different CIDs (random IV)', hash1 !== hash2,
      `both hashed to ${hash1}`);
  }

  // Test: padding buckets — per SPEC-134 §5.3
  // Table: up to 3KB → 4KB, up to 15KB → 16KB, up to 63KB → 64KB, up to 255KB → 256KB
  {
    const KB = 1024;
    const tests = [
      { bytes: 100,       expected: 4 * KB,   label: '100B → 4KB' },
      { bytes: 3 * KB,    expected: 4 * KB,   label: '3KB → 4KB (at boundary)' },
      { bytes: 3 * KB + 1, expected: 16 * KB, label: '3KB+1 → 16KB (over boundary)' },
      { bytes: 10 * KB,   expected: 16 * KB,  label: '10KB → 16KB' },
      { bytes: 15 * KB,   expected: 16 * KB,  label: '15KB → 16KB (at boundary)' },
      { bytes: 60 * KB,   expected: 64 * KB,  label: '60KB → 64KB' },
      { bytes: 200 * KB,  expected: 256 * KB, label: '200KB → 256KB' },
    ];
    for (const { bytes, expected, label } of tests) {
      const input  = new Uint8Array(bytes);
      const padded = padToSizeBucket(input);
      assert(label, padded.length === expected, `got ${padded.length}`);
    }
  }

  console.log('\nPhase 1: DEK wrap / unwrap');

  // Test: wrapDEK / unwrapDEK round-trip
  {
    const dek  = await generateDEK();
    const kek  = await crypto.subtle.generateKey({ name: 'AES-KW', length: 256 }, false, ['wrapKey', 'unwrapKey']);
    const wrapped = await wrapDEK(dek, kek);
    assert('wrapDEK returns base64url string', typeof wrapped === 'string' && wrapped.length > 0);
    const unwrapped = await unwrapDEK(wrapped, kek);
    assert('unwrapped DEK can decrypt what original DEK encrypted', await (async () => {
      const plain = 'test message for wrap/unwrap';
      const { ciphertext } = await encryptBlob(plain, dek);
      const result = new TextDecoder().decode(await decryptBlob(ciphertext, unwrapped));
      return result === plain;
    })());
  }

  // Test: unwrapDEK with wrong KEK throws KEY_ROTATION_REQUIRED
  {
    const dek      = await generateDEK();
    const kek1     = await crypto.subtle.generateKey({ name: 'AES-KW', length: 256 }, false, ['wrapKey', 'unwrapKey']);
    const kek2     = await crypto.subtle.generateKey({ name: 'AES-KW', length: 256 }, false, ['wrapKey', 'unwrapKey']);
    const wrapped  = await wrapDEK(dek, kek1);
    let threw      = false;
    let isKeyRotationRequired = false;
    try {
      await unwrapDEK(wrapped, kek2);
    } catch (err) {
      threw = true;
      isKeyRotationRequired = err.message.includes('KEY_ROTATION_REQUIRED');
    }
    assert('wrong KEK throws', threw);
    assert('wrong KEK throws KEY_ROTATION_REQUIRED error', isKeyRotationRequired);
  }

  console.log('\nPhase 1: KEK derivation — Path B (argon2 stub)');

  // Test: deterministic re-derivation (same passphrase + salt → same KEK)
  // Since KEK is non-extractable, we verify indirectly: wrap a DEK with KEK1,
  // derive KEK2 from same inputs, unwrap with KEK2 → should succeed.
  {
    const salt       = crypto.getRandomValues(new Uint8Array(32));
    const passphrase = 'test-passphrase-123';
    const kek1 = await deriveKEKPathB(passphrase, salt, argon2Stub);
    const kek2 = await deriveKEKPathB(passphrase, salt, argon2Stub);
    const dek  = await generateDEK();
    // wrapDEK requires extractable: true on KEK — but KEK from deriveKEKPathB is AES-KW
    // Test via encrypt/unwrap path
    const wrapped = await wrapDEK(dek, kek1);
    let sameKey = false;
    try {
      await unwrapDEK(wrapped, kek2);
      sameKey = true;
    } catch (_) {}
    assert('same passphrase+salt → same KEK (deterministic re-derivation)', sameKey);
  }

  // Test: Argon2 params are passed correctly (t=3, m=65536, p=4, len=32)
  {
    const salt = crypto.getRandomValues(new Uint8Array(32));
    await deriveKEKPathB('test', salt, argon2Stub);
    assert('argon2 t=3', lastArgon2Params && lastArgon2Params.t === 3);
    assert('argon2 m=65536', lastArgon2Params && lastArgon2Params.m === 65536);
    assert('argon2 p=4', lastArgon2Params && lastArgon2Params.p === 4);
    assert('argon2 len=32', lastArgon2Params && lastArgon2Params.len === 32);
  }

  // Test: different passphrases produce different KEKs
  {
    const salt  = crypto.getRandomValues(new Uint8Array(32));
    const kek1  = await deriveKEKPathB('passphrase-A', salt, argon2Stub);
    const kek2  = await deriveKEKPathB('passphrase-B', salt, argon2Stub);
    const dek   = await generateDEK();
    const wrapped = await wrapDEK(dek, kek1);
    let differentKey = false;
    try {
      await unwrapDEK(wrapped, kek2);
    } catch (_) {
      differentKey = true;
    }
    assert('different passphrases produce different KEKs', differentKey);
  }

  // Test: KEK non-extractability
  // The deriveKEKPathB uses HKDF → deriveKey with extractable=false
  // Verify exportKey throws
  {
    const salt = crypto.getRandomValues(new Uint8Array(32));
    const kek  = await deriveKEKPathB('test', salt, argon2Stub);
    let threw = false;
    try {
      await crypto.subtle.exportKey('raw', kek);
    } catch (_) {
      threw = true;
    }
    assert('KEK.exportKey() throws (non-extractable per SPEC-134 §11.1)', threw);
  }

  // Test: Path A KEK derivation
  {
    const prf_output = crypto.getRandomValues(new Uint8Array(32));
    const user_id    = 'user_test123';
    const kek1       = await deriveKEKPathA(prf_output, user_id);
    const kek2       = await deriveKEKPathA(prf_output, user_id);
    // Verify same PRF → same KEK (same round-trip as above)
    const dek    = await generateDEK();
    const wrapped = await wrapDEK(dek, kek1);
    let sameKey = false;
    try {
      await unwrapDEK(wrapped, kek2);
      sameKey = true;
    } catch (_) {}
    assert('Path A: same PRF output + user_id → same KEK', sameKey);

    // Non-extractable
    let threw = false;
    try { await crypto.subtle.exportKey('raw', kek1); } catch (_) { threw = true; }
    assert('Path A KEK is non-extractable', threw);
  }

  // Summary
  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch(err => { console.error('FATAL:', err); process.exit(1); });
