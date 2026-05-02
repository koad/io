// test-leaf-storage.js — VESTA-SPEC-149 v1.3 §8.1 leaf at-rest encryption tests
//
// Tests:
//   1. generateDeviceKey() produces a unique 64-char hex string
//   2. generateDeviceKey() produces different values each call (uniqueness)
//   3. encryptLeafForStorage() → decryptLeafFromStorage() round-trip recovers same fingerprint
//   4. Wrong passphrase fails to decrypt
//   5. Malformed armored input fails gracefully
//   6. Empty passphrase is rejected (SPEC-149 §8.1.1 no-plaintext prohibition)
//
// Run: node modules/node/test-leaf-storage.js

import { buildLeafKeyManager, extractKMInfo, generateDeviceKey, encryptLeafForStorage, decryptLeafFromStorage } from './ceremony.js';

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
  console.log('\n=== SPEC-149 §8.1: leaf at-rest encryption tests ===\n');

  // -----------------------------------------------------------------------
  // Test 1: generateDeviceKey produces 64-char hex
  // -----------------------------------------------------------------------
  console.log('1. generateDeviceKey() produces unique 64-char hex');
  const dk1 = generateDeviceKey();
  assert(typeof dk1 === 'string', 'result is a string');
  assert(dk1.length === 64, `length is 64 (got ${dk1.length})`);
  assert(/^[0-9a-f]+$/.test(dk1), 'result is lowercase hex');
  console.log(`  device key (first 16 chars): ${dk1.slice(0, 16)}...`);

  // Test 2: uniqueness
  console.log('\n2. generateDeviceKey() produces unique values each call');
  const dk2 = generateDeviceKey();
  const dk3 = generateDeviceKey();
  assert(dk1 !== dk2, 'first and second keys differ');
  assert(dk2 !== dk3, 'second and third keys differ');
  assert(dk1 !== dk3, 'first and third keys differ');

  // -----------------------------------------------------------------------
  // Test 3: encrypt → decrypt round-trip recovers same fingerprint
  // -----------------------------------------------------------------------
  console.log('\n3. encryptLeafForStorage → decryptLeafFromStorage round-trip');
  const userid = 'leaf-test <leaf-test@kingofalldata.com>';
  const leafKM = await buildLeafKeyManager(userid);
  const { fingerprint: originalFp } = await extractKMInfo(leafKM);
  assert(typeof originalFp === 'string' && originalFp.length === 40, `leaf fingerprint is 40-char hex: ${originalFp}`);
  console.log(`  original leaf fingerprint: ${originalFp}`);

  const deviceKey = generateDeviceKey();
  const armored = await encryptLeafForStorage(leafKM, deviceKey);
  assert(typeof armored === 'string', 'encrypted output is a string');
  assert(armored.includes('BEGIN PGP PRIVATE KEY BLOCK'), 'output contains PGP PRIVATE KEY BLOCK header');
  assert(armored.includes('END PGP PRIVATE KEY BLOCK'), 'output contains PGP PRIVATE KEY BLOCK footer');
  console.log(`  encrypted block length: ${armored.length} chars`);

  const decryptedKM = await decryptLeafFromStorage(armored, deviceKey);
  const { fingerprint: recoveredFp } = await extractKMInfo(decryptedKM);
  assert(recoveredFp === originalFp, `round-trip recovers same fingerprint: ${recoveredFp}`);
  console.log(`  recovered fingerprint: ${recoveredFp}`);

  // -----------------------------------------------------------------------
  // Test 4: Wrong passphrase fails to decrypt
  // -----------------------------------------------------------------------
  console.log('\n4. Wrong passphrase fails to decrypt');
  const wrongKey = generateDeviceKey();
  assert(wrongKey !== deviceKey, 'sanity: wrong key differs from correct key');

  let wrongPassFailed = false;
  try {
    await decryptLeafFromStorage(armored, wrongKey);
  } catch (e) {
    wrongPassFailed = true;
    console.log(`  error (expected): ${e.message.slice(0, 80)}`);
  }
  assert(wrongPassFailed, 'wrong passphrase causes decryptLeafFromStorage to throw');

  // -----------------------------------------------------------------------
  // Test 5: Malformed armored input fails gracefully
  // -----------------------------------------------------------------------
  console.log('\n5. Malformed armored input fails gracefully');
  let malformedFailed = false;
  try {
    await decryptLeafFromStorage('not a pgp block at all', deviceKey);
  } catch (e) {
    malformedFailed = true;
    console.log(`  error (expected): ${e.message.slice(0, 80)}`);
  }
  assert(malformedFailed, 'malformed input causes decryptLeafFromStorage to throw');

  // Also test: looks like a block but is corrupted inside
  let corruptFailed = false;
  try {
    const corrupted = armored.replace(/[A-Za-z0-9+/]{4}/, 'XXXX');
    await decryptLeafFromStorage(corrupted, deviceKey);
  } catch (e) {
    corruptFailed = true;
    console.log(`  corrupted block error (expected): ${e.message.slice(0, 80)}`);
  }
  assert(corruptFailed, 'corrupted armored block causes decryptLeafFromStorage to throw');

  // -----------------------------------------------------------------------
  // Test 6: Empty passphrase is rejected (SPEC-149 §8.1.1)
  // -----------------------------------------------------------------------
  console.log('\n6. Empty passphrase rejected (SPEC-149 §8.1.1 no-plaintext prohibition)');
  let emptyEncryptFailed = false;
  try {
    await encryptLeafForStorage(leafKM, '');
  } catch (e) {
    emptyEncryptFailed = true;
    assert(e.message.includes('no-plaintext') || e.message.includes('passphrase'), `throws with relevant message: ${e.message.slice(0, 80)}`);
  }
  assert(emptyEncryptFailed, 'empty passphrase causes encryptLeafForStorage to throw');

  let emptyDecryptFailed = false;
  try {
    await decryptLeafFromStorage(armored, '');
  } catch (e) {
    emptyDecryptFailed = true;
    console.log(`  empty decrypt error (expected): ${e.message.slice(0, 80)}`);
  }
  assert(emptyDecryptFailed, 'empty passphrase causes decryptLeafFromStorage to throw');

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
