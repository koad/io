// ceremony.js — BIP39 → Ed25519 → kbpgp KeyManager derivation helpers (ESM)
//
// Implements the key-derivation internals for VESTA-SPEC-149 v1.0 Flight B.
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

import { entropyToMnemonic, mnemonicToEntropy, validateMnemonic, generateMnemonic } from '@scure/bip39';
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
