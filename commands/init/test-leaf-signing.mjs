#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// test-leaf-signing.mjs — synthetic test for migrate-entity leaf-signing refactor
//
// Tests:
//   1. verify-leaf command: decrypts sovereign leaf, returns fingerprint
//   2. sign-entity-entries command: signs genesis + leaf-authorize with leaf KM
//   3. authorized_by in entries records leaf fingerprint (not master)
//   4. skip-genesis path: only leaf-authorize signed
//
// Does NOT touch disk beyond reading sovereign leaf (which already exists).
// Uses the real sovereign leaf at ~/.koad-io/me/id/devices/<hostname>/

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import { readFileSync } from 'fs';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const KOAD_IO_ROOT = path.resolve(__dirname, '..', '..');
const CEREMONY_PATH = path.join(KOAD_IO_ROOT, 'modules', 'node', 'ceremony.js');
const SIGCHAIN_PATH = path.join(KOAD_IO_ROOT, 'modules', 'node', 'sigchain.js');

const {
  buildLeafKeyManager,
  decryptLeafFromStorage,
  encryptLeafForStorage,
  extractKMInfo,
  generateDeviceKey,
} = await import(CEREMONY_PATH);

const {
  buildEntityGenesis,
  buildEntityLeafAuthorize,
  wrapEntry,
  signEntry,
  computeCID,
} = await import(SIGCHAIN_PATH);

const { clearsign } = await import(path.join(KOAD_IO_ROOT, 'modules', 'node', 'pgp.js'));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    console.log(`  PASS: ${msg}`);
    passed++;
  } else {
    console.error(`  FAIL: ${msg}`);
    failed++;
  }
}

function assertEq(a, b, msg) {
  if (a === b) {
    console.log(`  PASS: ${msg}`);
    passed++;
  } else {
    console.error(`  FAIL: ${msg} — got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// Setup: generate a mock sovereign leaf for testing
// (We use a freshly-generated leaf + device key to avoid reading real secrets)
// ---------------------------------------------------------------------------

console.log('\n[test] Setting up mock sovereign leaf...');
const mockSovereignKM = await buildLeafKeyManager('sovereign @ test.koad.sh');
const { fingerprint: mockSovereignLeafFpr, publicKey: mockSovereignLeafPub } = await extractKMInfo(mockSovereignKM);
const mockDeviceKey = generateDeviceKey();
const mockEncryptedLeaf = await encryptLeafForStorage(mockSovereignKM, mockDeviceKey);
console.log(`  mock sovereign leaf fingerprint: ${mockSovereignLeafFpr.slice(-16)}`);

// Write mock leaf to a temp file for testing the file-based path
import { writeFileSync, mkdtempSync, rmSync } from 'fs';
const tmpDir = mkdtempSync('/tmp/koad-test-leaf-');
const mockLeafPath = path.join(tmpDir, 'leaf.private.asc');
const mockDeviceKeyPath = path.join(tmpDir, 'device.key');
writeFileSync(mockLeafPath, mockEncryptedLeaf, 'utf8');
writeFileSync(mockDeviceKeyPath, mockDeviceKey, 'utf8');

// ---------------------------------------------------------------------------
// Test 1: verify-leaf — decrypts leaf, returns fingerprint
// ---------------------------------------------------------------------------

console.log('\n[test 1] verify-leaf: read + decrypt from file paths');
try {
  const armor = readFileSync(mockLeafPath, 'utf8');
  const passphrase = readFileSync(mockDeviceKeyPath, 'utf8').trim();
  const km = await decryptLeafFromStorage(armor, passphrase);
  const { fingerprint } = await extractKMInfo(km);
  assertEq(fingerprint, mockSovereignLeafFpr, 'decrypted fingerprint matches original');
  assert(fingerprint.length === 40, 'fingerprint is 40-char hex');
} catch (err) {
  console.error(`  FAIL: verify-leaf threw: ${err.message}`);
  failed++;
}

// ---------------------------------------------------------------------------
// Test 2: sign-entity-entries — full genesis + leaf-authorize path
// ---------------------------------------------------------------------------

console.log('\n[test 2] sign-entity-entries: genesis + leaf-authorize, signed by sovereign leaf');
try {
  // Read and decrypt sovereign leaf from file (mirrors command.sh flow)
  const armoredEncrypted = readFileSync(mockLeafPath, 'utf8');
  const passphrase = readFileSync(mockDeviceKeyPath, 'utf8').trim();
  const sovereignLeafKM = await decryptLeafFromStorage(armoredEncrypted, passphrase);

  const sovereignIdentity = {
    sign: async (payload, _opts = {}) => clearsign(payload, sovereignLeafKM),
  };

  // Generate a mock entity keypair
  const entityKM = await buildLeafKeyManager('vulcan @ test.koad.sh');
  const { fingerprint: entityFpr } = await extractKMInfo(entityKM);
  const entityLeafKM = await buildLeafKeyManager('vulcan @ test.koad.sh (device)');
  const { fingerprint: entityLeafFpr } = await extractKMInfo(entityLeafKM);

  const now = new Date().toISOString();
  const host = 'wonderland';

  // Sign genesis
  const genesisPayload = buildEntityGenesis({
    entity_handle: 'vulcan',
    entity_key_fingerprint: entityFpr,
    sovereign_key_fingerprint: mockSovereignLeafFpr,  // leaf FPR, not master
    gestated_at: now,
    gestation_host: host,
  });

  const genesisUnsigned = wrapEntry({
    entity: 'koad',
    timestamp: now,
    type: genesisPayload.type,
    payload: genesisPayload.payload,
    previous: null,
  });

  const { entry: genesisEntry, cid: genesisCid } = await signEntry(genesisUnsigned, sovereignIdentity);

  assert(genesisEntry.signature.includes('BEGIN PGP SIGNED MESSAGE'), 'genesis has PGP signature');
  assert(genesisCid.startsWith('b'), 'genesis CID starts with b (base32)');
  assertEq(genesisEntry.payload.sovereign_key_fingerprint, mockSovereignLeafFpr, 'genesis.sovereign_key_fingerprint = leaf fpr');

  // Sign leaf-authorize
  const leafPayload = buildEntityLeafAuthorize({
    entity_handle: 'vulcan',
    leaf_fingerprint: entityLeafFpr,
    host,
    authorized_at: now,
    authorized_by: mockSovereignLeafFpr,  // leaf FPR, not master
  });

  const leafUnsigned = wrapEntry({
    entity: 'koad',
    timestamp: now,
    type: leafPayload.type,
    payload: leafPayload.payload,
    previous: genesisCid,
  });

  const { entry: leafEntry, cid: leafCid } = await signEntry(leafUnsigned, sovereignIdentity);

  assert(leafEntry.signature.includes('BEGIN PGP SIGNED MESSAGE'), 'leaf-authorize has PGP signature');
  assertEq(leafEntry.payload.authorized_by, mockSovereignLeafFpr, 'leaf-authorize.authorized_by = leaf fpr');
  assertEq(leafEntry.previous, genesisCid, 'leaf-authorize.previous = genesis CID');

  // Verify CID is recomputable
  const recomputedGenesisCid = await computeCID(genesisEntry);
  assertEq(recomputedGenesisCid, genesisCid, 'genesis CID is stable (recomputed matches)');

} catch (err) {
  console.error(`  FAIL: sign-entity-entries threw: ${err.message}`);
  console.error(err.stack);
  failed++;
}

// ---------------------------------------------------------------------------
// Test 3: skip-genesis path (secondary device adoption)
// ---------------------------------------------------------------------------

console.log('\n[test 3] skip-genesis: only leaf-authorize signed');
try {
  const armoredEncrypted = readFileSync(mockLeafPath, 'utf8');
  const passphrase = readFileSync(mockDeviceKeyPath, 'utf8').trim();
  const sovereignLeafKM = await decryptLeafFromStorage(armoredEncrypted, passphrase);
  const sovereignIdentity = {
    sign: async (payload, _opts = {}) => clearsign(payload, sovereignLeafKM),
  };

  const entityLeafKM = await buildLeafKeyManager('vulcan @ test.koad.sh (device2)');
  const { fingerprint: entityLeafFpr } = await extractKMInfo(entityLeafKM);

  const now = new Date().toISOString();
  const priorHead = 'baguqeerasomefakecid123456789';

  const leafPayload = buildEntityLeafAuthorize({
    entity_handle: 'vulcan',
    leaf_fingerprint: entityLeafFpr,
    host: 'thinker',
    authorized_at: now,
    authorized_by: mockSovereignLeafFpr,
  });

  const leafUnsigned = wrapEntry({
    entity: 'koad',
    timestamp: now,
    type: leafPayload.type,
    payload: leafPayload.payload,
    previous: priorHead,
  });

  const { entry: leafEntry, cid: leafCid } = await signEntry(leafUnsigned, sovereignIdentity);

  assert(leafEntry.signature.includes('BEGIN PGP SIGNED MESSAGE'), 'secondary device leaf-authorize has PGP signature');
  assertEq(leafEntry.previous, priorHead, 'previous chains to existing head');
  assertEq(leafEntry.payload.authorized_by, mockSovereignLeafFpr, 'authorized_by = sovereign leaf fpr (not master)');

} catch (err) {
  console.error(`  FAIL: skip-genesis threw: ${err.message}`);
  console.error(err.stack);
  failed++;
}

// ---------------------------------------------------------------------------
// Test 4: wrong passphrase → decryptLeafFromStorage throws
// ---------------------------------------------------------------------------

console.log('\n[test 4] wrong passphrase → decryptLeafFromStorage throws');
try {
  const armor = readFileSync(mockLeafPath, 'utf8');
  const wrongPassphrase = generateDeviceKey();  // different random key
  try {
    await decryptLeafFromStorage(armor, wrongPassphrase);
    console.error('  FAIL: should have thrown on wrong passphrase');
    failed++;
  } catch (err) {
    assert(err.message.includes('unlock_pgp failed'), 'throws with unlock_pgp error on wrong passphrase');
  }
} catch (err) {
  console.error(`  FAIL: test 4 setup threw: ${err.message}`);
  failed++;
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

rmSync(tmpDir, { recursive: true });

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n[test results] ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log('[test] All assertions passed.');
}
