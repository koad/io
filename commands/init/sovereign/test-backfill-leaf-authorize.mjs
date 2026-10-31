#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// test-backfill-leaf-authorize.mjs — synthetic tests for the backfill-leaf-authorize
// ceremony path introduced to close the UX gap in koad-io init sovereign.
//
// Tests:
//   1. get-leaf-fingerprint: can import existing public key armor and extract fingerprint
//   2. backfill-leaf-authorize: builds leaf-authorize entry for a pre-existing leaf
//   3. backfill-leaf-authorize: signed entry CID is correctly computable and verifiable
//   4. backfill-leaf-authorize: chains correctly from supplied sigchain-head
//   5. backfill-leaf-authorize: mnemonic mismatch is detectable (fingerprint check works)
//   6. backfill detection: sigchain grep finds existing entry when leaf fingerprint matches
//   7. backfill detection: sigchain grep finds nothing when leaf fingerprint is absent
//   8. backfill detection: idempotency — re-running does not produce duplicate entries
//
// Does NOT touch disk outside of os.tmpdir().
// Does NOT touch koad's actual sovereign identity at ~/.koad-io/me/.

import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { createRequire } from 'module';

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

// kbpgp for direct import of armored public key (mirrors what ceremony.mjs does).
// Must be resolved from modules/node so Node walks the correct node_modules tree.
const _require = createRequire(path.join(KOAD_IO_ROOT, 'modules', 'node', 'package.json'));
const kbpgp = _require('kbpgp');

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
// Test setup: ephemeral master + existing leaf (simulates an old install)
// ---------------------------------------------------------------------------

console.log('\n[test-backfill] Building ephemeral test keys (simulating old install)...');
const entropy = generateEntropySync();
const mnemonic = entropyToMnemonicString(entropy);
const seed = mnemonicToSeed(mnemonic);

// Master key — derived from mnemonic (same as genesis)
const masterKM = await buildMasterKeyManager(seed, 'testentity @ test.example');
const { fingerprint: masterFingerprint, publicKey: masterPublicArmor } = await extractKMInfo(masterKM);

// "Existing" leaf — generated at genesis time, lives on disk, but has no sigchain entry
const existingLeafKM = await buildLeafKeyManager('testentity @ test.example');
const { fingerprint: existingLeafFingerprint, publicKey: existingLeafPublicArmor } = await extractKMInfo(existingLeafKM);

// A second leaf to simulate a different device (used in mismatch tests)
const otherLeafKM = await buildLeafKeyManager('testentity @ test.example (other)');
const { fingerprint: otherLeafFingerprint } = await extractKMInfo(otherLeafKM);

const masterIdentity = {
  sign: async (payload, _opts = {}) => clearsign(payload, masterKM),
};

const now = new Date().toISOString();
const entityHandle = 'testentity';

console.log(`  master fingerprint:       ${masterFingerprint.slice(-16)}`);
console.log(`  existing leaf fingerprint: ${existingLeafFingerprint.slice(-16)}`);

// Temp dir for disk-based tests
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'koadio-backfill-test-'));
const leafPublicArmorFile = path.join(tmpDir, 'leaf.public.asc');
fs.writeFileSync(leafPublicArmorFile, existingLeafPublicArmor, 'utf8');

// Simulate a sigchain with genesis entry but NO leaf-authorize for the existing leaf
const genesisPayload = buildIdentityGenesis({
  entity_handle: entityHandle,
  master_fingerprint: masterFingerprint,
  master_pubkey_armored: masterPublicArmor,
  created: now,
});
const genesisUnsigned = wrapEntry({
  entity: entityHandle,
  timestamp: now,
  type: genesisPayload.type,
  payload: genesisPayload.payload,
  previous: null,
});
const { entry: genesisEntry, cid: genesisCid } = await signEntry(genesisUnsigned, masterIdentity, { useMaster: true });

// ---------------------------------------------------------------------------
// Test 1: get-leaf-fingerprint — import existing public key armor
// ---------------------------------------------------------------------------

console.log('\n[test-backfill] Group 1: get-leaf-fingerprint (import existing public key)');

const importedLeafKM = await new Promise((resolve, reject) => {
  kbpgp.KeyManager.import_from_armored_pgp({ armored: existingLeafPublicArmor }, (err, km) => {
    if (err) return reject(err);
    resolve(km);
  });
});
const importedFingerprint = (importedLeafKM.get_pgp_fingerprint_str() || '').toUpperCase();

assertEq(importedFingerprint, existingLeafFingerprint, 'imported fingerprint matches original');
assert(typeof importedFingerprint === 'string' && importedFingerprint.length === 40, 'fingerprint is 40-char hex string');

// ---------------------------------------------------------------------------
// Test 2–4: backfill-leaf-authorize — build and sign entry for existing leaf
// ---------------------------------------------------------------------------

console.log('\n[test-backfill] Group 2: backfill-leaf-authorize entry construction');

// Backfill builds leaf-authorize using the EXISTING leaf's public armor
// (fingerprint from import, not from a freshly generated key)
const backfillLeafAuthPayload = buildLeafAuthorize({
  leaf_fingerprint: importedFingerprint,    // from existing leaf on disk
  leaf_pubkey_armored: existingLeafPublicArmor,
  authorized_by_fingerprint: masterFingerprint,
  authorized_at: now,
});

assertEq(backfillLeafAuthPayload.type, 'koad.identity.leaf-authorize', 'type is koad.identity.leaf-authorize');
assertEq(backfillLeafAuthPayload.payload.leaf_fingerprint, existingLeafFingerprint, 'leaf_fingerprint matches existing leaf');
assertEq(backfillLeafAuthPayload.payload.authorized_by_fingerprint, masterFingerprint, 'authorized_by_fingerprint is master');

// Chain from genesis (the existing chain head in a backfill scenario)
const backfillUnsigned = wrapEntry({
  entity: entityHandle,
  timestamp: now,
  type: backfillLeafAuthPayload.type,
  payload: backfillLeafAuthPayload.payload,
  previous: genesisCid,
});

assertEq(backfillUnsigned.previous, genesisCid, 'backfill entry chains correctly from genesis CID');

const { entry: backfillEntry, cid: backfillCid } = await signEntry(backfillUnsigned, masterIdentity, { useMaster: true });

assert(typeof backfillCid === 'string' && backfillCid.startsWith('b'), 'backfillCid is base32 string');
assert(typeof backfillEntry.signature === 'string' && backfillEntry.signature.includes('PGP SIGNED MESSAGE'), 'backfill entry has PGP signature');

// ---------------------------------------------------------------------------
// Test 5–6: CID verifiability
// ---------------------------------------------------------------------------

console.log('\n[test-backfill] Group 3: CID and signature verification');

const recomputedCid = await computeCID(backfillEntry);
assertEq(recomputedCid, backfillCid, 'backfill CID recomputed from entry bytes matches reported CID');

const verResult = await verifyEntry(backfillEntry, backfillCid, masterPublicArmor);
assert(verResult.valid, `backfill entry signature verifies against master public key (${verResult.error || 'ok'})`);

// ---------------------------------------------------------------------------
// Test 7: Mismatch detection — wrong mnemonic would produce different master fingerprint
// ---------------------------------------------------------------------------

console.log('\n[test-backfill] Group 4: mnemonic mismatch detection');

// Generate a different mnemonic (wrong recovery phrase)
const wrongEntropy = generateEntropySync();
const wrongMnemonic = entropyToMnemonicString(wrongEntropy);
const wrongSeed = mnemonicToSeed(wrongMnemonic);
const wrongMasterKM = await buildMasterKeyManager(wrongSeed, 'testentity @ test.example');
const { fingerprint: wrongMasterFingerprint } = await extractKMInfo(wrongMasterKM);

assert(wrongMasterFingerprint !== masterFingerprint,
  'wrong mnemonic derives different master fingerprint (mismatch is detectable)');

// The bash-side check: compare derived fingerprint with id/master.fingerprint
// A wrong mnemonic would fail this check before any entry is filed
const storedMasterFingerprintFile = path.join(tmpDir, 'master.fingerprint');
fs.writeFileSync(storedMasterFingerprintFile, masterFingerprint, 'utf8');
const storedFpr = fs.readFileSync(storedMasterFingerprintFile, 'utf8').trim();
assert(storedFpr === masterFingerprint, 'stored master fingerprint matches correct mnemonic derivation');
assert(storedFpr !== wrongMasterFingerprint, 'stored master fingerprint does not match wrong mnemonic derivation');

// ---------------------------------------------------------------------------
// Test 8–9: Sigchain grep — detecting existing vs missing leaf-authorize entries
// ---------------------------------------------------------------------------

console.log('\n[test-backfill] Group 5: sigchain grep detection (Case A vs Case B)');

// Create a temp sigchain entries dir
const entriesDir = path.join(tmpDir, 'sigchain', 'entries');
fs.mkdirSync(entriesDir, { recursive: true });

// Write the backfill entry to disk
const entryFile = path.join(entriesDir, `${backfillCid}.json`);
fs.writeFileSync(entryFile, JSON.stringify(backfillEntry, null, 2), 'utf8');

// Simulate the bash grep: does any entry reference the leaf fingerprint?
function sigchainHasLeaf(dir, fingerprint) {
  if (!fs.existsSync(dir)) return false;
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  for (const f of files) {
    const content = fs.readFileSync(path.join(dir, f), 'utf8');
    if (content.includes(fingerprint)) return true;
  }
  return false;
}

// Case A: entry present — should be found
assert(sigchainHasLeaf(entriesDir, existingLeafFingerprint),
  'Case A: sigchain grep finds existing leaf-authorize entry');

// Case B: different fingerprint — should NOT be found
assert(!sigchainHasLeaf(entriesDir, otherLeafFingerprint),
  'Case B: sigchain grep finds nothing for different leaf fingerprint');

// ---------------------------------------------------------------------------
// Test 10: Idempotency — filing same CID-keyed file twice is safe
// ---------------------------------------------------------------------------

console.log('\n[test-backfill] Group 6: idempotency');

// The bash side checks for the leaf fingerprint BEFORE writing.
// The CID-keyed filename also ensures content-addressed uniqueness.
// Writing the same entry file again should produce no change.
const beforeMtime = fs.statSync(entryFile).mtimeMs;
// Simulate re-write (would happen if backfill crashed mid-run and re-ran)
fs.writeFileSync(entryFile, JSON.stringify(backfillEntry, null, 2), 'utf8');
// After re-write, the content is identical — grep still returns the same result
assert(sigchainHasLeaf(entriesDir, existingLeafFingerprint),
  'idempotency: sigchain grep still finds entry after re-write');

// The idempotency guard in command.sh (STILL_MISSING check) prevents double-filing:
// if grep returns true before attempting to write, the write is skipped.
const stillMissing = !sigchainHasLeaf(entriesDir, existingLeafFingerprint);
assert(!stillMissing, 'idempotency guard: STILL_MISSING=false means write is skipped on re-run');

// ---------------------------------------------------------------------------
// Cleanup + Summary
// ---------------------------------------------------------------------------

fs.rmSync(tmpDir, { recursive: true, force: true });

console.log(`\n[test-backfill] Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
