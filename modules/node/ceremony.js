// ceremony.js — BIP39 → Ed25519 → kbpgp KeyManager derivation helpers (ESM)
//
// Implements the key-derivation internals for VESTA-SPEC-149 v1.3 Flight B + §8.1.
//
// All helpers are pure functions that accept explicit inputs and return values.
// No side effects. State lives in identity.js.
//
// Derivation path:
//   crypto.randomBytes(32) → BIP39 24-word mnemonic (via mnemonicToEntropy ↔ entropyToMnemonic)
//   mnemonic → mnemonicToEntropy() → 32-byte master seed
//   seed → kbnacl.genFromSeed() → { publicKey, secretKey }
//   publicKey + secretKey + seed → EDDSA Pair → Primary KeyWrapper → KeyManager
//
// Why mnemonicToEntropy instead of mnemonicToSeedSync:
//   mnemonicToEntropy returns the raw entropy bytes (32 bytes for a 24-word mnemonic).
//   mnemonicToSeedSync returns a 64-byte PBKDF2 output — too long, different semantics.
//   Using entropy directly keeps derivation deterministic and compact.
//
// Timestamp determinism:
//   PGP fingerprints include the key creation timestamp. For deterministic fingerprints,
//   we derive the timestamp from the first 4 bytes of the seed (fixed offset from a
//   base epoch in Nov 2023). Same seed = same timestamp = same fingerprint.

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

import { entropyToMnemonic, mnemonicToEntropy, mnemonicToSeedSync, validateMnemonic, generateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';

const EdDSAPair = require('kbpgp/lib/ecc/eddsa').Pair;
const { Pub: EdPub, Priv: EdPriv } = EdDSAPair;
const kbnacl = require('keybase-nacl');
const { Lifespan, Primary, Subkey } = require('kbpgp/lib/keywrapper');
const { KeyManager } = require('kbpgp/lib/openpgp/keymanager');
const { UserID } = require('kbpgp/lib/openpgp/packet/userid');
const konst = require('kbpgp/lib/const');
const ECDH = require('kbpgp/lib/ecc/ecdh').ECDH;

const C = konst.openpgp;
const F = C.key_flags;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Base epoch for key creation timestamp derivation (2023-11-14T22:13:20Z) */
const TIMESTAMP_BASE = 1700000000;

/** Window (in seconds) for timestamp offset — 1 year */
const TIMESTAMP_WINDOW = 365 * 24 * 3600;

// ---------------------------------------------------------------------------
// Entropy generation
// ---------------------------------------------------------------------------

/**
 * Generate 32 bytes of cryptographic entropy asynchronously.
 * Prefers Node.js crypto; falls back to Web Crypto API for browser contexts.
 *
 * @returns {Promise<Buffer>} 32 random bytes
 */
export async function generateEntropy() {
  if (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.getRandomValues) {
    const bytes = new Uint8Array(32);
    globalThis.crypto.getRandomValues(bytes);
    return Buffer.from(bytes);
  }
  const { randomBytes } = await import('crypto');
  return randomBytes(32);
}

/**
 * Synchronous entropy generation using Node.js crypto.
 * Use this in non-browser environments.
 *
 * @returns {Buffer} 32 random bytes
 */
export function generateEntropySync() {
  // Try Node crypto first
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { randomBytes } = require('crypto');
    return randomBytes(32);
  } catch (_) {
    // Browser fallback
    if (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.getRandomValues) {
      const bytes = new Uint8Array(32);
      globalThis.crypto.getRandomValues(bytes);
      return Buffer.from(bytes);
    }
    throw new Error('[koad/ceremony] No cryptographic random source available.');
  }
}

// ---------------------------------------------------------------------------
// Mnemonic helpers
// ---------------------------------------------------------------------------

/**
 * Derive a 24-word BIP39 mnemonic from 32 bytes of entropy.
 *
 * @param {Buffer|Uint8Array} entropy - 32 bytes
 * @returns {string} space-separated 24-word mnemonic
 */
export function entropyToMnemonicString(entropy) {
  return entropyToMnemonic(entropy, wordlist);
}

/**
 * Derive the 32-byte master seed from a BIP39 mnemonic.
 * Uses mnemonicToEntropy (raw entropy path), not PBKDF2.
 *
 * @param {string} mnemonic - space-separated BIP39 mnemonic
 * @returns {Buffer} 32-byte seed
 */
export function mnemonicToSeed(mnemonic) {
  const entropy = mnemonicToEntropy(mnemonic, wordlist);
  return Buffer.from(entropy);
}

/**
 * Derive a 32-byte seed from a BIP39 mnemonic using the standard PBKDF2 path.
 *
 * This is the BIP39 spec-compliant derivation: seed = PBKDF2-HMAC-SHA512(
 *   password  = NFKD(mnemonic),
 *   salt      = "mnemonic" + NFKD(passphrase),
 *   rounds    = 2048,
 *   keylen    = 64 bytes
 * )
 * The first 32 bytes of that output are returned as the Ed25519 seed (since
 * kbnacl.genFromSeed() requires exactly 32 bytes).
 *
 * Use this when the caller provides a --bip39-passphrase. Without a passphrase,
 * mnemonicToSeed() (raw-entropy path) produces a different key than this function
 * with passphrase=''. The two paths are intentionally distinct: raw-entropy is
 * used for the genesis key (backward-compat), PBKDF2 is used when a passphrase
 * guard is explicitly requested.
 *
 * WARNING: a key derived with mnemonicToSeedBip39(mnemonic, '') will NOT match
 * a key derived with mnemonicToSeed(mnemonic). Use consistently within one
 * identity's lifecycle. The ceremony command signals which path to use via the
 * presence or absence of --bip39-passphrase.
 *
 * @param {string} mnemonic - space-separated BIP39 mnemonic (24 words)
 * @param {string} [passphrase=''] - optional passphrase (BIP39 §5)
 * @returns {Buffer} 32-byte seed (first 32 bytes of 64-byte PBKDF2 output)
 */
export function mnemonicToSeedBip39(mnemonic, passphrase = '') {
  if (typeof mnemonic !== 'string' || !mnemonic.trim()) {
    throw new Error('[koad/ceremony] mnemonicToSeedBip39: mnemonic must be a non-empty string');
  }
  if (typeof passphrase !== 'string') {
    throw new Error('[koad/ceremony] mnemonicToSeedBip39: passphrase must be a string (use empty string for no passphrase)');
  }
  // @scure/bip39 mnemonicToSeedSync applies NFKD normalization and PBKDF2-HMAC-SHA512
  // exactly per BIP39 §5: salt = "mnemonic" + passphrase, 2048 rounds, 64-byte output.
  const seed64 = mnemonicToSeedSync(mnemonic, passphrase);
  // Take first 32 bytes for Ed25519 seed input (kbnacl.genFromSeed requires 32 bytes)
  return Buffer.from(seed64.slice(0, 32));
}

/**
 * Validate a BIP39 mnemonic.
 *
 * @param {string} mnemonic
 * @returns {boolean}
 */
export function isValidMnemonic(mnemonic) {
  try {
    return validateMnemonic(mnemonic, wordlist);
  } catch (_) {
    return false;
  }
}

/**
 * Store a mnemonic as a Uint8Array of UTF-8 bytes for deterministic zeroing.
 * Returns the buffer. Caller is responsible for zeroing after use.
 *
 * @param {string} mnemonic
 * @returns {Uint8Array}
 */
export function mnemonicToBuffer(mnemonic) {
  const enc = new TextEncoder();
  return enc.encode(mnemonic);
}

/**
 * Zero a Uint8Array in-place (deterministic scrub).
 * This is the best we can do in JS — references held elsewhere are not affected.
 *
 * @param {Uint8Array} buf
 */
export function zeroBuffer(buf) {
  if (buf instanceof Uint8Array) {
    buf.fill(0x00);
  }
}

// ---------------------------------------------------------------------------
// Key derivation timestamp
// ---------------------------------------------------------------------------

/**
 * Derive a fixed PGP creation timestamp from the first 4 bytes of the master seed.
 * Ensures same seed → same timestamp → same fingerprint.
 *
 * @param {Buffer} seed - 32-byte master seed
 * @returns {number} Unix timestamp (seconds)
 */
export function derivedTimestamp(seed) {
  const offset = seed.readUInt32BE(0) % TIMESTAMP_WINDOW;
  return TIMESTAMP_BASE + offset;
}

// ---------------------------------------------------------------------------
// KeyManager construction
// ---------------------------------------------------------------------------

/**
 * Build a deterministic kbpgp Ed25519 (EDDSA) KeyManager from a 32-byte seed.
 *
 * The primary key is EDDSA (type 22). The encryption subkey is ECDH (Curve25519).
 * The ECDH subkey is randomly generated — it does not need to be deterministic
 * because it is used for encryption, not for identity fingerprinting.
 *
 * The PGP fingerprint is derived from: EDDSA public key bytes + creation timestamp.
 * Since both are derived from the seed, the fingerprint is deterministic.
 *
 * @param {Buffer} seed - 32-byte master seed
 * @param {string} userid - PGP userid string (e.g. 'koad <koad@koad.sh>')
 * @returns {Promise<object>} kbpgp KeyManager with private key loaded
 */
export async function buildMasterKeyManager(seed, userid) {
  if (!Buffer.isBuffer(seed) || seed.length !== 32) {
    throw new Error('[koad/ceremony] buildMasterKeyManager: seed must be a 32-byte Buffer');
  }
  if (typeof userid !== 'string' || !userid) {
    throw new Error('[koad/ceremony] buildMasterKeyManager: userid must be a non-empty string');
  }

  // Step 1: Derive Ed25519 keypair deterministically from seed
  const { publicKey, secretKey } = kbnacl.alloc({}).genFromSeed({ seed });
  const pub = new EdPub({ key: Buffer.from(publicKey) });
  const priv = new EdPriv({ seed, key: Buffer.from(secretKey), pub });
  const pair = new EdDSAPair({ pub, priv });

  // Step 2: Derive creation timestamp from seed for fingerprint determinism
  const created = derivedTimestamp(seed);

  // Step 3: Wrap in Primary keywrapper
  const primary = new Primary({
    key: pair,
    lifespan: new Lifespan({ generated: created, expire_in: 0 }),
    flags: F.certify_keys | F.sign_data,
  });

  // Step 4: Generate random ECDH encryption subkey (random by design — not from mnemonic)
  const ecdhPair = await new Promise((resolve, reject) => {
    ECDH.generate({ nbits: 256 }, (err, ecdhKey) => {
      if (err) reject(err);
      else resolve(ecdhKey);
    });
  });

  const subkey = new Subkey({
    key: ecdhPair,
    lifespan: new Lifespan({ generated: created, expire_in: 0 }),
    flags: F.encrypt_comm | F.encrypt_storage,
    primary,
  });

  // Step 5: Build UserID packet and KeyManager
  const useridPkt = new UserID(userid);
  const km = new KeyManager({ primary, subkeys: [subkey], userids: [useridPkt] });

  // Step 6: Self-sign (signs primary uid + binds subkey)
  await new Promise((resolve, reject) => {
    km.sign({}, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });

  return km;
}

/**
 * Generate a random leaf (device) KeyManager using standard kbpgp ECC path.
 * Leaf keys are NOT derived from the mnemonic — they are independent per-device.
 *
 * @param {string} userid - PGP userid string
 * @returns {Promise<object>} kbpgp KeyManager with private key loaded
 */
export async function buildLeafKeyManager(userid) {
  if (typeof userid !== 'string' || !userid) {
    throw new Error('[koad/ceremony] buildLeafKeyManager: userid must be a non-empty string');
  }

  // Use generate_ecc which supplies correct primary/subkey structure for ECC keys
  return new Promise((resolve, reject) => {
    KeyManager.generate_ecc({ userid }, (err, km) => {
      if (err) return reject(err);
      km.sign({}, (err2) => {
        if (err2) return reject(err2);
        resolve(km);
      });
    });
  });
}

/**
 * Extract fingerprint and armored public key from a KeyManager.
 *
 * @param {object} km - kbpgp KeyManager
 * @returns {Promise<{fingerprint: string, publicKey: string}>}
 */
export async function extractKMInfo(km) {
  const fingerprint = (km.get_pgp_fingerprint_str() || '').toUpperCase();

  const publicKey = await new Promise((resolve, reject) => {
    km.export_pgp_public({}, (err, armor) => {
      if (err) reject(err);
      else resolve(armor);
    });
  });

  return { fingerprint, publicKey };
}

// ---------------------------------------------------------------------------
// Leaf at-rest encryption (VESTA-SPEC-149 v1.3 §8.1)
// ---------------------------------------------------------------------------

/**
 * Generate a device-bound passphrase: 32 random bytes, hex-encoded.
 * This is the value stored as `device.key` and used as the passphrase
 * for encrypting the leaf private key block (SPEC-149 §8.1.3 Path B).
 * Pure entropy — not derived from anything. 64-char hex string (32 bytes).
 *
 * @returns {string} 64-char hex string
 */
export function generateDeviceKey() {
  try {
    const { randomBytes } = require('crypto');
    return randomBytes(32).toString('hex');
  } catch (_) {
    // Browser fallback (should not reach here in Node, but guards isomorphic use)
    if (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.getRandomValues) {
      const bytes = new Uint8Array(32);
      globalThis.crypto.getRandomValues(bytes);
      return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    }
    throw new Error('[koad/ceremony] generateDeviceKey: no cryptographic random source available');
  }
}

/**
 * Encrypt a leaf KeyManager's private material for at-rest storage.
 * Uses kbpgp's export_pgp_private with a passphrase — produces an armored
 * PGP PRIVATE KEY BLOCK with internal AES-256-CFB S2K encryption.
 * Conforms to SPEC-149 §8.1.2–§8.1.4.
 *
 * @param {object} km - kbpgp KeyManager with the leaf private key loaded
 * @param {string} passphrase - The passphrase (typically a hex-encoded 32-byte device key)
 * @returns {Promise<string>} Armored encrypted private key block
 */
export async function encryptLeafForStorage(km, passphrase) {
  if (!km || typeof km.export_pgp_private !== 'function') {
    throw new Error('[koad/ceremony] encryptLeafForStorage: km must be a kbpgp KeyManager');
  }
  if (typeof passphrase !== 'string' || passphrase.length === 0) {
    throw new Error('[koad/ceremony] encryptLeafForStorage: passphrase must be a non-empty string (SPEC-149 §8.1.1 no-plaintext prohibition)');
  }

  return new Promise((resolve, reject) => {
    km.export_pgp_private({ passphrase }, (err, armored) => {
      if (err) return reject(new Error('[koad/ceremony] encryptLeafForStorage: export_pgp_private failed: ' + err.message));
      if (!armored || !armored.includes('BEGIN PGP PRIVATE KEY BLOCK')) {
        return reject(new Error('[koad/ceremony] encryptLeafForStorage: unexpected output — expected PGP PRIVATE KEY BLOCK'));
      }
      resolve(armored);
    });
  });
}

/**
 * Decrypt an at-rest leaf private key block back into a kbpgp KeyManager.
 * Reverses encryptLeafForStorage. Conforms to SPEC-149 §8.1.
 *
 * @param {string} armoredEncrypted - Armored PGP PRIVATE KEY BLOCK
 * @param {string} passphrase - The passphrase used to encrypt
 * @returns {Promise<object>} kbpgp KeyManager with private key unlocked
 */
export async function decryptLeafFromStorage(armoredEncrypted, passphrase) {
  if (typeof armoredEncrypted !== 'string' || !armoredEncrypted.includes('BEGIN PGP PRIVATE KEY BLOCK')) {
    throw new Error('[koad/ceremony] decryptLeafFromStorage: armoredEncrypted must be a PGP PRIVATE KEY BLOCK string');
  }
  if (typeof passphrase !== 'string' || passphrase.length === 0) {
    throw new Error('[koad/ceremony] decryptLeafFromStorage: passphrase must be a non-empty string');
  }

  const { KeyManager } = require('kbpgp/lib/openpgp/keymanager');

  // Step 1: import armored private key block into a new KeyManager
  const km = await new Promise((resolve, reject) => {
    KeyManager.import_from_armored_pgp({ armored: armoredEncrypted }, (err, loaded) => {
      if (err) return reject(new Error('[koad/ceremony] decryptLeafFromStorage: import_from_armored_pgp failed: ' + err.message));
      resolve(loaded);
    });
  });

  // Step 2: unlock the private key material using the passphrase
  await new Promise((resolve, reject) => {
    km.unlock_pgp({ passphrase }, (err) => {
      if (err) return reject(new Error('[koad/ceremony] decryptLeafFromStorage: unlock_pgp failed — wrong passphrase or corrupted data: ' + err.message));
      resolve();
    });
  });

  return km;
}
