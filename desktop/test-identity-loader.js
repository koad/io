// test-identity-loader.js — Tests for src/library/identity-loader.js
//
// Run: node /home/koad/.koad-io/desktop/test-identity-loader.js
//
// Test cases:
//   1. No leaf file  — returns {loaded: false, reason: 'no-leaf-file'}
//   2. No vesta record — returns {loaded: false, reason: 'no-vesta-record'}
//   3. Happy path with unencrypted leaf — fixture generated via ceremony.js
//
// Uses os.tmpdir() for fixture paths and cleans up after each test.
// kbpgp operations take a few seconds — normal.

'use strict';

const path = require('path');
const os   = require('os');
const fs   = require('fs');

const { loadIdentityFromDisk } = require('./src/library/identity-loader');

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
function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function run() {
  console.log('\n=== identity-loader.js test suite ===\n');

  // Load ceremony helpers (ESM — must use dynamic import from CJS context)
  const {
    buildLeafKeyManager,
    buildMasterKeyManager,
    generateEntropySync,
    mnemonicToSeed,
    entropyToMnemonicString,
    extractKMInfo,
  } = await import('/home/koad/.koad-io/modules/node/ceremony.js');

  // -------------------------------------------------------------------------
  // Test 1: No leaf file
  // -------------------------------------------------------------------------
  console.log('1. No leaf file — should return {loaded: false, reason: "no-leaf-file"}');
  {
    const tmpEntity = mkTmpDir('entity-noleaf');
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
    const tmpEntity = mkTmpDir('entity-novesta');
    const tmpVesta  = mkTmpDir('vesta-empty');
    // Override vesta dir via env
    const origVesta = process.env.KOAD_VESTA_DIR;
    process.env.KOAD_VESTA_DIR = tmpVesta;

    try {
      // Write a stub leaf private key (not a valid key — just present on disk)
      writeFile(path.join(tmpEntity, 'id', 'leaf.gpg.asc'), '-----BEGIN PGP PRIVATE KEY BLOCK-----\nstub\n-----END PGP PRIVATE KEY BLOCK-----\n');

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
  // Test 3: Happy path with unencrypted leaf
  // -------------------------------------------------------------------------
  console.log('\n3. Happy path — unencrypted leaf, full fixture');
  {
    const tmpEntity = mkTmpDir('entity-happy');
    const tmpVesta  = mkTmpDir('vesta-happy');
    const origVesta = process.env.KOAD_VESTA_DIR;
    process.env.KOAD_VESTA_DIR = tmpVesta;

    try {
      // Generate a leaf KeyManager (random, unencrypted)
      const handle = 'vulcan-test';
      const userid = `${handle} <${handle}@test.local>`;

      console.log('   Generating leaf KeyManager (may take a moment)...');
      const leafKM = await buildLeafKeyManager(userid);
      const { fingerprint: leafFP, publicKey: leafPub } = await extractKMInfo(leafKM);

      // Export leaf private key as armored PGP
      const leafPrivArmored = await new Promise((resolve, reject) => {
        leafKM.export_pgp_private({}, (err, armor) => {
          if (err) return reject(err);
          resolve(armor);
        });
      });

      // Generate a master KeyManager (deterministic from entropy)
      const entropy = generateEntropySync();
      const mnemonic = entropyToMnemonicString(entropy);
      const masterSeed = mnemonicToSeed(mnemonic);
      console.log('   Generating master KeyManager (may take a moment)...');
      const masterKM = await buildMasterKeyManager(masterSeed, userid);
      const { fingerprint: masterFP, publicKey: masterPub } = await extractKMInfo(masterKM);

      // Write fixture: entity dir
      writeFile(path.join(tmpEntity, 'id', 'leaf.gpg.asc'), leafPrivArmored);
      writeFile(path.join(tmpEntity, 'id', 'leaf.pub.asc'), leafPub);
      writeFile(path.join(tmpEntity, 'id', 'leaf-fingerprint.txt'), leafFP);

      // Write fixture: vesta sigchain dir
      const sigchainDir = path.join(tmpVesta, 'entities', handle, 'sigchain');
      writeFile(path.join(sigchainDir, 'master.pub.asc'), masterPub);
      writeFile(path.join(sigchainDir, 'metadata.json'), JSON.stringify({
        masterFingerprint: masterFP,
        sigchainHeadCID: 'baguzsomecid-test',
        sigchainHeadUpdated: '2026-04-26T02:51:33Z',
      }, null, 2));

      const result = await loadIdentityFromDisk({ entityDir: tmpEntity, handle });

      assert(result.loaded === true, `loaded is true (got: ${result.loaded})`);
      assert(result.handle === handle, `handle matches (got: ${result.handle})`);
      assert(
        typeof result.masterFingerprint === 'string' && result.masterFingerprint.length > 0,
        `masterFingerprint present (got: ${result.masterFingerprint})`
      );
      assert(
        typeof result.leafFingerprint === 'string' && result.leafFingerprint.length > 0,
        `leafFingerprint present (got: ${result.leafFingerprint})`
      );
      assert(
        result.masterFingerprint.replace(/\s/g, '').toUpperCase() === masterFP.replace(/\s/g, '').toUpperCase(),
        `masterFingerprint matches generated fixture`
      );
      assert(
        result.leafFingerprint.replace(/\s/g, '').toUpperCase() === leafFP.replace(/\s/g, '').toUpperCase(),
        `leafFingerprint matches generated fixture`
      );

    } finally {
      process.env.KOAD_VESTA_DIR = origVesta;
      rmDir(tmpEntity);
      rmDir(tmpVesta);
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
