// identity-loader.js — Read encrypted leaf + master pubkey + sigchain metadata from disk,
// decrypt the leaf, and load koad.identity.
//
// PORTABILITY NOTE: This file is intentionally written as portable logic.
// The same shape will be lifted into the dark-passenger background service worker,
// swapping fs-jetpack file reads for OPFS/IndexedDB reads. Electron-specific APIs
// are deliberately excluded.
//
// Implements the disk-read half of VESTA-SPEC-149 v1.0 (Entity Identity Substrate).
// File layout per SPEC-024 v1.3 §12.1:
//
//   ~/.<entity>/id/leaf.gpg.asc              — encrypted leaf private key (PGP-armored)
//   ~/.<entity>/id/leaf.pub.asc              — leaf public key (PGP-armored, plain)
//   ~/.<entity>/id/leaf-fingerprint.txt      — 40-hex leaf fingerprint
//   ~/.vesta/entities/<handle>/sigchain/master.pub.asc   — master public key (PGP-armored)
//   ~/.vesta/entities/<handle>/sigchain/metadata.json    — masterFingerprint, sigchainHeadCID, etc.
//
// The entity-side leaf files (leaf.gpg.asc, leaf.pub.asc, leaf-fingerprint.txt) are new.
// They do not exist on any entity yet. This loader fails gracefully with reason 'no-leaf-file'
// if they are absent — expected during the transition period before ceremonies are run.
//
// TODO (SPEC-149 §11 Q2): Encrypted leaf decryption is not yet implemented (open question
// on the encrypted-leaf format spec). This version supports unencrypted leaf private keys only.
// Passphrase parameter is accepted but unused — reserved for the encrypted path.

'use strict';

const path = require('path');
const os = require('os');
const jetpack = require('fs-jetpack');

// kbpgp lives in modules/node/node_modules — resolve relative to this file's location
// so the loader works regardless of working directory.
const MODULES_NODE_DIR = path.resolve(__dirname, '../../../modules/node');
const kbpgp = require(path.join(MODULES_NODE_DIR, 'node_modules/kbpgp'));

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
 * Read encrypted leaf + master pubkey + sigchain metadata from disk,
 * decrypt the leaf, and load koad.identity.
 *
 * The function does NOT initialize globalThis.koad — that is the caller's responsibility.
 * If koad.identity is available in globalThis at call time, it will be populated via .load().
 * Either way, the resolved bag of identity fields is returned so the caller can apply
 * them to whatever identity context they hold.
 *
 * @param {object} opts
 * @param {string} opts.entityDir   - Absolute path to entity dir (e.g. '/home/koad/.juno')
 * @param {string} opts.handle      - Entity handle (e.g. 'juno')
 * @param {string} [opts.passphrase] - Passphrase to decrypt leaf private key (reserved, unused in v1)
 * @returns {Promise<{
 *   loaded: boolean,
 *   handle?: string,
 *   masterFingerprint?: string,
 *   leafFingerprint?: string,
 *   error?: string,
 *   reason?: 'no-leaf-file' | 'no-master-pubkey' | 'no-vesta-record' | 'decrypt-failed' | 'import-failed' | 'load-failed'
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
  // 1. Read leaf private key from <entityDir>/id/leaf.gpg.asc
  // -------------------------------------------------------------------------
  const leafPrivPath = path.join(entityDir, 'id', 'leaf.gpg.asc');
  const leafPubPath  = path.join(entityDir, 'id', 'leaf.pub.asc');
  const leafFPPath   = path.join(entityDir, 'id', 'leaf-fingerprint.txt');

  const leafPrivArmored = jetpack.read(leafPrivPath);
  if (!leafPrivArmored) {
    return { loaded: false, reason: 'no-leaf-file', error: `Leaf private key not found at ${leafPrivPath}` };
  }

  // -------------------------------------------------------------------------
  // 2. Read master public key + sigchain metadata from ~/.vesta/entities/<handle>/sigchain/
  // -------------------------------------------------------------------------
  const sigchainDir    = path.join(vestaEntitiesDir(), handle, 'sigchain');
  const masterPubPath  = path.join(sigchainDir, 'master.pub.asc');
  const metadataPath   = path.join(sigchainDir, 'metadata.json');

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
  // 3. Decrypt (TODO) + import leaf private key as kbpgp KeyManager
  //
  // v1: unencrypted leaf only. Encrypted path is a TODO pending SPEC-149 §11 Q2.
  // The passphrase parameter is reserved for that path.
  // -------------------------------------------------------------------------
  if (passphrase) {
    // TODO: implement encrypted leaf decryption once SPEC-149 §11 Q2 is resolved.
    // For now, accept passphrase but proceed as if unencrypted — the import will fail
    // if the key is actually encrypted, surfacing as 'import-failed'.
  }

  const { km: leafKM, error: importErr } = await _importArmored(leafPrivArmored);
  if (!leafKM) {
    return { loaded: false, reason: 'import-failed', error: `Failed to import leaf private key: ${importErr}` };
  }

  // -------------------------------------------------------------------------
  // 4. Extract leaf fingerprint (prefer disk file, fall back to KM)
  // -------------------------------------------------------------------------
  let leafFingerprint = jetpack.read(leafFPPath);
  if (leafFingerprint) {
    leafFingerprint = leafFingerprint.trim();
  } else {
    // Derive from the imported KeyManager
    leafFingerprint = (leafKM.get_pgp_fingerprint_str() || '').toUpperCase();
  }

  // -------------------------------------------------------------------------
  // 5. Import master public key for the identity bag
  // -------------------------------------------------------------------------
  const { km: masterKM, error: masterImportErr } = await _importArmored(masterPubArmored);
  if (!masterKM) {
    return { loaded: false, reason: 'import-failed', error: `Failed to import master public key: ${masterImportErr}` };
  }

  // -------------------------------------------------------------------------
  // 6. Extract leaf public key armor
  // -------------------------------------------------------------------------
  let leafPublicKey = jetpack.read(leafPubPath) || null;
  if (!leafPublicKey) {
    // Derive from the imported leaf KM
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
  // 7. Call koad.identity.load() if available in globalThis
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
  };
}

module.exports = { loadIdentityFromDisk };
