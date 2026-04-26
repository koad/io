// identity-loader.js — Leaf-at-rest encryption, disk persistence, and load for desktop.
//
// PORTABILITY NOTE: This file is intentionally written as portable logic.
// The same shape will be lifted into the dark-passenger background service worker,
// swapping fs-jetpack file reads for OPFS/IndexedDB reads. Electron-specific APIs
// are deliberately excluded.
//
// Implements VESTA-SPEC-149 v1.3 §8.1 leaf-at-rest persistence.
// File layout per SPEC-149 v1.3 §8.1 (supersedes SPEC-024 v1.3 §12.1 for leaf files):
//
//   ~/.<entity>/id/leaf.private.asc   — AES-256-CFB encrypted PGP PRIVATE KEY BLOCK, mode 0o600
//   ~/.<entity>/id/device.key         — 64-char hex device-bound passphrase, mode 0o600
//   ~/.<entity>/id/leaf.pub.asc       — leaf public key (PGP-armored, plain)
//   ~/.<entity>/id/leaf-fingerprint.txt — 40-hex leaf fingerprint
//   ~/.vesta/entities/<handle>/sigchain/master.pub.asc   — master public key (PGP-armored)
//   ~/.vesta/entities/<handle>/sigchain/metadata.json    — masterFingerprint, sigchainHeadCID, etc.
//
// The entity-side leaf files do not exist on any entity until a ceremony is run.
// This loader fails gracefully with reason 'no-leaf-file' or 'no-device-key' if absent.
//
// Legacy file (leaf.gpg.asc) is not read — callers on the old format need a migration ceremony.

'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const jetpack = require('fs-jetpack');

// kbpgp lives in modules/node/node_modules — resolve relative to this file's location
// so the loader works regardless of working directory.
const MODULES_NODE_DIR = path.resolve(__dirname, '../../../modules/node');
const kbpgp = require(path.join(MODULES_NODE_DIR, 'node_modules/kbpgp'));

// Ceremony helpers — lazy-loaded (ESM module, dynamic import required from CJS context).
// Provides: generateDeviceKey, encryptLeafForStorage, decryptLeafFromStorage.
let _ceremonyCache = null;
async function _ceremony() {
  if (!_ceremonyCache) {
    _ceremonyCache = await import(path.join(MODULES_NODE_DIR, 'ceremony.js'));
  }
  return _ceremonyCache;
}

// Path to vesta entities directory (override via KOAD_VESTA_DIR env if needed)
function vestaEntitiesDir() {
  if (process.env.KOAD_VESTA_DIR) return path.join(process.env.KOAD_VESTA_DIR, 'entities');
  return path.join(os.homedir(), '.vesta', 'entities');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Import a KeyManager from a PGP-armored string (public or private key).
 * Returns {km} on success, {error} on failure.
 *
 * @param {string} armored
 * @returns {Promise<{km?: object, error?: string}>}
 */
function _importArmored(armored) {
  return new Promise(function(resolve) {
    kbpgp.KeyManager.import_from_armored_pgp({ armored }, function(err, km) {
      if (err) return resolve({ error: err.message });
      resolve({ km });
    });
  });
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Encrypt the loaded leaf and persist to disk per SPEC-149 v1.3 §8.1.
 *
 * Writes two files in <entityDir>/id/, both mode 0o600, atomically (tmp + rename):
 *   <entityDir>/id/leaf.private.asc  — armored encrypted PGP PRIVATE KEY BLOCK
 *   <entityDir>/id/device.key        — 64-char hex device-bound passphrase
 *
 * An existing device.key is preserved: if one already exists on disk, it is reused
 * so that multi-boot doesn't rotate the passphrase. Pass opts.rotateDeviceKey = true
 * to force a new device key (e.g., after ceremony or leaf rotation).
 *
 * @param {object} opts
 * @param {string} opts.entityDir   - Absolute path to entity dir (e.g. '/home/koad/.juno')
 * @param {object} opts.keyManager  - kbpgp KeyManager with the leaf private key
 * @param {boolean} [opts.rotateDeviceKey] - Force generation of a new device key (default: false)
 * @returns {Promise<{ written: boolean, leafPath: string, devicePath: string, error?: string }>}
 */
async function persistLeafToDisk({ entityDir, keyManager, rotateDeviceKey = false } = {}) {
  if (!entityDir || typeof entityDir !== 'string') {
    return { written: false, leafPath: '', devicePath: '', error: 'entityDir is required' };
  }
  if (!keyManager) {
    return { written: false, leafPath: '', devicePath: '', error: 'keyManager is required' };
  }

  const { generateDeviceKey, encryptLeafForStorage } = await _ceremony();

  const idDir     = path.join(entityDir, 'id');
  const leafPath  = path.join(idDir, 'leaf.private.asc');
  const devPath   = path.join(idDir, 'device.key');

  // Create the id/ directory if it doesn't exist (mode 0o700)
  fs.mkdirSync(idDir, { recursive: true, mode: 0o700 });

  // Read or generate device key
  let deviceKey;
  if (!rotateDeviceKey && jetpack.exists(devPath) === 'file') {
    deviceKey = (jetpack.read(devPath) || '').trim();
    if (!deviceKey || deviceKey.length !== 64) {
      // Existing key is malformed — generate fresh
      deviceKey = generateDeviceKey();
    }
  } else {
    deviceKey = generateDeviceKey();
  }

  // Encrypt the leaf private key
  let armoredEncrypted;
  try {
    armoredEncrypted = await encryptLeafForStorage(keyManager, deviceKey);
  } catch (e) {
    return { written: false, leafPath, devicePath: devPath, error: `encryptLeafForStorage failed: ${e.message}` };
  }

  // Write both files atomically (tmp + rename), mode 0o600
  const leafTmp = leafPath + '.tmp.' + process.pid;
  const devTmp  = devPath  + '.tmp.' + process.pid;
  try {
    fs.writeFileSync(leafTmp, armoredEncrypted, { encoding: 'utf8', mode: 0o600 });
    fs.writeFileSync(devTmp,  deviceKey,        { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(leafTmp, leafPath);
    fs.renameSync(devTmp,  devPath);
  } catch (e) {
    // Clean up temp files on error
    try { fs.unlinkSync(leafTmp); } catch (_) {}
    try { fs.unlinkSync(devTmp);  } catch (_) {}
    return { written: false, leafPath, devicePath: devPath, error: `Atomic write failed: ${e.message}` };
  }

  // Ensure mode 0o600 is set after rename (rename preserves the mode we set on writeFileSync)
  try {
    fs.chmodSync(leafPath, 0o600);
    fs.chmodSync(devPath,  0o600);
  } catch (_) {
    // Non-fatal: best-effort mode enforcement
  }

  return { written: true, leafPath, devicePath: devPath };
}

/**
 * Read encrypted leaf + master pubkey + sigchain metadata from disk,
 * decrypt the leaf via device.key, and load koad.identity.
 *
 * Implements VESTA-SPEC-149 v1.3 §8.1.
 *
 * The function does NOT initialize globalThis.koad — that is the caller's responsibility.
 * If koad.identity is available in globalThis at call time, it will be populated via .load().
 * Either way, the resolved bag of identity fields is returned so the caller can apply
 * them to whatever identity context they hold.
 *
 * @param {object} opts
 * @param {string} opts.entityDir    - Absolute path to entity dir (e.g. '/home/koad/.juno')
 * @param {string} opts.handle       - Entity handle (e.g. 'juno')
 * @param {string} [opts.passphrase] - Path A user passphrase override (reserved, opt-in future work)
 * @returns {Promise<{
 *   loaded: boolean,
 *   handle?: string,
 *   masterFingerprint?: string,
 *   leafFingerprint?: string,
 *   keyManager?: object,
 *   error?: string,
 *   reason?: 'no-leaf-file' | 'no-device-key' | 'no-master-pubkey' | 'no-vesta-record' | 'decrypt-failed' | 'import-failed' | 'load-failed'
 * }>}
 */
async function loadIdentityFromDisk({ entityDir, handle, passphrase } = {}) {
  if (!entityDir || typeof entityDir !== 'string') {
    return { loaded: false, reason: 'no-leaf-file', error: 'entityDir is required' };
  }
  if (!handle || typeof handle !== 'string') {
    return { loaded: false, reason: 'no-leaf-file', error: 'handle is required' };
  }

  // -------------------------------------------------------------------------
  // 1. Read encrypted leaf from <entityDir>/id/leaf.private.asc
  // -------------------------------------------------------------------------
  const leafPrivPath = path.join(entityDir, 'id', 'leaf.private.asc');
  const leafPubPath  = path.join(entityDir, 'id', 'leaf.pub.asc');
  const leafFPPath   = path.join(entityDir, 'id', 'leaf-fingerprint.txt');
  const devKeyPath   = path.join(entityDir, 'id', 'device.key');

  const armoredEncrypted = jetpack.read(leafPrivPath);
  if (!armoredEncrypted) {
    return { loaded: false, reason: 'no-leaf-file', error: `Leaf private key not found at ${leafPrivPath}` };
  }

  // -------------------------------------------------------------------------
  // 2. Read device.key — the AES-256-CFB passphrase (SPEC-149 §8.1)
  //    passphrase param is a future Path A override; device.key is canonical.
  // -------------------------------------------------------------------------
  const deviceKey = passphrase || (jetpack.read(devKeyPath) || '').trim();
  if (!deviceKey) {
    return { loaded: false, reason: 'no-device-key', error: `Device key not found at ${devKeyPath}` };
  }

  // -------------------------------------------------------------------------
  // 3. Read master public key + sigchain metadata from ~/.vesta/entities/<handle>/sigchain/
  // -------------------------------------------------------------------------
  const sigchainDir   = path.join(vestaEntitiesDir(), handle, 'sigchain');
  const masterPubPath = path.join(sigchainDir, 'master.pub.asc');
  const metadataPath  = path.join(sigchainDir, 'metadata.json');

  if (!jetpack.exists(sigchainDir)) {
    return { loaded: false, reason: 'no-vesta-record', error: `No sigchain record found for ${handle} at ${sigchainDir}` };
  }

  const masterPubArmored = jetpack.read(masterPubPath);
  if (!masterPubArmored) {
    return { loaded: false, reason: 'no-master-pubkey', error: `Master public key not found at ${masterPubPath}` };
  }

  let metadata;
  try {
    metadata = jetpack.read(metadataPath, 'json');
    if (!metadata) throw new Error('empty file');
  } catch (e) {
    return { loaded: false, reason: 'no-vesta-record', error: `Failed to read sigchain metadata at ${metadataPath}: ${e.message}` };
  }

  const masterFingerprint = metadata.masterFingerprint;
  const sigchainHeadCID   = metadata.sigchainHeadCID || null;

  if (!masterFingerprint) {
    return { loaded: false, reason: 'no-vesta-record', error: `metadata.json at ${metadataPath} is missing masterFingerprint` };
  }

  // -------------------------------------------------------------------------
  // 4. Decrypt encrypted leaf → kbpgp KeyManager
  //    Uses decryptLeafFromStorage (ceremony.js) — reverses persistLeafToDisk.
  // -------------------------------------------------------------------------
  const { decryptLeafFromStorage } = await _ceremony();
  let leafKM;
  try {
    leafKM = await decryptLeafFromStorage(armoredEncrypted, deviceKey);
  } catch (e) {
    return { loaded: false, reason: 'decrypt-failed', error: `decryptLeafFromStorage failed: ${e.message}` };
  }

  if (!leafKM) {
    return { loaded: false, reason: 'import-failed', error: 'decryptLeafFromStorage returned null KeyManager' };
  }

  // -------------------------------------------------------------------------
  // 5. Extract leaf fingerprint (prefer disk file, fall back to KM)
  // -------------------------------------------------------------------------
  let leafFingerprint = jetpack.read(leafFPPath);
  if (leafFingerprint) {
    leafFingerprint = leafFingerprint.trim();
  } else {
    leafFingerprint = (leafKM.get_pgp_fingerprint_str() || '').toUpperCase();
  }

  // -------------------------------------------------------------------------
  // 6. Import master public key for the identity bag
  // -------------------------------------------------------------------------
  const { km: masterKM, error: masterImportErr } = await _importArmored(masterPubArmored);
  if (!masterKM) {
    return { loaded: false, reason: 'import-failed', error: `Failed to import master public key: ${masterImportErr}` };
  }

  // -------------------------------------------------------------------------
  // 7. Extract leaf public key armor
  // -------------------------------------------------------------------------
  let leafPublicKey = jetpack.read(leafPubPath) || null;
  if (!leafPublicKey) {
    try {
      leafPublicKey = await new Promise(function(resolve, reject) {
        leafKM.export_pgp_public({}, function(err, armor) {
          if (err) return reject(err);
          resolve(armor);
        });
      });
    } catch (_e) {
      leafPublicKey = null; // non-fatal
    }
  }

  // -------------------------------------------------------------------------
  // 8. Call koad.identity.load() if available in globalThis
  // -------------------------------------------------------------------------
  const identityBag = {
    handle,
    masterFingerprint,
    masterPublicKey: masterPubArmored,
    keyManager: leafKM,
    leafFingerprint,
    leafPublicKey,
    sigchainHeadCID,
  };

  if (
    typeof globalThis !== 'undefined' &&
    globalThis.koad &&
    globalThis.koad.identity &&
    typeof globalThis.koad.identity.load === 'function'
  ) {
    try {
      globalThis.koad.identity.load(identityBag);
    } catch (loadErr) {
      return { loaded: false, reason: 'load-failed', error: `koad.identity.load() threw: ${loadErr.message}` };
    }
  }

  return {
    loaded: true,
    handle,
    masterFingerprint,
    leafFingerprint,
    keyManager: leafKM,
  };
}

module.exports = { loadIdentityFromDisk, persistLeafToDisk };
