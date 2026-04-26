// ceremony-browser.js — BIP39 → Ed25519 → kbpgp KeyManager derivation for the browser
//
// Implements VESTA-SPEC-149 v1.0 browser path.
//
// Browser counterpart to modules/node/ceremony.js.
// Same function signatures, same return shapes.
//
// Depends on:
//   - kbpgp bundle with internals (kbpgp.bundle.min.js built from kbpgp-with-internals.js)
//     served at /kbpgp.bundle.min.js and lazy-loaded by client/pgp.js on first use.
//   - @scure/bip39 — bundled here via the Meteor ESM build path.
//     In browser, these are imported via Meteor's ES module bundler.
//
// Key difference from ceremony.js:
//   - No require() — uses window.kbpgp exposed by the bundle
//   - BIP39 helpers imported from @scure/bip39 (same npm package, Meteor resolves it)
//   - generateEntropy uses Web Crypto API (window.crypto.getRandomValues)
//   - All the KeyManager construction is identical to Node — same kbpgp internals
//
// Load path in Meteor:
//   client/identity.js calls koad.identity.create() →
//   identity-factory.js (browser branch) awaits loadCeremonyBrowser() →
//   this module is dynamically imported →
//   window.kbpgp must already be loaded (loadKbpgpBundle() ensures this)
//
// This file is an ES module. Meteor's bundler handles it via api.mainModule or addFiles ESM.

import { entropyToMnemonic, mnemonicToEntropy, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';

// ---------------------------------------------------------------------------
// Bundle loader — reuses the client/pgp.js lazy loader if available,
// otherwise loads the bundle directly.
// ---------------------------------------------------------------------------

let _kbpgp = null;

async function _loadKbpgpBundle() {
  if (_kbpgp) return _kbpgp;
  if (typeof window !== 'undefined' && window.kbpgp) {
    _kbpgp = window.kbpgp;
    return _kbpgp;
  }

  // Load via script tag — same approach as client/pgp.js
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/kbpgp.bundle.min.js';
    script.async = true;
    script.onload = () => {
      if (!window.kbpgp) {
        return reject(new Error('[ceremony-browser] kbpgp bundle loaded but window.kbpgp missing'));
      }
      _kbpgp = window.kbpgp;
      resolve(_kbpgp);
    };
    script.onerror = () => reject(new Error('[ceremony-browser] Failed to load /kbpgp.bundle.min.js'));
    document.head.appendChild(script);
  });
}

// ---------------------------------------------------------------------------
// Constants — identical to ceremony.js
// ---------------------------------------------------------------------------

const TIMESTAMP_BASE = 1700000000;
const TIMESTAMP_WINDOW = 365 * 24 * 3600;

// ---------------------------------------------------------------------------
// Entropy generation
// ---------------------------------------------------------------------------

/**
 * Generate 32 bytes of cryptographic entropy using Web Crypto API.
 *
 * @returns {Promise<Uint8Array>} 32 random bytes
 */
export async function generateEntropy() {
  const bytes = new Uint8Array(32);
  window.crypto.getRandomValues(bytes);
  return bytes;
}

// ---------------------------------------------------------------------------
// Mnemonic helpers — identical API to ceremony.js
// ---------------------------------------------------------------------------

/**
 * Derive a 24-word BIP39 mnemonic from 32 bytes of entropy.
 *
 * @param {Uint8Array|Buffer} entropy - 32 bytes
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
 * @returns {Uint8Array} 32-byte seed
 */
export function mnemonicToSeed(mnemonic) {
  return mnemonicToEntropy(mnemonic, wordlist);
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
 *
 * @param {string} mnemonic
 * @returns {Uint8Array}
 */
export function mnemonicToBuffer(mnemonic) {
  const enc = new TextEncoder();
  return enc.encode(mnemonic);
}

/**
 * Zero a Uint8Array in-place.
 *
 * @param {Uint8Array} buf
 */
export function zeroBuffer(buf) {
  if (buf instanceof Uint8Array) {
    buf.fill(0x00);
  }
}

// ---------------------------------------------------------------------------
// Key derivation timestamp — identical to ceremony.js
// ---------------------------------------------------------------------------

/**
 * Derive a fixed PGP creation timestamp from the first 4 bytes of the master seed.
 *
 * @param {Uint8Array|Buffer} seed - 32-byte master seed
 * @returns {number} Unix timestamp (seconds)
 */
export function derivedTimestamp(seed) {
  // Read first 4 bytes as big-endian uint32
  const offset = ((seed[0] << 24) | (seed[1] << 16) | (seed[2] << 8) | seed[3]) >>> 0;
  return TIMESTAMP_BASE + (offset % TIMESTAMP_WINDOW);
}

// ---------------------------------------------------------------------------
// KeyManager construction
// ---------------------------------------------------------------------------

/**
 * Build a deterministic kbpgp Ed25519 (EDDSA) KeyManager from a 32-byte seed.
 * Browser version — uses window.kbpgp internals from the extended bundle.
 *
 * @param {Uint8Array|Buffer} seed - 32-byte master seed
 * @param {string} userid - PGP userid string (e.g. 'koad <koad@koad.sh>')
 * @returns {Promise<object>} kbpgp KeyManager with private key loaded
 */
export async function buildMasterKeyManager(seed, userid) {
  if (!(seed instanceof Uint8Array) && !Buffer.isBuffer(seed)) {
    throw new Error('[ceremony-browser] buildMasterKeyManager: seed must be Uint8Array or Buffer');
  }
  if (seed.length !== 32) {
    throw new Error('[ceremony-browser] buildMasterKeyManager: seed must be 32 bytes');
  }
  if (typeof userid !== 'string' || !userid) {
    throw new Error('[ceremony-browser] buildMasterKeyManager: userid must be a non-empty string');
  }

  const kbpgp = await _loadKbpgpBundle();

  const { keywrapper, userid: useridModule, kbnacl, ecc } = kbpgp;
  const { Lifespan, Primary, Subkey } = keywrapper;
  const { UserID } = useridModule;
  const { EDDSA } = ecc;
  const ECDH = ecc.ecdh.ECDH;
  const { KeyManager } = kbpgp;
  const C = kbpgp.const;
  const F = C.openpgp.key_flags;

  // Ensure seed is a Buffer (kbpgp internals expect Node Buffer interface)
  const seedBuf = Buffer.from(seed);

  // Step 1: Derive Ed25519 keypair deterministically from seed
  const naclw = kbnacl.alloc({});
  const { publicKey, secretKey } = naclw.genFromSeed({ seed: seedBuf });

  const pub = new EDDSA.Pub({ key: Buffer.from(publicKey) });
  const priv = new EDDSA.Priv({ seed: seedBuf, key: Buffer.from(secretKey), pub });

  // EDDSA.Pair is the Pair constructor — it's the same as EDDSA itself in the bundle
  // (kbpgp/lib/ecc/eddsa exports: EDDSA = Pair = the Pair class)
  const EdPair = EDDSA;
  const pair = new EdPair({ pub, priv });

  // Step 2: Derive creation timestamp from seed for fingerprint determinism
  const created = derivedTimestamp(seedBuf);

  // Step 3: Wrap in Primary keywrapper
  const primary = new Primary({
    key: pair,
    lifespan: new Lifespan({ generated: created, expire_in: 0 }),
    flags: F.certify_keys | F.sign_data,
  });

  // Step 4: Generate random ECDH encryption subkey
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

  // Step 6: Self-sign
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
 * Browser version — uses window.kbpgp.KeyManager.generate_ecc.
 *
 * @param {string} userid - PGP userid string
 * @returns {Promise<object>} kbpgp KeyManager with private key loaded
 */
export async function buildLeafKeyManager(userid) {
  if (typeof userid !== 'string' || !userid) {
    throw new Error('[ceremony-browser] buildLeafKeyManager: userid must be a non-empty string');
  }

  const kbpgp = await _loadKbpgpBundle();
  const { KeyManager } = kbpgp;

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
