// test-auth.js — Unit tests for auth.js (ESM)
//
// Tests:
//   1. challenge() returns hex nonce + future expiry
//   2. challenge() nonces are unique (no collisions over 100 calls)
//   3. respond() returns matching nonce + non-empty base64url signature
//   4. verify() succeeds for valid nonce+signature+pubkey
//   5. verify() rejects consumed (already-used) nonce
//   6. verify() rejects unknown nonce
//   7. verify() rejects invalid signature
//   8. verify() rejects wrong public key
//   9. pendingNonceCount() reflects live nonces
//
// Run: node test-auth.js

import { challenge, respond, verify, pendingNonceCount } from './auth.js';
import * as ed from '@noble/ed25519';

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  PASS: ${label}`);
    passed++;
  } else {
    console.error(`  FAIL: ${label}`);
    failed++;
  }
}

async function assertAsync(fn, label) {
  try {
    const result = await fn();
    if (result) {
      console.log(`  PASS: ${label}`);
      passed++;
    } else {
      console.error(`  FAIL: ${label} (returned falsy)`);
      failed++;
    }
  } catch (e) {
    console.error(`  FAIL: ${label} (threw: ${e.message})`);
    failed++;
  }
}

// Generate an Ed25519 key pair for testing
const seed = ed.utils.randomPrivateKey();
const pubKey = await ed.getPublicKeyAsync(seed);

function toBase64Url(bytes) {
  return Buffer.from(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

const pubKeyB64 = toBase64Url(pubKey);

console.log('\nauth.js unit tests\n');

// ── Test 1: challenge() structure ─────────────────────────────────────────────
{
  console.log('1. challenge() returns valid nonce + expiry');
  const { nonce, expires } = challenge();
  assert(typeof nonce === 'string' && nonce.length === 64, 'nonce is 64-char hex string');
  assert(typeof expires === 'number' && expires > Date.now(), 'expires is future timestamp');
}

// ── Test 2: nonces are unique ─────────────────────────────────────────────────
{
  console.log('\n2. challenge() nonces are unique over 100 calls');
  const nonces = new Set();
  for (let i = 0; i < 100; i++) {
    nonces.add(challenge().nonce);
  }
  assert(nonces.size === 100, '100 unique nonces generated');
}

// ── Test 3: respond() structure ───────────────────────────────────────────────
{
  console.log('\n3. respond() returns nonce + signature');
  const { nonce } = challenge();
  const response = await respond(nonce, seed);
  assert(response.nonce === nonce, 'response.nonce matches challenge nonce');
  assert(typeof response.signature === 'string' && response.signature.length > 0, 'signature is non-empty string');
  // base64url: no +, /, = chars
  assert(!/[+/=]/.test(response.signature), 'signature is base64url (no +/=)');
}

// ── Test 4: verify() succeeds for valid round-trip ────────────────────────────
{
  console.log('\n4. verify() succeeds for valid challenge-respond-verify');
  const { nonce } = challenge();
  const { signature } = await respond(nonce, seed);
  const result = await verify(nonce, signature, pubKeyB64);
  assert(result.valid === true, 'verify returns valid=true');
  assert(result.error === null, 'verify returns error=null');
}

// ── Test 5: nonce is consumed after verify ────────────────────────────────────
{
  console.log('\n5. verify() rejects replay (nonce consumed after use)');
  const { nonce } = challenge();
  const { signature } = await respond(nonce, seed);
  await verify(nonce, signature, pubKeyB64); // consume it
  const replay = await verify(nonce, signature, pubKeyB64);
  assert(replay.valid === false, 'replay returns valid=false');
  assert(typeof replay.error === 'string', 'replay returns error string');
}

// ── Test 6: unknown nonce ─────────────────────────────────────────────────────
{
  console.log('\n6. verify() rejects unknown nonce');
  const fakeNonce = 'deadbeef'.repeat(8); // 64-char hex
  const { signature } = await respond(fakeNonce, seed);
  const result = await verify(fakeNonce, signature, pubKeyB64);
  assert(result.valid === false, 'unknown nonce returns valid=false');
  assert(result.error.includes('nonce not found'), 'error mentions nonce not found');
}

// ── Test 7: invalid signature ─────────────────────────────────────────────────
{
  console.log('\n7. verify() rejects invalid signature');
  const { nonce } = challenge();
  // Build a bad signature (correct length but wrong bytes)
  const badSig = toBase64Url(new Uint8Array(64).fill(0xab));
  const result = await verify(nonce, badSig, pubKeyB64);
  assert(result.valid === false, 'bad signature returns valid=false');
  assert(typeof result.error === 'string', 'error is a string');
}

// ── Test 8: wrong public key ──────────────────────────────────────────────────
{
  console.log('\n8. verify() rejects signature checked against wrong key');
  const { nonce } = challenge();
  const { signature } = await respond(nonce, seed);
  // Generate a different key pair
  const otherSeed = ed.utils.randomPrivateKey();
  const otherPub = await ed.getPublicKeyAsync(otherSeed);
  const otherPubB64 = toBase64Url(otherPub);
  const result = await verify(nonce, signature, otherPubB64);
  assert(result.valid === false, 'wrong key returns valid=false');
}

// ── Test 9: pendingNonceCount reflects nonces ─────────────────────────────────
{
  console.log('\n9. pendingNonceCount() reflects live nonce count');
  const before = pendingNonceCount();
  challenge();
  challenge();
  const after = pendingNonceCount();
  assert(after >= before + 2, `count increased by at least 2 (was ${before}, now ${after})`);
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} assertions: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
