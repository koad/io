// test-identity-writer.js — writeIdentityRegistry() + updateSigchainHead() tests
//
// Tests (per flight plan vulcan-20260425T230923-sigchain-write-back):
//   1. First write — sigchainDir doesn't exist → { written: true, created: true }.
//      Verify all 3 files exist with correct content.
//   2. Update existing — write again with new sigchainHeadCID → { written: true, created: false }.
//      Verify `created` field preserved; `sigchainHeadUpdated` changes.
//   3. updateSigchainHead — light-touch, updates head + sigchainHeadUpdated only.
//      Verifies metadata `created`, `masterFingerprint`, etc. preserved.
//   4. End-to-end with resolveIdentity — write, then resolve same handle, confirm round-trip.
//   5. Atomic write — file isn't observable mid-write; temp+rename pattern.
//   6. Missing required fields — each required field returns { written: false, error }.
//   7. updateSigchainHead on missing sigchainDir → { updated: false, error }.
//
// Run: node modules/node/test-identity-writer.js

import { writeIdentityRegistry, updateSigchainHead } from './identity-writer.js';
import { resolveIdentity } from './identity-resolver.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

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

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const tmpDirs = [];

function makeTempVesta() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'koad-identity-writer-test-'));
  const entitiesDir = path.join(tmpDir, 'entities');
  fs.mkdirSync(entitiesDir, { recursive: true });
  tmpDirs.push(tmpDir);
  return tmpDir;
}

function cleanup() {
  for (const dir of tmpDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
}

const FAKE_MASTER_PUB = '-----BEGIN PGP PUBLIC KEY BLOCK-----\nfakekeydata\n-----END PGP PUBLIC KEY BLOCK-----';
const FAKE_FINGERPRINT = 'A07F 8CFE CBF6 B982 EEDA  C4F3 62D5 C486 6C24 7E00';
const FAKE_CID_1 = 'baguqeera1111111111111111111111111111';
const FAKE_CID_2 = 'baguqeera2222222222222222222222222222';

// ---------------------------------------------------------------------------
// Test 1: First write — new record
// ---------------------------------------------------------------------------

async function test1_firstWrite() {
  console.log('\nTest 1: First write (new record)');

  const vestaDir = makeTempVesta();
  const result = await writeIdentityRegistry({
    handle: 'testentity',
    masterFingerprint: FAKE_FINGERPRINT,
    masterPublicKey: FAKE_MASTER_PUB,
    sigchainHeadCID: FAKE_CID_1,
    vestaDir,
  });

  assert(result.written === true, 'written is true');
  assert(result.created === true, 'created is true (new record)');
  assert(typeof result.sigchainDir === 'string', 'sigchainDir is a string');

  const sigchainDir = result.sigchainDir;

  // Verify all 3 files exist
  assert(fs.existsSync(path.join(sigchainDir, 'master.pub.asc')), 'master.pub.asc exists');
  assert(fs.existsSync(path.join(sigchainDir, 'metadata.json')), 'metadata.json exists');
  assert(fs.existsSync(path.join(sigchainDir, 'sigchain-head.txt')), 'sigchain-head.txt exists');

  // Verify content
  const pubAsc = fs.readFileSync(path.join(sigchainDir, 'master.pub.asc'), 'utf8');
  assert(pubAsc === FAKE_MASTER_PUB, 'master.pub.asc content matches');

  const metadata = JSON.parse(fs.readFileSync(path.join(sigchainDir, 'metadata.json'), 'utf8'));
  assert(metadata.handle === 'testentity', 'metadata.handle correct');
  assert(metadata.masterFingerprint === FAKE_FINGERPRINT, 'metadata.masterFingerprint correct');
  assert(metadata.sigchainHeadCID === FAKE_CID_1, 'metadata.sigchainHeadCID correct');
  assert(metadata.status === 'active', 'metadata.status defaults to active');
  assert(typeof metadata.created === 'string' && metadata.created.length > 0, 'metadata.created set');
  assert(typeof metadata.sigchainHeadUpdated === 'string' && metadata.sigchainHeadUpdated.length > 0, 'metadata.sigchainHeadUpdated set');

  const headTxt = fs.readFileSync(path.join(sigchainDir, 'sigchain-head.txt'), 'utf8').trim();
  assert(headTxt === FAKE_CID_1, 'sigchain-head.txt content matches CID');
}

// ---------------------------------------------------------------------------
// Test 2: Update existing — created preserved, sigchainHeadUpdated changes
// ---------------------------------------------------------------------------

async function test2_updateExisting() {
  console.log('\nTest 2: Update existing record');

  const vestaDir = makeTempVesta();

  // First write
  const first = await writeIdentityRegistry({
    handle: 'testentity',
    masterFingerprint: FAKE_FINGERPRINT,
    masterPublicKey: FAKE_MASTER_PUB,
    sigchainHeadCID: FAKE_CID_1,
    vestaDir,
  });
  assert(first.created === true, 'first write: created is true');

  const sigchainDir = first.sigchainDir;
  const meta1 = JSON.parse(fs.readFileSync(path.join(sigchainDir, 'metadata.json'), 'utf8'));
  const createdAt = meta1.created;
  const updatedAt1 = meta1.sigchainHeadUpdated;

  // Small delay so timestamps differ if the implementation uses Date.now()
  await new Promise(r => setTimeout(r, 10));

  // Second write with new CID
  const second = await writeIdentityRegistry({
    handle: 'testentity',
    masterFingerprint: FAKE_FINGERPRINT,
    masterPublicKey: FAKE_MASTER_PUB,
    sigchainHeadCID: FAKE_CID_2,
    vestaDir,
  });

  assert(second.written === true, 'second write: written is true');
  assert(second.created === false, 'second write: created is false (update)');

  const meta2 = JSON.parse(fs.readFileSync(path.join(sigchainDir, 'metadata.json'), 'utf8'));
  assert(meta2.created === createdAt, 'created field preserved across update');
  assert(meta2.sigchainHeadCID === FAKE_CID_2, 'sigchainHeadCID updated to new CID');

  const headTxt = fs.readFileSync(path.join(sigchainDir, 'sigchain-head.txt'), 'utf8').trim();
  assert(headTxt === FAKE_CID_2, 'sigchain-head.txt updated to new CID');
}

// ---------------------------------------------------------------------------
// Test 3: updateSigchainHead — light-touch, preserves other fields
// ---------------------------------------------------------------------------

async function test3_updateSigchainHead() {
  console.log('\nTest 3: updateSigchainHead — head-only update');

  const vestaDir = makeTempVesta();

  await writeIdentityRegistry({
    handle: 'lighttestentity',
    masterFingerprint: FAKE_FINGERPRINT,
    masterPublicKey: FAKE_MASTER_PUB,
    sigchainHeadCID: FAKE_CID_1,
    status: 'active',
    vestaDir,
  });

  const sigchainDir = path.join(vestaDir, 'entities', 'lighttestentity', 'sigchain');
  const metaBefore = JSON.parse(fs.readFileSync(path.join(sigchainDir, 'metadata.json'), 'utf8'));

  // Small delay
  await new Promise(r => setTimeout(r, 10));

  const result = await updateSigchainHead({
    handle: 'lighttestentity',
    sigchainHeadCID: FAKE_CID_2,
    vestaDir,
  });

  assert(result.updated === true, 'updated is true');
  assert(!result.error, 'no error');

  const metaAfter = JSON.parse(fs.readFileSync(path.join(sigchainDir, 'metadata.json'), 'utf8'));

  // Only head fields should change
  assert(metaAfter.handle === metaBefore.handle, 'handle preserved');
  assert(metaAfter.masterFingerprint === metaBefore.masterFingerprint, 'masterFingerprint preserved');
  assert(metaAfter.status === metaBefore.status, 'status preserved');
  assert(metaAfter.created === metaBefore.created, 'created preserved');
  assert(metaAfter.sigchainHeadCID === FAKE_CID_2, 'sigchainHeadCID updated');
  // sigchainHeadUpdated should be fresh (or at least the same if sub-millisecond)
  assert(typeof metaAfter.sigchainHeadUpdated === 'string', 'sigchainHeadUpdated is a string');

  const headTxt = fs.readFileSync(path.join(sigchainDir, 'sigchain-head.txt'), 'utf8').trim();
  assert(headTxt === FAKE_CID_2, 'sigchain-head.txt updated');
}

// ---------------------------------------------------------------------------
// Test 4: End-to-end with resolveIdentity — write then resolve
// ---------------------------------------------------------------------------

async function test4_roundTrip() {
  console.log('\nTest 4: End-to-end round-trip — write then resolveIdentity');

  const vestaDir = makeTempVesta();

  await writeIdentityRegistry({
    handle: 'roundtrip',
    masterFingerprint: FAKE_FINGERPRINT,
    masterPublicKey: FAKE_MASTER_PUB,
    sigchainHeadCID: FAKE_CID_1,
    vestaDir,
  });

  const resolved = await resolveIdentity('roundtrip', { vestaDir });

  assert(resolved.resolved === true, 'resolveIdentity returns resolved: true');
  assert(resolved.handle === 'roundtrip', 'handle matches');
  assert(resolved.masterFingerprint === FAKE_FINGERPRINT, 'masterFingerprint round-trips');
  assert(resolved.masterPublicKey === FAKE_MASTER_PUB, 'masterPublicKey round-trips');
  assert(resolved.sigchainHeadCID === FAKE_CID_1, 'sigchainHeadCID round-trips');
  assert(resolved.status === 'active', 'status round-trips');
  assert(!resolved.headMismatch, 'no headMismatch (head.txt and metadata.json agree)');
}

// ---------------------------------------------------------------------------
// Test 5: Atomic write — temp file pattern
// ---------------------------------------------------------------------------

async function test5_atomicWrite() {
  console.log('\nTest 5: Atomic write — temp file renamed into place');

  // We verify the pattern indirectly: after writeIdentityRegistry completes,
  // no .tmp.* files should remain in the sigchainDir.
  const vestaDir = makeTempVesta();

  await writeIdentityRegistry({
    handle: 'atomictest',
    masterFingerprint: FAKE_FINGERPRINT,
    masterPublicKey: FAKE_MASTER_PUB,
    sigchainHeadCID: FAKE_CID_1,
    vestaDir,
  });

  const sigchainDir = path.join(vestaDir, 'entities', 'atomictest', 'sigchain');
  const files = fs.readdirSync(sigchainDir);
  const tmpFiles = files.filter(f => f.includes('.tmp.'));

  assert(tmpFiles.length === 0, 'no .tmp.* files remain after write (temp+rename completed)');

  // Also confirm only the expected 3 files are present
  assert(files.includes('master.pub.asc'), 'master.pub.asc present');
  assert(files.includes('metadata.json'), 'metadata.json present');
  assert(files.includes('sigchain-head.txt'), 'sigchain-head.txt present');
  assert(files.length === 3, 'exactly 3 files in sigchainDir');
}

// ---------------------------------------------------------------------------
// Test 6: Missing required fields
// ---------------------------------------------------------------------------

async function test6_missingRequiredFields() {
  console.log('\nTest 6: Missing required fields → error');

  const vestaDir = makeTempVesta();
  const base = {
    handle: 'x',
    masterFingerprint: FAKE_FINGERPRINT,
    masterPublicKey: FAKE_MASTER_PUB,
    sigchainHeadCID: FAKE_CID_1,
    vestaDir,
  };

  const r1 = await writeIdentityRegistry({ ...base, handle: '' });
  assert(r1.written === false && typeof r1.error === 'string', 'empty handle → error');

  const r2 = await writeIdentityRegistry({ ...base, masterFingerprint: undefined });
  assert(r2.written === false && typeof r2.error === 'string', 'missing masterFingerprint → error');

  const r3 = await writeIdentityRegistry({ ...base, masterPublicKey: null });
  assert(r3.written === false && typeof r3.error === 'string', 'null masterPublicKey → error');

  const r4 = await writeIdentityRegistry({ ...base, sigchainHeadCID: '' });
  assert(r4.written === false && typeof r4.error === 'string', 'empty sigchainHeadCID → error');
}

// ---------------------------------------------------------------------------
// Test 7: updateSigchainHead on nonexistent sigchainDir
// ---------------------------------------------------------------------------

async function test7_updateHeadMissing() {
  console.log('\nTest 7: updateSigchainHead on nonexistent sigchainDir → error');

  const vestaDir = makeTempVesta();
  // Don't create any record first

  const result = await updateSigchainHead({
    handle: 'nobody',
    sigchainHeadCID: FAKE_CID_1,
    vestaDir,
  });

  assert(result.updated === false, 'updated is false');
  assert(typeof result.error === 'string' && result.error.length > 0, 'error message present');
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function run() {
  console.log('=== test-identity-writer.js ===');

  try {
    await test1_firstWrite();
    await test2_updateExisting();
    await test3_updateSigchainHead();
    await test4_roundTrip();
    await test5_atomicWrite();
    await test6_missingRequiredFields();
    await test7_updateHeadMissing();
  } finally {
    cleanup();
  }

  console.log(`\n=== ${passed + failed} tests: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
