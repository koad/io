// test-identity-loader.js — Tests for src/library/identity-loader.js
//
// Run: node /home/koad/.koad-io/desktop/test-identity-loader.js
//
// Test cases:
//   1.  No leaf file  — returns {loaded: false, reason: 'no-leaf-file'}
//   2.  No vesta record — returns {loaded: false, reason: 'no-vesta-record'}
//   3.  Happy path: encrypt+persist → load+decrypt → fingerprint round-trips
//   4.  Wrong device.key fails to decrypt (reason: 'decrypt-failed')
//   5.  Missing leaf.private.asc → graceful 'no-leaf-file'
//   6.  Missing device.key → graceful 'no-device-key'
//   7.  Both files present + match → loaded=true with correct fingerprints
//   8.  persistLeafToDisk preserves existing device.key on re-persist
//   9.  persistLeafToDisk rotates device.key when rotateDeviceKey=true
//
// Uses os.tmpdir() for fixture paths and cleans up after each test.
// kbpgp operations take a few seconds — normal.
//
// IMPORTANT: kbpgp KeyManagers are STATEFUL — calling encryptLeafForStorage
// twice on the same KM with different passphrases corrupts subsequent decryption.
// Each test that calls persistLeafToDisk generates its own fresh KM.

'use strict';

const path = require('path');
const os   = require('os');
const fs   = require('fs');

const { loadIdentityFromDisk, persistLeafToDisk } = require('./src/library/identity-loader');

// ---------------------------------------------------------------------------
// Minimal test harness
// ---------------------------------------------------------------------------

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

function mkTmpDir(suffix) {
  const dir = path.join(os.tmpdir(), `vulcan-identity-loader-test-${suffix}-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function rmDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// Write a file, creating parent dirs as needed.
function writeFile(filePath, content, mode) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, { encoding: 'utf8', mode: mode || 0o644 });
}

// Build a complete vesta sigchain fixture for a handle.
function writeVestaFixture(vestaDir, handle, masterFP, masterPub, sigchainHeadCID) {
  const sigchainDir = path.join(vestaDir, 'entities', handle, 'sigchain');
  writeFile(path.join(sigchainDir, 'master.pub.asc'), masterPub);
  writeFile(path.join(sigchainDir, 'metadata.json'), JSON.stringify({
    masterFingerprint: masterFP,
    sigchainHeadCID: sigchainHeadCID || 'baguzsomecid-test',
    sigchainHeadUpdated: '2026-04-26T05:00:00Z',
  }, null, 2));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function run() {
  console.log('\n=== identity-loader.js test suite (SPEC-149 v1.3 §8.1) ===\n');

  // Load ceremony helpers (ESM — must use dynamic import from CJS context)
  const ceremony = await import('/home/koad/.koad-io/modules/node/ceremony.js');
  const {
    buildLeafKeyManager,
    buildMasterKeyManager,
    generateEntropySync,
    mnemonicToSeed,
    entropyToMnemonicString,
    extractKMInfo,
    generateDeviceKey,
    encryptLeafForStorage,
  } = ceremony;

  // Shared: handle + userid + master key material (master only exports pubkey → no mutation)
  const handle = 'vulcan-test';
  const userid = `${handle} <${handle}@test.local>`;

  console.log('  [setup] Generating master KeyManager (shared across tests)...');
  const entropy    = generateEntropySync();
  const mnemonic   = entropyToMnemonicString(entropy);
  const masterSeed = mnemonicToSeed(mnemonic);
  const masterKM   = await buildMasterKeyManager(masterSeed, userid);
  const { fingerprint: masterFP, publicKey: masterPub } = await extractKMInfo(masterKM);
  console.log(`  [setup] master fp: ${masterFP.slice(0, 16)}...`);

  // NOTE: each test that calls persistLeafToDisk or encryptLeafForStorage
  // generates its own fresh leafKM. kbpgp KeyManagers are mutated by
  // export_pgp_private (passphrase is set in-place), making subsequent
  // encrypt calls with different passphrases produce unreadable ciphertext.

  // -------------------------------------------------------------------------
  // Test 1: No leaf file
  // -------------------------------------------------------------------------
  console.log('\n1. No leaf file — should return {loaded: false, reason: "no-leaf-file"}');
  {
    const tmpEntity = mkTmpDir('t1-noleaf');
    try {
      const result = await loadIdentityFromDisk({ entityDir: tmpEntity, handle: 'test-noleaf' });
      assert(result.loaded === false, 'loaded is false');
      assert(result.reason === 'no-leaf-file', `reason is 'no-leaf-file' (got: ${result.reason})`);
      assert(typeof result.error === 'string' && result.error.length > 0, 'error message present');
    } finally {
      rmDir(tmpEntity);
    }
  }

  // -------------------------------------------------------------------------
  // Test 2: No vesta record (leaf file present, but no vesta sigchain dir)
  // -------------------------------------------------------------------------
  console.log('\n2. No vesta record — should return {loaded: false, reason: "no-vesta-record"}');
  {
    const tmpEntity = mkTmpDir('t2-novesta');
    const tmpVesta  = mkTmpDir('t2-vesta-empty');
    const origVesta = process.env.KOAD_VESTA_DIR;
    process.env.KOAD_VESTA_DIR = tmpVesta;

    try {
      // Fresh KM for this test — avoids kbpgp mutation issue
      const km2 = await buildLeafKeyManager(userid);
      const deviceKey = generateDeviceKey();
      const stubArmored = await encryptLeafForStorage(km2, deviceKey);
      writeFile(path.join(tmpEntity, 'id', 'leaf.private.asc'), stubArmored, 0o600);
      writeFile(path.join(tmpEntity, 'id', 'device.key'), deviceKey, 0o600);

      const result = await loadIdentityFromDisk({ entityDir: tmpEntity, handle: 'test-novesta' });
      assert(result.loaded === false, 'loaded is false');
      assert(result.reason === 'no-vesta-record', `reason is 'no-vesta-record' (got: ${result.reason})`);
      assert(typeof result.error === 'string' && result.error.length > 0, 'error message present');
    } finally {
      process.env.KOAD_VESTA_DIR = origVesta;
      rmDir(tmpEntity);
      rmDir(tmpVesta);
    }
  }

  // -------------------------------------------------------------------------
  // Test 3: Happy path — persistLeafToDisk then loadIdentityFromDisk
  //         fingerprints must survive the encrypt → persist → decrypt round-trip
  // -------------------------------------------------------------------------
  console.log('\n3. Happy path — encrypt+persist → load+decrypt → fingerprint round-trips');
  {
    const tmpEntity = mkTmpDir('t3-happy');
    const tmpVesta  = mkTmpDir('t3-vesta');
    const origVesta = process.env.KOAD_VESTA_DIR;
    process.env.KOAD_VESTA_DIR = tmpVesta;

    try {
      // Fresh KM for this test
      const km3 = await buildLeafKeyManager(userid);
      const { fingerprint: leafFP } = await extractKMInfo(km3);
      console.log(`   leaf fp: ${leafFP.slice(0, 16)}...`);

      // Persist leaf to disk
      const persistResult = await persistLeafToDisk({ entityDir: tmpEntity, keyManager: km3 });
      assert(persistResult.written === true, `persistLeafToDisk written=true (err: ${persistResult.error})`);
      assert(fs.existsSync(persistResult.leafPath), 'leaf.private.asc exists on disk');
      assert(fs.existsSync(persistResult.devicePath), 'device.key exists on disk');

      // Check file modes
      const leafStat = fs.statSync(persistResult.leafPath);
      const devStat  = fs.statSync(persistResult.devicePath);
      assert((leafStat.mode & 0o777) === 0o600, `leaf.private.asc mode is 0o600 (got 0o${(leafStat.mode & 0o777).toString(8)})`);
      assert((devStat.mode  & 0o777) === 0o600, `device.key mode is 0o600 (got 0o${(devStat.mode  & 0o777).toString(8)})`);

      // Write vesta fixture
      writeVestaFixture(tmpVesta, handle, masterFP, masterPub);

      // Load identity from disk
      const result = await loadIdentityFromDisk({ entityDir: tmpEntity, handle });

      assert(result.loaded === true, `loaded is true (err: ${result.error})`);
      assert(result.handle === handle, `handle matches (got: ${result.handle})`);
      assert(typeof result.masterFingerprint === 'string', 'masterFingerprint present');
      assert(typeof result.leafFingerprint === 'string', 'leafFingerprint present');
      assert(
        result.masterFingerprint.replace(/\s/g,'').toUpperCase() === masterFP.replace(/\s/g,'').toUpperCase(),
        'masterFingerprint matches fixture'
      );
      assert(
        result.leafFingerprint.replace(/\s/g,'').toUpperCase() === leafFP.replace(/\s/g,'').toUpperCase(),
        `leafFingerprint round-trips correctly (expected: ${leafFP.slice(0,16)}... got: ${(result.leafFingerprint||'').slice(0,16)}...)`
      );
      assert(result.keyManager && typeof result.keyManager === 'object', 'keyManager returned in result');

    } finally {
      process.env.KOAD_VESTA_DIR = origVesta;
      rmDir(tmpEntity);
      rmDir(tmpVesta);
    }
  }

  // -------------------------------------------------------------------------
  // Test 4: Wrong device.key fails to decrypt
  // -------------------------------------------------------------------------
  console.log('\n4. Wrong device.key — should return {loaded: false, reason: "decrypt-failed"}');
  {
    const tmpEntity = mkTmpDir('t4-wrongkey');
    const tmpVesta  = mkTmpDir('t4-vesta');
    const origVesta = process.env.KOAD_VESTA_DIR;
    process.env.KOAD_VESTA_DIR = tmpVesta;

    try {
      // Fresh KM for this test
      const km4 = await buildLeafKeyManager(userid);

      // Persist leaf with correct key
      const persistResult = await persistLeafToDisk({ entityDir: tmpEntity, keyManager: km4 });
      assert(persistResult.written === true, 'leaf persisted for wrong-key test');

      // Overwrite device.key with a different random key
      const wrongKey = generateDeviceKey();
      writeFile(persistResult.devicePath, wrongKey, 0o600);

      writeVestaFixture(tmpVesta, handle, masterFP, masterPub);

      const result = await loadIdentityFromDisk({ entityDir: tmpEntity, handle });
      assert(result.loaded === false, 'loaded is false with wrong device key');
      assert(result.reason === 'decrypt-failed', `reason is 'decrypt-failed' (got: ${result.reason})`);
      assert(typeof result.error === 'string' && result.error.length > 0, 'error message present');

    } finally {
      process.env.KOAD_VESTA_DIR = origVesta;
      rmDir(tmpEntity);
      rmDir(tmpVesta);
    }
  }

  // -------------------------------------------------------------------------
  // Test 5: Missing leaf.private.asc → graceful 'no-leaf-file'
  //         (device.key present, but leaf is missing)
  // -------------------------------------------------------------------------
  console.log('\n5. Missing leaf.private.asc → graceful "no-leaf-file"');
  {
    const tmpEntity = mkTmpDir('t5-noleaf2');
    const tmpVesta  = mkTmpDir('t5-vesta');
    const origVesta = process.env.KOAD_VESTA_DIR;
    process.env.KOAD_VESTA_DIR = tmpVesta;

    try {
      // Write only device.key, not the leaf
      const deviceKey = generateDeviceKey();
      writeFile(path.join(tmpEntity, 'id', 'device.key'), deviceKey, 0o600);
      writeVestaFixture(tmpVesta, handle, masterFP, masterPub);

      const result = await loadIdentityFromDisk({ entityDir: tmpEntity, handle });
      assert(result.loaded === false, 'loaded is false');
      assert(result.reason === 'no-leaf-file', `reason is 'no-leaf-file' (got: ${result.reason})`);

    } finally {
      process.env.KOAD_VESTA_DIR = origVesta;
      rmDir(tmpEntity);
      rmDir(tmpVesta);
    }
  }

  // -------------------------------------------------------------------------
  // Test 6: Missing device.key → graceful 'no-device-key'
  // -------------------------------------------------------------------------
  console.log('\n6. Missing device.key → graceful "no-device-key"');
  {
    const tmpEntity = mkTmpDir('t6-nodevkey');
    const tmpVesta  = mkTmpDir('t6-vesta');
    const origVesta = process.env.KOAD_VESTA_DIR;
    process.env.KOAD_VESTA_DIR = tmpVesta;

    try {
      // Fresh KM for this test
      const km6 = await buildLeafKeyManager(userid);

      // Persist leaf normally (creates device.key + leaf.private.asc)
      const persistResult = await persistLeafToDisk({ entityDir: tmpEntity, keyManager: km6 });
      assert(persistResult.written === true, 'leaf persisted for no-device-key test');

      // Remove device.key
      fs.unlinkSync(persistResult.devicePath);

      writeVestaFixture(tmpVesta, handle, masterFP, masterPub);

      const result = await loadIdentityFromDisk({ entityDir: tmpEntity, handle });
      assert(result.loaded === false, 'loaded is false');
      assert(result.reason === 'no-device-key', `reason is 'no-device-key' (got: ${result.reason})`);

    } finally {
      process.env.KOAD_VESTA_DIR = origVesta;
      rmDir(tmpEntity);
      rmDir(tmpVesta);
    }
  }

  // -------------------------------------------------------------------------
  // Test 7: Both files present + match → loaded=true with correct fingerprints
  //         (independent KM, confirms full flow with distinct fingerprint)
  // -------------------------------------------------------------------------
  console.log('\n7. Both files present + match → loaded=true with correct fingerprints');
  {
    const tmpEntity = mkTmpDir('t7-both');
    const tmpVesta  = mkTmpDir('t7-vesta');
    const origVesta = process.env.KOAD_VESTA_DIR;
    process.env.KOAD_VESTA_DIR = tmpVesta;

    try {
      // Fresh KM for this test
      const km7 = await buildLeafKeyManager(userid);
      const { fingerprint: leafFP7 } = await extractKMInfo(km7);

      const persistResult = await persistLeafToDisk({ entityDir: tmpEntity, keyManager: km7 });
      assert(persistResult.written === true, 'leaf7 persisted');

      writeVestaFixture(tmpVesta, handle, masterFP, masterPub);

      const result = await loadIdentityFromDisk({ entityDir: tmpEntity, handle });
      assert(result.loaded === true, `loaded is true`);
      assert(
        result.leafFingerprint.replace(/\s/g,'').toUpperCase() === leafFP7.replace(/\s/g,'').toUpperCase(),
        `leafFingerprint matches km7 (expected: ${leafFP7.slice(0,16)}... got: ${(result.leafFingerprint||'').slice(0,16)}...)`
      );
      assert(
        result.masterFingerprint.replace(/\s/g,'').toUpperCase() === masterFP.replace(/\s/g,'').toUpperCase(),
        'masterFingerprint matches'
      );

    } finally {
      process.env.KOAD_VESTA_DIR = origVesta;
      rmDir(tmpEntity);
      rmDir(tmpVesta);
    }
  }

  // -------------------------------------------------------------------------
  // Test 8: persistLeafToDisk preserves existing device.key on re-persist
  // -------------------------------------------------------------------------
  console.log('\n8. persistLeafToDisk preserves existing device.key on re-persist');
  {
    const tmpEntity = mkTmpDir('t8-preserve-devkey');
    try {
      // Fresh KM for first persist
      const km8 = await buildLeafKeyManager(userid);
      const r1 = await persistLeafToDisk({ entityDir: tmpEntity, keyManager: km8 });
      assert(r1.written === true, 'first persist succeeded');
      const devKey1 = fs.readFileSync(r1.devicePath, 'utf8').trim();

      // Re-persist the SAME KM (same passphrase used internally — no mutation on re-export
      // with same key because we preserve the device key from disk, so no second encrypt call)
      // The preserve path reads device.key from disk and skips generateDeviceKey().
      const r2 = await persistLeafToDisk({ entityDir: tmpEntity, keyManager: km8 });
      assert(r2.written === true, 're-persist succeeded');
      const devKey2 = fs.readFileSync(r2.devicePath, 'utf8').trim();

      assert(devKey1 === devKey2, `device.key preserved on re-persist (key1 starts: ${devKey1.slice(0,8)}...)`);

    } finally {
      rmDir(tmpEntity);
    }
  }

  // -------------------------------------------------------------------------
  // Test 9: persistLeafToDisk rotates device.key when rotateDeviceKey=true
  // -------------------------------------------------------------------------
  console.log('\n9. persistLeafToDisk rotates device.key when rotateDeviceKey=true');
  {
    const tmpEntity = mkTmpDir('t9-rotate-devkey');
    try {
      // Fresh KM for first persist
      const km9a = await buildLeafKeyManager(userid);
      const r1 = await persistLeafToDisk({ entityDir: tmpEntity, keyManager: km9a });
      assert(r1.written === true, 'first persist succeeded');
      const devKey1 = fs.readFileSync(r1.devicePath, 'utf8').trim();

      // Rotate with a FRESH KM (rotateDeviceKey path generates new key and re-encrypts)
      const km9b = await buildLeafKeyManager(userid);
      const r2 = await persistLeafToDisk({ entityDir: tmpEntity, keyManager: km9b, rotateDeviceKey: true });
      assert(r2.written === true, 'rotated persist succeeded');
      const devKey2 = fs.readFileSync(r2.devicePath, 'utf8').trim();

      assert(devKey1 !== devKey2, `device.key rotated (key1 != key2)`);
      assert(devKey2.length === 64, `rotated key is 64 hex chars (got: ${devKey2.length})`);

    } finally {
      rmDir(tmpEntity);
    }
  }

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
}

run().catch(function(err) {
  console.error('\nTest runner threw:', err);
  process.exit(1);
});
