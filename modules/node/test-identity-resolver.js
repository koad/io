// test-identity-resolver.js — resolveIdentity() tests
//
// Tests (per flight plan §resolveidentity-reader-entity-registry-lookup-pe):
//   1. No entity record → { resolved: false, reason: 'no-entity-record' }
//   2. Entity dir exists but no sigchain/ → { resolved: false, reason: 'no-sigchain' }
//   3. Sigchain present, lite mode → { resolved: true, masterFingerprint, masterPublicKey, sigchainHeadCID, ... }
//   4. Sigchain present, walk mode with entries → { resolved: true, leafSet: [...] }
//   5. Walk mode but no entries → { resolved: true, ..., chainErrors: [{ error: 'walk requested but no entries provided' }] }
//   6. Metadata fingerprint mismatch with chain master → chainErrors flags it
//   7. sigchain-head.txt mismatches metadata.json → headMismatch included in result
//
// Run: node modules/node/test-identity-resolver.js

import { resolveIdentity } from './identity-resolver.js';
import {
  buildIdentityGenesis,
  buildLeafAuthorize,
  wrapEntry,
  signEntry,
} from './sigchain.js';
import { createKoadIdentity } from './identity.js';
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

/**
 * Create a fresh temp directory for a fake ~/.vesta/ layout.
 * Returns the path; caller must clean up.
 */
function makeTempVesta() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'koad-identity-resolver-test-'));
  const entitiesDir = path.join(tmpDir, 'entities');
  fs.mkdirSync(entitiesDir, { recursive: true });
  return tmpDir;
}

/**
 * Scaffold a minimal entity dir (no sigchain/).
 */
function scaffoldEntityDir(vestaDir, handle) {
  const entityDir = path.join(vestaDir, 'entities', handle);
  fs.mkdirSync(entityDir, { recursive: true });
  return entityDir;
}

/**
 * Scaffold a full sigchain/ subdirectory with the given metadata and key.
 */
function scaffoldSigchain(vestaDir, handle, {
  metadata,
  masterPubAsc,
  sigchainHeadTxt = null,
}) {
  const entityDir = scaffoldEntityDir(vestaDir, handle);
  const sigchainDir = path.join(entityDir, 'sigchain');
  fs.mkdirSync(sigchainDir, { recursive: true });
  fs.writeFileSync(path.join(sigchainDir, 'metadata.json'), JSON.stringify(metadata, null, 2), 'utf8');
  fs.writeFileSync(path.join(sigchainDir, 'master.pub.asc'), masterPubAsc, 'utf8');
  if (sigchainHeadTxt !== null) {
    fs.writeFileSync(path.join(sigchainDir, 'sigchain-head.txt'), sigchainHeadTxt, 'utf8');
  }
  return sigchainDir;
}

/**
 * Create a fresh koad.identity in ceremony posture.
 * Each call produces a NEW PGP keypair.
 */
async function makeIdentity(handle = 'koad') {
  const id = createKoadIdentity();
  await id.create({ handle, userid: `${handle} <${handle}@koad.sh>` });
  return id;
}

/**
 * Build and sign a genesis entry. Returns { entry, cid }.
 */
async function makeGenesis(identity) {
  const { type, payload } = buildIdentityGenesis({
    entity_handle: identity.handle,
    master_fingerprint: identity.masterFingerprint,
    master_pubkey_armored: identity.masterPublicKey,
    created: new Date().toISOString(),
  });
  const unsigned = wrapEntry({
    entity: identity.handle,
    timestamp: new Date().toISOString(),
    type,
    payload,
    previous: null,
  });
  return signEntry(unsigned, identity, { useMaster: true });
}

/**
 * Build and sign a leaf-authorize entry. Returns { entry, cid }.
 */
async function makeLeafAuthorize(identity, leafIdentity, prevCID) {
  const { type, payload } = buildLeafAuthorize({
    leaf_fingerprint: leafIdentity.fingerprint,
    leaf_pubkey_armored: leafIdentity.publicKey,
    device_label: `${leafIdentity.handle}-leaf-0`,
    authorized_by_fingerprint: identity.masterFingerprint,
    authorized_at: new Date().toISOString(),
  });
  const unsigned = wrapEntry({
    entity: identity.handle,
    timestamp: new Date().toISOString(),
    type,
    payload,
    previous: prevCID,
  });
  return signEntry(unsigned, identity, { useMaster: true });
}

// ---------------------------------------------------------------------------
// Cleanup registry (collect tmpDirs, wipe at end)
// ---------------------------------------------------------------------------

const tmpDirs = [];

function trackTmp(dir) {
  tmpDirs.push(dir);
  return dir;
}

function cleanup() {
  for (const dir of tmpDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// --- Test 1: No entity record ---
async function test1_noEntityRecord() {
  console.log('\nTest 1: No entity record');
  const vestaDir = trackTmp(makeTempVesta());
  const result = await resolveIdentity('nonexistent', { vestaDir });
  assert(result.resolved === false, 'resolved is false');
  assert(result.reason === 'no-entity-record', 'reason is no-entity-record');
}

// --- Test 2: Entity exists but no sigchain/ ---
async function test2_noSigchain() {
  console.log('\nTest 2: Entity exists but no sigchain/');
  const vestaDir = trackTmp(makeTempVesta());
  scaffoldEntityDir(vestaDir, 'someentity');
  const result = await resolveIdentity('someentity', { vestaDir });
  assert(result.resolved === false, 'resolved is false');
  assert(result.reason === 'no-sigchain', 'reason is no-sigchain');
}

// --- Test 3: Sigchain present, lite mode ---
async function test3_liteMode() {
  console.log('\nTest 3: Sigchain present, lite mode');
  const vestaDir = trackTmp(makeTempVesta());
  const fakeMasterPub = '-----BEGIN PGP PUBLIC KEY BLOCK-----\nfake-key-data\n-----END PGP PUBLIC KEY BLOCK-----';
  const fakeMeta = {
    handle: 'koad',
    masterFingerprint: 'A07F 8CFE CBF6 B982 EEDA  C4F3 62D5 C486 6C24 7E00',
    sigchainHeadCID: 'baguqeera1234567890abcdefghijklmnopqrst',
    status: 'active',
    created: '2026-04-26T00:00:00Z',
    sigchainHeadUpdated: '2026-04-26T00:00:00Z',
  };

  scaffoldSigchain(vestaDir, 'koad', {
    metadata: fakeMeta,
    masterPubAsc: fakeMasterPub,
  });

  const result = await resolveIdentity('koad', { vestaDir });

  assert(result.resolved === true, 'resolved is true');
  assert(result.handle === 'koad', 'handle is koad');
  assert(result.masterFingerprint === fakeMeta.masterFingerprint, 'masterFingerprint matches');
  assert(result.masterPublicKey === fakeMasterPub, 'masterPublicKey matches');
  assert(result.sigchainHeadCID === fakeMeta.sigchainHeadCID, 'sigchainHeadCID matches');
  assert(result.status === 'active', 'status is active');
  assert(result.created === fakeMeta.created, 'created matches');
  assert(result.sigchainHeadUpdated === fakeMeta.sigchainHeadUpdated, 'sigchainHeadUpdated matches');
  assert(!result.leafSet, 'leafSet not present in lite mode');
}

// --- Test 4: Walk mode with valid entries ---
async function test4_walkModeWithEntries() {
  console.log('\nTest 4: Walk mode with valid entries (real chain)');
  const identity = await makeIdentity('koad');
  const genesisResult = await makeGenesis(identity);

  // Use the leaf identity as a separate leaf to authorize
  // Build a second identity for the leaf
  const leafIdentity = await makeIdentity('koad');
  const leafAuthorizeResult = await makeLeafAuthorize(identity, leafIdentity, genesisResult.cid);

  const vestaDir = trackTmp(makeTempVesta());
  const fakeMeta = {
    handle: 'koad',
    masterFingerprint: identity.masterFingerprint,
    sigchainHeadCID: leafAuthorizeResult.cid,
    status: 'active',
    created: new Date().toISOString(),
    sigchainHeadUpdated: new Date().toISOString(),
  };

  scaffoldSigchain(vestaDir, 'koad', {
    metadata: fakeMeta,
    masterPubAsc: identity.masterPublicKey,
  });

  const entries = [genesisResult, leafAuthorizeResult];
  const result = await resolveIdentity('koad', { vestaDir, walk: true, entries });

  assert(result.resolved === true, 'resolved is true');
  assert(Array.isArray(result.leafSet), 'leafSet is an array');
  assert(result.leafSet.length === 1, 'leafSet has one entry');
  assert(result.leafSet[0].fingerprint === leafIdentity.fingerprint, 'leafSet fingerprint matches');
  // No critical errors expected
  const criticalErrors = (result.chainErrors || []).filter(e => e.type !== undefined);
  assert(criticalErrors.length === 0, 'no chain errors');
}

// --- Test 5: Walk mode but no entries ---
async function test5_walkModeNoEntries() {
  console.log('\nTest 5: Walk mode but no entries');
  const vestaDir = trackTmp(makeTempVesta());
  const fakeMasterPub = '-----BEGIN PGP PUBLIC KEY BLOCK-----\nfake\n-----END PGP PUBLIC KEY BLOCK-----';
  const fakeMeta = {
    handle: 'koad',
    masterFingerprint: 'ABCD1234',
    sigchainHeadCID: 'baguqeerafake',
    status: 'active',
    created: '2026-04-26T00:00:00Z',
    sigchainHeadUpdated: '2026-04-26T00:00:00Z',
  };
  scaffoldSigchain(vestaDir, 'koad', { metadata: fakeMeta, masterPubAsc: fakeMasterPub });

  const result = await resolveIdentity('koad', { vestaDir, walk: true });

  assert(result.resolved === true, 'resolved is true');
  assert(Array.isArray(result.chainErrors), 'chainErrors is an array');
  assert(result.chainErrors.length > 0, 'chainErrors is non-empty');
  assert(
    result.chainErrors.some(e => e.error === 'walk requested but no entries provided'),
    'chainErrors contains walk-with-no-entries message'
  );
}

// --- Test 6: Metadata fingerprint mismatch with chain master ---
async function test6_fingerprintMismatch() {
  console.log('\nTest 6: Metadata fingerprint mismatch with chain master');
  const identity = await makeIdentity('koad');
  const genesisResult = await makeGenesis(identity);

  const vestaDir = trackTmp(makeTempVesta());
  // Deliberately put a WRONG fingerprint in metadata
  const wrongFingerprint = 'DEAD BEEF DEAD BEEF DEAD  BEEF DEAD BEEF DEAD BEEF';
  const fakeMeta = {
    handle: 'koad',
    masterFingerprint: wrongFingerprint,
    sigchainHeadCID: genesisResult.cid,
    status: 'active',
    created: new Date().toISOString(),
    sigchainHeadUpdated: new Date().toISOString(),
  };

  scaffoldSigchain(vestaDir, 'koad', {
    metadata: fakeMeta,
    masterPubAsc: identity.masterPublicKey,
  });

  const entries = [genesisResult];
  const result = await resolveIdentity('koad', { vestaDir, walk: true, entries });

  assert(result.resolved === true, 'resolved is true (chain is still readable)');
  assert(Array.isArray(result.chainErrors), 'chainErrors is present');
  const mismatchErr = result.chainErrors.find(e => e.type === 'master-fingerprint-mismatch');
  assert(!!mismatchErr, 'master-fingerprint-mismatch error present in chainErrors');
}

// --- Test 7: sigchain-head.txt mismatches metadata.json ---
async function test7_headMismatch() {
  console.log('\nTest 7: sigchain-head.txt mismatches metadata.json');
  const vestaDir = trackTmp(makeTempVesta());
  const fakeMasterPub = '-----BEGIN PGP PUBLIC KEY BLOCK-----\nfake\n-----END PGP PUBLIC KEY BLOCK-----';
  const metaCID = 'baguqeeramatch000000000';
  const txtCID  = 'baguqeeramismatch11111';

  const fakeMeta = {
    handle: 'koad',
    masterFingerprint: 'ABCD1234',
    sigchainHeadCID: metaCID,
    status: 'active',
    created: '2026-04-26T00:00:00Z',
    sigchainHeadUpdated: '2026-04-26T00:00:00Z',
  };
  scaffoldSigchain(vestaDir, 'koad', {
    metadata: fakeMeta,
    masterPubAsc: fakeMasterPub,
    sigchainHeadTxt: txtCID,  // deliberate mismatch
  });

  const result = await resolveIdentity('koad', { vestaDir });

  assert(result.resolved === true, 'resolved is true');
  assert(typeof result.headMismatch === 'string', 'headMismatch is present');
  assert(result.headMismatch.includes(txtCID), 'headMismatch mentions the txt CID');
  assert(result.headMismatch.includes(metaCID), 'headMismatch mentions the metadata CID');
  // sigchainHeadCID should be the metadata.json value (authoritative per spec)
  assert(result.sigchainHeadCID === metaCID, 'sigchainHeadCID is from metadata.json');
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function run() {
  console.log('=== test-identity-resolver.js ===');

  try {
    await test1_noEntityRecord();
    await test2_noSigchain();
    await test3_liteMode();
    await test4_walkModeWithEntries();
    await test5_walkModeNoEntries();
    await test6_fingerprintMismatch();
    await test7_headMismatch();
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
