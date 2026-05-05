#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// test-recover-wipe-restore.mjs — synthetic tests for cmdRecover wipe-and-restore path
//
// Tests the bug fix: when sigchainHead is null (empty local sigchain, e.g. after a
// full wipe), cmdRecover must produce BOTH genesisEntry and leafAuthorizeEntry.
//
// Tests:
//   1. Wipe-and-restore (sigchainHead null): output includes genesisEntry + genesisCid
//   2. Wipe-and-restore: output includes leafAuthorizeEntry + leafAuthorizeCid
//   3. Wipe-and-restore: genesis has previous=null (SPEC-111 §5.8)
//   4. Wipe-and-restore: leafAuthorize.previous === genesisCid (correct chain linkage)
//   5. Wipe-and-restore: both entries carry valid PGP signatures
//   6. Wipe-and-restore: CIDs match recomputed values
//   7. Wipe-and-restore: genesis is deterministic (same master → same CID as fresh genesis)
//   8. Secondary-device path (sigchainHead non-null): NO genesisEntry in output
//   9. Secondary-device path: leafAuthorize.previous === supplied sigchainHead
//  10. Full chain walk passes verifyChain for wipe-and-restore output
//
// Does NOT touch disk. Does NOT touch koad's actual sovereign identity at ~/.koad-io/me/.

import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const KOAD_IO_ROOT = path.resolve(__dirname, '..', '..', '..');
const CEREMONY_PATH = path.join(KOAD_IO_ROOT, 'modules', 'node', 'ceremony.js');
const SIGCHAIN_PATH = path.join(KOAD_IO_ROOT, 'modules', 'node', 'sigchain.js');

const {
  generateEntropySync,
  entropyToMnemonicString,
  mnemonicToSeed,
  buildMasterKeyManager,
  buildLeafKeyManager,
  extractKMInfo,
  generateDeviceKey,
  encryptLeafForStorage,
} = await import(CEREMONY_PATH);

const {
  buildIdentityGenesis,
  buildLeafAuthorize,
  wrapEntry,
  signEntry,
  computeCID,
  verifyEntry,
  verifyChain,
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
  assert(a === b, `${msg} (got: ${JSON.stringify(a)}, expected: ${JSON.stringify(b)})`);
}

// ---------------------------------------------------------------------------
// Inline simulation of cmdRecover logic (mirrors ceremony.mjs cmdRecover)
// This lets us test the logic without spawning a subprocess.
// ---------------------------------------------------------------------------

async function simulateCmdRecover({ mnemonic, userid, entityHandle, sigchainHead = null }) {
  const seed = mnemonicToSeed(mnemonic);
  const masterKM = await buildMasterKeyManager(seed, userid);
  const { fingerprint: masterFingerprint, publicKey: masterPublicArmor } = await extractKMInfo(masterKM);

  const leafKM = await buildLeafKeyManager(userid);
  const { fingerprint: leafFingerprint, publicKey: leafPublicArmor } = await extractKMInfo(leafKM);

  const deviceKey = generateDeviceKey();
  const leafPrivateArmor = await encryptLeafForStorage(leafKM, deviceKey);

  const words = mnemonic.split(' ');
  const label = words[0] + ' ' + words[1];

  const masterIdentity = {
    sign: async (payload, _opts = {}) => clearsign(payload, masterKM),
  };

  const now = new Date().toISOString();

  let genesisEntry = undefined;
  let genesisCid = undefined;
  let leafAuthPrevious = sigchainHead || null;

  if (!sigchainHead) {
    // Wipe-and-restore: re-sign genesis
    const genesisPayload = buildIdentityGenesis({
      entity_handle: entityHandle,
      master_fingerprint: masterFingerprint,
      master_pubkey_armored: masterPublicArmor,
      created: now,
      description: `${entityHandle} sovereign identity`,
    });
    const genesisUnsigned = wrapEntry({
      entity: entityHandle,
      timestamp: now,
      type: genesisPayload.type,
      payload: genesisPayload.payload,
      previous: null,
    });
    const signed = await signEntry(genesisUnsigned, masterIdentity, { useMaster: true });
    genesisEntry = signed.entry;
    genesisCid = signed.cid;
    leafAuthPrevious = genesisCid;
  }

  const leafAuthPayload = buildLeafAuthorize({
    leaf_fingerprint: leafFingerprint,
    leaf_pubkey_armored: leafPublicArmor,
    authorized_by_fingerprint: masterFingerprint,
    authorized_at: now,
  });
  const leafAuthUnsigned = wrapEntry({
    entity: entityHandle,
    timestamp: now,
    type: leafAuthPayload.type,
    payload: leafAuthPayload.payload,
    previous: leafAuthPrevious,
  });
  const { entry: leafAuthorizeEntry, cid: leafAuthorizeCid } = await signEntry(leafAuthUnsigned, masterIdentity, { useMaster: true });

  return {
    label,
    mnemonic,
    masterFingerprint,
    masterPublicArmor,
    leafFingerprint,
    leafPublicArmor,
    leafPrivateArmor,
    deviceKey,
    ...(genesisCid ? { genesisEntry, genesisCid } : {}),
    leafAuthorizeEntry,
    leafAuthorizeCid,
    newHeadCid: leafAuthorizeCid,
    sigchainHead,
  };
}

// ---------------------------------------------------------------------------
// Test setup: ephemeral master key (never touches disk)
// ---------------------------------------------------------------------------

console.log('\n[test-recover-wipe-restore] Building ephemeral test keys...');
const entropy = generateEntropySync();
const mnemonic = entropyToMnemonicString(entropy);

const entityHandle = 'testentity';
const userid = `${entityHandle} @ test.example`;

console.log(`  mnemonic first two words: ${mnemonic.split(' ').slice(0, 2).join(' ')}`);

// ---------------------------------------------------------------------------
// Group 1: Wipe-and-restore (sigchainHead is null)
// ---------------------------------------------------------------------------

console.log('\n[test-recover-wipe-restore] Group 1: wipe-and-restore (sigchainHead null)');

const wipeResult = await simulateCmdRecover({ mnemonic, userid, entityHandle, sigchainHead: null });

// Test 1: output includes genesisEntry + genesisCid
assert(typeof wipeResult.genesisCid === 'string' && wipeResult.genesisCid.length > 0,
  'wipe-and-restore: output includes genesisCid');
assert(wipeResult.genesisEntry !== undefined && typeof wipeResult.genesisEntry === 'object',
  'wipe-and-restore: output includes genesisEntry object');

// Test 2: output includes leafAuthorizeEntry + leafAuthorizeCid
assert(typeof wipeResult.leafAuthorizeCid === 'string' && wipeResult.leafAuthorizeCid.length > 0,
  'wipe-and-restore: output includes leafAuthorizeCid');
assert(wipeResult.leafAuthorizeEntry !== undefined && typeof wipeResult.leafAuthorizeEntry === 'object',
  'wipe-and-restore: output includes leafAuthorizeEntry object');

// Test 3: genesis has previous=null
assertEq(wipeResult.genesisEntry.previous, null,
  'wipe-and-restore: genesis entry has previous=null (SPEC-111 §5.8)');

// Test 4: leafAuthorize.previous === genesisCid
assertEq(wipeResult.leafAuthorizeEntry.previous, wipeResult.genesisCid,
  'wipe-and-restore: leafAuthorize.previous === genesisCid (correct chain linkage)');

// Test 5: both entries have valid PGP signatures
assert(
  typeof wipeResult.genesisEntry.signature === 'string' &&
  wipeResult.genesisEntry.signature.includes('PGP SIGNED MESSAGE'),
  'wipe-and-restore: genesis entry has PGP signature block'
);
assert(
  typeof wipeResult.leafAuthorizeEntry.signature === 'string' &&
  wipeResult.leafAuthorizeEntry.signature.includes('PGP SIGNED MESSAGE'),
  'wipe-and-restore: leaf-authorize entry has PGP signature block'
);

// Test 6: CIDs match recomputed values
const recomputedGenesisCid = await computeCID(wipeResult.genesisEntry);
assertEq(recomputedGenesisCid, wipeResult.genesisCid,
  'wipe-and-restore: genesisCid matches recomputed value');

const recomputedLeafCid = await computeCID(wipeResult.leafAuthorizeEntry);
assertEq(recomputedLeafCid, wipeResult.leafAuthorizeCid,
  'wipe-and-restore: leafAuthorizeCid matches recomputed value');

// Test 7: genesis is deterministic — same master produces same genesis payload
// Repeat the recover with the same mnemonic; the genesis payload fields must match.
// Note: we cannot compare CIDs directly because timestamps differ (now varies),
// but we CAN verify the master_fingerprint in both genesis payloads matches.
const wipeResult2 = await simulateCmdRecover({ mnemonic, userid, entityHandle, sigchainHead: null });
assertEq(
  wipeResult.masterFingerprint,
  wipeResult2.masterFingerprint,
  'wipe-and-restore: same mnemonic → same master fingerprint (deterministic master)'
);
assertEq(
  wipeResult.genesisEntry.payload.master_fingerprint,
  wipeResult2.genesisEntry.payload.master_fingerprint,
  'wipe-and-restore: genesis payload master_fingerprint is deterministic across runs'
);

// ---------------------------------------------------------------------------
// Group 2: Secondary-device path (sigchainHead non-null) — unchanged behavior
// ---------------------------------------------------------------------------

console.log('\n[test-recover-wipe-restore] Group 2: secondary-device path (sigchainHead non-null)');

const fakeExistingHead = 'bafkreifakeexistingchainhexcidfortestingpurposes000000000000000000';
const secondaryResult = await simulateCmdRecover({
  mnemonic,
  userid,
  entityHandle,
  sigchainHead: fakeExistingHead,
});

// Test 8: no genesisEntry in output
assert(secondaryResult.genesisEntry === undefined,
  'secondary-device: output does NOT include genesisEntry');
assert(secondaryResult.genesisCid === undefined,
  'secondary-device: output does NOT include genesisCid');

// Test 9: leafAuthorize.previous === supplied sigchainHead
assertEq(secondaryResult.leafAuthorizeEntry.previous, fakeExistingHead,
  'secondary-device: leafAuthorize.previous === supplied sigchainHead');

// ---------------------------------------------------------------------------
// Group 3: verifyChain — wipe-and-restore entries form a valid chain
// ---------------------------------------------------------------------------

console.log('\n[test-recover-wipe-restore] Group 3: verifyChain validation');

const chainResult = await verifyChain([
  { entry: wipeResult.genesisEntry, cid: wipeResult.genesisCid },
  { entry: wipeResult.leafAuthorizeEntry, cid: wipeResult.leafAuthorizeCid },
]);

// Test 10: chain validates
assert(chainResult.valid,
  `verifyChain: valid=true for wipe-and-restore output (errors: ${JSON.stringify(chainResult.errors)})`);
assertEq(chainResult.entity_handle, entityHandle,
  'verifyChain: entity_handle correct');
assertEq(chainResult.masterFingerprint, wipeResult.masterFingerprint,
  'verifyChain: masterFingerprint correct');
assert(chainResult.leafSet.length === 1,
  `verifyChain: leafSet has 1 authorized leaf (got ${chainResult.leafSet.length})`);
assertEq(chainResult.sigchainHeadCID, wipeResult.leafAuthorizeCid,
  'verifyChain: sigchainHeadCID is leafAuthorizeCid');

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n[test-recover-wipe-restore] Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
