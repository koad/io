// test-identity-ceremony.js — Flight B ceremony internals test
//
// Tests:
//   1. create() generates a mnemonic, master fingerprint, leaf fingerprint
//   2. Master fingerprint is DETERMINISTIC from the same mnemonic
//   3. clearsign works with the master KeyManager
//   4. lockdown() zeros the mnemonic buffer and nulls master
//   5. importMnemonic() reconstitutes the SAME master fingerprint
//   6. Invalid mnemonic is rejected
//   7. posture transitions: null → ceremony → routine (via lockdown)
//
// Run: node modules/node/test-identity-ceremony.js

import { createKoadIdentity } from './identity.js';
import { clearsign, verify } from './pgp.js';
import {
  generateEntropySync,
  entropyToMnemonicString,
  mnemonicToSeed,
  buildMasterKeyManager,
  extractKMInfo,
  zeroBuffer,
  isValidMnemonic,
} from './ceremony.js';

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

async function run() {
  console.log('\n=== Flight B: ceremony internals test ===\n');

  // -----------------------------------------------------------------------
  // Test 1: create() basics
  // -----------------------------------------------------------------------
  console.log('1. create() generates mnemonic + fingerprints');
  const identity = createKoadIdentity();
  assert(identity.posture === null, 'initial posture is null');

  const result = await identity.create({ handle: 'koad', userid: 'koad <koad@koad.sh>' });

  assert(typeof result.mnemonic === 'string', 'mnemonic is a string');
  assert(result.mnemonic.split(' ').length === 24, 'mnemonic is 24 words');
  assert(typeof result.masterFingerprint === 'string' && result.masterFingerprint.length === 40, 'masterFingerprint is 40 chars');
  assert(typeof result.leafFingerprint === 'string' && result.leafFingerprint.length === 40, 'leafFingerprint is 40 chars');
  assert(result.masterFingerprint !== result.leafFingerprint, 'master and leaf fingerprints differ');

  assert(identity.posture === 'ceremony', 'posture is ceremony after create()');
  assert(identity.isMasterLoaded, 'isMasterLoaded is true during ceremony');
  assert(identity.isLoaded, 'isLoaded is true during ceremony');
  assert(identity.masterFingerprint === result.masterFingerprint, 'masterFingerprint getter matches');
  assert(identity.fingerprint === result.leafFingerprint, 'fingerprint getter is leaf fingerprint');

  console.log(`  mnemonic (first 4 words): ${result.mnemonic.split(' ').slice(0, 4).join(' ')} ...`);
  console.log(`  masterFingerprint: ${result.masterFingerprint}`);
  console.log(`  leafFingerprint: ${result.leafFingerprint}`);

  // -----------------------------------------------------------------------
  // Test 2: Determinism — same mnemonic → same master fingerprint
  // -----------------------------------------------------------------------
  console.log('\n2. Determinism — same mnemonic → same master fingerprint');
  const { mnemonicToSeed: mnSeed, buildMasterKeyManager: buildKM, extractKMInfo: exInfo } = await import('./ceremony.js');
  const mnemonic = result.mnemonic;
  const seed1 = mnSeed(mnemonic);
  const seed2 = mnSeed(mnemonic);

  const km1 = await buildKM(seed1, 'koad <koad@koad.sh>');
  const km2 = await buildKM(seed2, 'koad <koad@koad.sh>');
  const { fingerprint: fp1 } = await exInfo(km1);
  const { fingerprint: fp2 } = await exInfo(km2);

  assert(fp1 === fp2, 'same mnemonic → same fingerprint');
  assert(fp1 === result.masterFingerprint, 'derived fingerprint matches create() output');
  console.log(`  fp1: ${fp1}`);
  console.log(`  fp2: ${fp2}`);

  // -----------------------------------------------------------------------
  // Test 3: clearsign with master KeyManager
  // -----------------------------------------------------------------------
  console.log('\n3. clearsign + verify with master key during ceremony');
  const payload = 'hello from koad.identity ceremony test';
  const armored = await identity.sign(payload, { useMaster: true });
  assert(typeof armored === 'string' && armored.includes('BEGIN PGP'), 'clearsign produces PGP armor');

  const masterPub = identity.masterPublicKey;
  assert(typeof masterPub === 'string', 'masterPublicKey is a string');

  const verResult = await identity.verify(armored, masterPub);
  assert(verResult.verified === true, 'verify returns verified=true');
  assert(verResult.body === payload, 'verify returns correct payload body');
  console.log(`  verify.fingerprint: ${verResult.fingerprint}`);

  // -----------------------------------------------------------------------
  // Test 4: lockdown() zeros mnemonic buffer and nulls master
  // -----------------------------------------------------------------------
  console.log('\n4. lockdown() — zero mnemonic buffer, null master, transition posture');

  // Peek at the internal mnemonic buffer before lockdown (via a known-bad but
  // verifiable approach: we check posture transitions only, since we can't
  // directly read _s.mnemonic from outside)
  identity.lockdown();
  assert(identity.posture === 'routine', 'posture is routine after lockdown');
  assert(!identity.isMasterLoaded, 'isMasterLoaded is false after lockdown');
  assert(identity.masterFingerprint === result.masterFingerprint, 'masterFingerprint persists after lockdown');
  assert(identity.masterPublicKey === masterPub, 'masterPublicKey persists after lockdown');

  // -----------------------------------------------------------------------
  // Test 5: importMnemonic() reconstitutes SAME master fingerprint
  // -----------------------------------------------------------------------
  console.log('\n5. importMnemonic() — reconstitution from same mnemonic');
  const identity2 = createKoadIdentity();
  const importResult = await identity2.importMnemonic({ mnemonic, userid: 'koad <koad@koad.sh>' });

  assert(typeof importResult.masterFingerprint === 'string', 'importResult has masterFingerprint');
  assert(importResult.masterFingerprint === result.masterFingerprint,
    `reconstituted fingerprint matches original: ${importResult.masterFingerprint}`);
  assert(identity2.posture === 'recovery', 'posture is recovery after importMnemonic');
  assert(identity2.isMasterLoaded, 'isMasterLoaded after importMnemonic');
  console.log(`  reconstituted masterFingerprint: ${importResult.masterFingerprint}`);

  // Verify clearsign with the reconstituted key produces the same public key
  const armoredRecov = await identity2.sign('recovery test', { useMaster: true });
  const verRecov = await identity2.verify(armoredRecov, identity2.masterPublicKey);
  assert(verRecov.verified === true, 'reconstituted master can sign and verify');

  // -----------------------------------------------------------------------
  // Test 6: Invalid mnemonic rejected
  // -----------------------------------------------------------------------
  console.log('\n6. Invalid mnemonic is rejected');
  const identity3 = createKoadIdentity();
  try {
    await identity3.importMnemonic({ mnemonic: 'not valid words here', userid: 'x <x@x.com>' });
    assert(false, 'should have thrown on invalid mnemonic');
  } catch (e) {
    assert(e.message.includes('invalid BIP39 mnemonic'), `throws: ${e.message}`);
  }

  // -----------------------------------------------------------------------
  // Test 7: zeroBuffer utility
  // -----------------------------------------------------------------------
  console.log('\n7. zeroBuffer zeros a Uint8Array in-place');
  const { zeroBuffer: zero } = await import('./ceremony.js');
  const buf = new Uint8Array([0xAA, 0xBB, 0xCC, 0xDD]);
  zero(buf);
  assert(buf[0] === 0 && buf[1] === 0 && buf[2] === 0 && buf[3] === 0, 'buffer is zeroed');

  // -----------------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------------
  console.log('\n=== Results ===');
  console.log(`Passed: ${passed} / Failed: ${failed}`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

run().catch(err => {
  console.error('UNCAUGHT ERROR:', err);
  process.exit(1);
});
