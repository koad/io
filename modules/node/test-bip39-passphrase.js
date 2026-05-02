// test-bip39-passphrase.js — PBKDF2 path for --bip39-passphrase in ceremony.js
//
// Tests:
//   1. Trezor vector 1 — 12-word mnemonic + 'TREZOR' passphrase → known seed bytes
//   2. Trezor vector 2 — 12-word zoo mnemonic + 'TREZOR' passphrase → known seed bytes
//   3. Same mnemonic + different passphrases → different 32-byte seeds
//   4. Same mnemonic + different passphrases → different fingerprints (via buildMasterKeyManager)
//   5. Same mnemonic + same passphrase → same fingerprint (determinism)
//   6. Same mnemonic + no passphrase: mnemonicToSeedBip39(m,'') ≠ mnemonicToSeed(m) (paths are distinct)
//   7. Empty string passphrase is valid (not rejected)
//   8. Non-string passphrase is rejected
//   9. Empty mnemonic is rejected
//
// Run: node modules/node/test-bip39-passphrase.js

import {
  mnemonicToSeed,
  mnemonicToSeedBip39,
  buildMasterKeyManager,
  extractKMInfo,
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

async function assertThrows(fn, label) {
  try {
    await fn();
    console.error(`  FAIL: ${label} (did not throw)`);
    failed++;
  } catch (_) {
    console.log(`  PASS: ${label}`);
    passed++;
  }
}

async function run() {
  console.log('\n=== BIP39 PBKDF2 passphrase path tests ===\n');

  // -------------------------------------------------------------------------
  // Test 1: Trezor vector 1 — 12-word + 'TREZOR'
  // -------------------------------------------------------------------------
  console.log('1. Trezor vector 1 — abandon×11 about + TREZOR passphrase');
  const m1 = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
  const s1 = mnemonicToSeedBip39(m1, 'TREZOR');
  assert(Buffer.isBuffer(s1), 'returns a Buffer');
  assert(s1.length === 32, '32 bytes returned');
  // First 32 bytes of the known 64-byte PBKDF2 output from BIP39 test vectors
  // Full 64: c55257c360c07c72029aebc1b53c05ed0362ada38ead3e3e9efa3708e53495531f09a6987599d18264c1e1c92f2cf141630c7a3c4ab7c81b2f001698e7463b04
  const expected1 = 'c55257c360c07c72029aebc1b53c05ed0362ada38ead3e3e9efa3708e5349553';
  const actual1 = s1.toString('hex');
  assert(actual1 === expected1, `seed matches Trezor vector 1 (${actual1.slice(0, 16)}...)`);

  // -------------------------------------------------------------------------
  // Test 2: Trezor vector 2 — zoo×11 wrong + 'TREZOR'
  // -------------------------------------------------------------------------
  console.log('\n2. Trezor vector 2 — zoo×11 wrong + TREZOR passphrase');
  const m2 = 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong';
  const s2 = mnemonicToSeedBip39(m2, 'TREZOR');
  assert(s2.length === 32, '32 bytes returned');
  // Full 64: ac27495480225222079d7be181583751e86f571027b0497b5b5d11218e0a8a13332572917f0f8e5a589620c6f15b11c61dee327651a14c34e18231052e48c069
  const expected2 = 'ac27495480225222079d7be181583751e86f571027b0497b5b5d11218e0a8a13';
  const actual2 = s2.toString('hex');
  assert(actual2 === expected2, `seed matches Trezor vector 2 (${actual2.slice(0, 16)}...)`);

  // -------------------------------------------------------------------------
  // Test 3: Different passphrases → different seeds
  // -------------------------------------------------------------------------
  console.log('\n3. Different passphrases → different seeds');
  // Use a 24-word mnemonic for tests 3+ since buildMasterKeyManager needs 32-byte seeds.
  // 12-word mnemonics produce 16-byte raw entropy; 24-word → 32 bytes.
  // The PBKDF2 path always produces 32 bytes regardless, but mnemonicToSeed(12-word) = 16 bytes.
  const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art';
  const seedA = mnemonicToSeedBip39(mnemonic, 'passphrase-alpha');
  const seedB = mnemonicToSeedBip39(mnemonic, 'passphrase-beta');
  assert(!seedA.equals(seedB), 'seedA ≠ seedB for different passphrases');

  // -------------------------------------------------------------------------
  // Test 4: Different passphrases → different fingerprints
  // -------------------------------------------------------------------------
  console.log('\n4. Different passphrases → different fingerprints (buildMasterKeyManager)');
  const userid = 'test <test@test.com>';
  const kmA = await buildMasterKeyManager(seedA, userid);
  const kmB = await buildMasterKeyManager(seedB, userid);
  const { fingerprint: fpA } = await extractKMInfo(kmA);
  const { fingerprint: fpB } = await extractKMInfo(kmB);
  assert(fpA !== fpB, `fingerprints differ: ${fpA.slice(0, 8)} vs ${fpB.slice(0, 8)}`);

  // -------------------------------------------------------------------------
  // Test 5: Same mnemonic + same passphrase → same fingerprint (determinism)
  // -------------------------------------------------------------------------
  console.log('\n5. Determinism — same mnemonic + same passphrase → same fingerprint');
  const seedC1 = mnemonicToSeedBip39(mnemonic, 'consistent-passphrase');
  const seedC2 = mnemonicToSeedBip39(mnemonic, 'consistent-passphrase');
  assert(seedC1.equals(seedC2), 'seeds are identical');
  const kmC1 = await buildMasterKeyManager(seedC1, userid);
  const kmC2 = await buildMasterKeyManager(seedC2, userid);
  const { fingerprint: fpC1 } = await extractKMInfo(kmC1);
  const { fingerprint: fpC2 } = await extractKMInfo(kmC2);
  assert(fpC1 === fpC2, `fingerprints match: ${fpC1.slice(0, 8)}...`);

  // -------------------------------------------------------------------------
  // Test 6: PBKDF2 path with '' ≠ raw-entropy path (paths are intentionally distinct)
  // -------------------------------------------------------------------------
  console.log('\n6. PBKDF2 path (passphrase="") produces different seed than raw-entropy path');
  const seedRaw   = mnemonicToSeed(mnemonic);         // raw entropy, 32 bytes
  const seedPbkdf = mnemonicToSeedBip39(mnemonic, ''); // PBKDF2 with empty passphrase, 32 bytes
  assert(!seedRaw.equals(seedPbkdf), 'mnemonicToSeed(m) ≠ mnemonicToSeedBip39(m, "")');
  // The raw path returns 32-byte entropy; the PBKDF2 path returns first 32 of 64-byte PBKDF2 output
  // Confirm different KM fingerprints too
  const kmRaw   = await buildMasterKeyManager(seedRaw, userid);
  const kmPbkdf = await buildMasterKeyManager(seedPbkdf, userid);
  const { fingerprint: fpRaw }   = await extractKMInfo(kmRaw);
  const { fingerprint: fpPbkdf } = await extractKMInfo(kmPbkdf);
  assert(fpRaw !== fpPbkdf, `raw fp (${fpRaw.slice(0,8)}) ≠ pbkdf2 fp (${fpPbkdf.slice(0,8)})`);

  // -------------------------------------------------------------------------
  // Test 7: Empty string passphrase is valid
  // -------------------------------------------------------------------------
  console.log('\n7. Empty string passphrase is accepted');
  let threw = false;
  try {
    mnemonicToSeedBip39(mnemonic, '');
  } catch (_) {
    threw = true;
  }
  assert(!threw, 'mnemonicToSeedBip39(mnemonic, "") does not throw');

  // -------------------------------------------------------------------------
  // Test 8: Non-string passphrase is rejected
  // -------------------------------------------------------------------------
  console.log('\n8. Non-string passphrase is rejected');
  await assertThrows(
    () => Promise.resolve(mnemonicToSeedBip39(mnemonic, 12345)),
    'throws on numeric passphrase',
  );
  await assertThrows(
    () => Promise.resolve(mnemonicToSeedBip39(mnemonic, null)),
    'throws on null passphrase',
  );

  // -------------------------------------------------------------------------
  // Test 9: Empty mnemonic is rejected
  // -------------------------------------------------------------------------
  console.log('\n9. Empty mnemonic is rejected');
  await assertThrows(
    () => Promise.resolve(mnemonicToSeedBip39('', 'somepass')),
    'throws on empty mnemonic',
  );

  // -------------------------------------------------------------------------
  // Results
  // -------------------------------------------------------------------------
  console.log('\n=== Results ===');
  console.log(`Passed: ${passed} / Failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('[test-bip39-passphrase] Unhandled error:', err);
  process.exit(1);
});
