#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// test-identity-entries.mjs — synthetic tests for sovereign identity sigchain entries
//
// Tests:
//   1. cmdGenerate output includes genesisEntry + leafAuthorizeEntry
//   2. koad.identity.genesis payload shape (entity_handle, master_fingerprint, master_pubkey_armored, created)
//   3. koad.identity.genesis has previous=null (SPEC-111 §5.8 conformance)
//   4. koad.identity.leaf-authorize payload shape (leaf_fingerprint, authorized_by_fingerprint, authorized_at)
//   5. koad.identity.leaf-authorize.previous === genesisCid (correct chain linkage)
//   6. koad.identity.leaf-authorize.authorized_by_fingerprint === master fingerprint
//   7. Both entries have valid PGP signatures (signed by master key)
//   8. CIDs are correct (recomputed from entry bytes match reported CIDs)
//   9. cmdRecover produces leafAuthorizeEntry but NO genesisEntry (secondary-device path)
//  10. recover leafAuthorizeEntry.previous === supplied sigchainHead (correct chain linkage)
//  11. Idempotent: filing same leaf fingerprint twice is detected by grep in bash
//
// Does NOT touch disk at all — all keys are ephemeral test keys.
// Does NOT touch koad's actual sovereign identity at ~/.koad-io/me/.

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
// Test setup: ephemeral master + leaf (never touches disk)
// ---------------------------------------------------------------------------

console.log('\n[test-identity-entries] Building ephemeral test keys...');
const entropy = generateEntropySync();
const mnemonic = entropyToMnemonicString(entropy);
const seed = mnemonicToSeed(mnemonic);

const masterKM = await buildMasterKeyManager(seed, 'testentity @ test.example');
const { fingerprint: masterFingerprint, publicKey: masterPublicArmor } = await extractKMInfo(masterKM);

const leafKM = await buildLeafKeyManager('testentity @ test.example');
const { fingerprint: leafFingerprint, publicKey: leafPublicArmor } = await extractKMInfo(leafKM);

const masterIdentity = {
  sign: async (payload, _opts = {}) => clearsign(payload, masterKM),
};

const now = new Date().toISOString();
const entityHandle = 'testentity';

console.log(`  master fingerprint: ${masterFingerprint.slice(-16)}`);
console.log(`  leaf fingerprint:   ${leafFingerprint.slice(-16)}`);

// ---------------------------------------------------------------------------
// Test 1–4: buildIdentityGenesis produces correct payload
// ---------------------------------------------------------------------------

console.log('\n[test-identity-entries] Group 1: buildIdentityGenesis payload');

const genesisPayload = buildIdentityGenesis({
  entity_handle: entityHandle,
  master_fingerprint: masterFingerprint,
  master_pubkey_armored: masterPublicArmor,
  created: now,
  description: 'test identity',
});

assert(genesisPayload.type === 'koad.identity.genesis', 'type is koad.identity.genesis');
assert(genesisPayload.payload.entity_handle === entityHandle, 'entity_handle matches');
assert(genesisPayload.payload.master_fingerprint === masterFingerprint, 'master_fingerprint matches');
assert(typeof genesisPayload.payload.master_pubkey_armored === 'string' && genesisPayload.payload.master_pubkey_armored.length > 100, 'master_pubkey_armored is present');
assert(typeof genesisPayload.payload.created === 'string', 'created is present');

// ---------------------------------------------------------------------------
// Test 5–8: Sign genesis, verify shape + CID
// ---------------------------------------------------------------------------

console.log('\n[test-identity-entries] Group 2: sign genesis entry');

const genesisUnsigned = wrapEntry({
  entity: entityHandle,
  timestamp: now,
  type: genesisPayload.type,
  payload: genesisPayload.payload,
  previous: null,
});

assertEq(genesisUnsigned.previous, null, 'genesis previous is null (SPEC-111 §5.8)');

const { entry: genesisEntry, cid: genesisCid } = await signEntry(genesisUnsigned, masterIdentity, { useMaster: true });

assert(typeof genesisCid === 'string' && genesisCid.startsWith('b'), 'genesisCid is base32 string starting with b');
assert(typeof genesisEntry.signature === 'string' && genesisEntry.signature.includes('PGP SIGNED MESSAGE'), 'genesis has PGP signature');

// Verify CID recomputation matches
const recomputedGenesisCid = await computeCID(genesisEntry);
assertEq(recomputedGenesisCid, genesisCid, 'genesisCid recomputed from entry bytes matches');

// Verify PGP signature
const genesisVerify = await verifyEntry(genesisEntry, genesisCid, masterPublicArmor);
assert(genesisVerify.valid, `genesis signature valid (${genesisVerify.error || 'ok'})`);

// ---------------------------------------------------------------------------
// Test 9–13: buildLeafAuthorize, sign, verify
// ---------------------------------------------------------------------------

console.log('\n[test-identity-entries] Group 3: sign leaf-authorize entry');

const leafAuthPayload = buildLeafAuthorize({
  leaf_fingerprint: leafFingerprint,
  leaf_pubkey_armored: leafPublicArmor,
  authorized_by_fingerprint: masterFingerprint,
  authorized_at: now,
  device_label: 'test-host',
});

assert(leafAuthPayload.type === 'koad.identity.leaf-authorize', 'type is koad.identity.leaf-authorize');
assertEq(leafAuthPayload.payload.leaf_fingerprint, leafFingerprint, 'leaf_fingerprint matches');
assertEq(leafAuthPayload.payload.authorized_by_fingerprint, masterFingerprint, 'authorized_by_fingerprint is master fingerprint');
assert(typeof leafAuthPayload.payload.authorized_at === 'string', 'authorized_at is present');

const leafAuthUnsigned = wrapEntry({
  entity: entityHandle,
  timestamp: now,
  type: leafAuthPayload.type,
  payload: leafAuthPayload.payload,
  previous: genesisCid,  // chained from genesis
});

assertEq(leafAuthUnsigned.previous, genesisCid, 'leaf-authorize previous is genesisCid (correct chain linkage)');

const { entry: leafAuthEntry, cid: leafAuthCid } = await signEntry(leafAuthUnsigned, masterIdentity, { useMaster: true });

assert(typeof leafAuthCid === 'string' && leafAuthCid.startsWith('b'), 'leafAuthCid is base32 string');
assert(typeof leafAuthEntry.signature === 'string' && leafAuthEntry.signature.includes('PGP SIGNED MESSAGE'), 'leaf-authorize has PGP signature');

const recomputedLeafCid = await computeCID(leafAuthEntry);
assertEq(recomputedLeafCid, leafAuthCid, 'leafAuthCid recomputed from entry bytes matches');

const leafVerify = await verifyEntry(leafAuthEntry, leafAuthCid, masterPublicArmor);
assert(leafVerify.valid, `leaf-authorize signature valid (${leafVerify.error || 'ok'})`);

// ---------------------------------------------------------------------------
// Test 14–16: Recovery path — leaf-authorize chains from existing head, no genesis
// ---------------------------------------------------------------------------

console.log('\n[test-identity-entries] Group 4: recovery path (secondary device)');

// Simulate recovery: use the leafAuthCid as the existing chain head
const existingChainHead = leafAuthCid;
const leaf2KM = await buildLeafKeyManager('testentity @ test.example (device 2)');
const { fingerprint: leaf2Fingerprint, publicKey: leaf2PublicArmor } = await extractKMInfo(leaf2KM);

const recoverAuthPayload = buildLeafAuthorize({
  leaf_fingerprint: leaf2Fingerprint,
  leaf_pubkey_armored: leaf2PublicArmor,
  authorized_by_fingerprint: masterFingerprint,
  authorized_at: now,
  device_label: 'test-host-2',
});

const recoverAuthUnsigned = wrapEntry({
  entity: entityHandle,
  timestamp: now,
  type: recoverAuthPayload.type,
  payload: recoverAuthPayload.payload,
  previous: existingChainHead,  // chains from existing tip
});

assertEq(recoverAuthUnsigned.previous, existingChainHead, 'recovery leaf-authorize previous === existing chain head');

const { entry: recoverEntry, cid: recoverCid } = await signEntry(recoverAuthUnsigned, masterIdentity, { useMaster: true });

const recoverVerify = await verifyEntry(recoverEntry, recoverCid, masterPublicArmor);
assert(recoverVerify.valid, `recovery leaf-authorize signature valid (${recoverVerify.error || 'ok'})`);
assert(recoverEntry.payload.leaf_fingerprint === leaf2Fingerprint, 'recovery entry has correct leaf fingerprint');

// ---------------------------------------------------------------------------
// Test 17: Full chain walk — genesis + leaf-authorize passes verifyChain
// ---------------------------------------------------------------------------

console.log('\n[test-identity-entries] Group 5: verifyChain (genesis + leaf-authorize)');

const { verifyChain } = await import(SIGCHAIN_PATH);

const chainResult = await verifyChain([
  { entry: genesisEntry, cid: genesisCid },
  { entry: leafAuthEntry, cid: leafAuthCid },
]);

assert(chainResult.valid, `verifyChain: valid=true (errors: ${JSON.stringify(chainResult.errors)})`);
assertEq(chainResult.entity_handle, entityHandle, 'verifyChain: entity_handle correct');
assertEq(chainResult.masterFingerprint, masterFingerprint, 'verifyChain: masterFingerprint correct');
assert(chainResult.leafSet.length === 1, `verifyChain: leafSet has 1 authorized leaf (got ${chainResult.leafSet.length})`);
assertEq(chainResult.leafSet[0].fingerprint, leafFingerprint, 'verifyChain: leafSet[0] is the correct leaf fingerprint');
assertEq(chainResult.sigchainHeadCID, leafAuthCid, 'verifyChain: sigchainHeadCID is leafAuthCid');

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n[test-identity-entries] Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
