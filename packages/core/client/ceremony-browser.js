// ceremony-browser.js — BIP39 → Ed25519 → kbpgp KeyManager derivation for the browser
//
// Implements VESTA-SPEC-149 v1.0 browser path.
// Browser counterpart to ~/.koad-io/modules/node/ceremony.js.
//
// This file lives in the Meteor package (koad:io-core) and is imported by deps.js.
// Meteor resolves @scure/bip39 from this package's Npm.depends.
// kbpgp internals come from window.kbpgp (loaded by the extended kbpgp bundle).
//
// Exposed via: koad.deps.ceremony (set by deps.js)
// API surface: { buildMasterKeyManager, buildLeafKeyManager, extractKMInfo,
//                entropyToMnemonicString, mnemonicToSeed, isValidMnemonic,
//                generateEntropy, mnemonicToBuffer, zeroBuffer }

import { entropyToMnemonic, mnemonicToEntropy, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';

// ---------------------------------------------------------------------------
// Constants — identical to ceremony.js
// ---------------------------------------------------------------------------

const TIMESTAMP_BASE = 1700000000;
const TIMESTAMP_WINDOW = 365 * 24 * 3600;

// ---------------------------------------------------------------------------
// Bundle loader — coordinates with client/pgp.js lazy loader
// ---------------------------------------------------------------------------

let _kbpgp = null;

async function _loadKbpgpBundle() {
  if (_kbpgp) return _kbpgp;
  if (typeof window !== 'undefined' && window.kbpgp) {
    _kbpgp = window.kbpgp;
    return _kbpgp;
  }

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
// Entropy generation
// ---------------------------------------------------------------------------

export async function generateEntropy() {
  const bytes = new Uint8Array(32);
  window.crypto.getRandomValues(bytes);
  return bytes;
}

// ---------------------------------------------------------------------------
// Mnemonic helpers
// ---------------------------------------------------------------------------

export function entropyToMnemonicString(entropy) {
  return entropyToMnemonic(entropy, wordlist);
}

export function mnemonicToSeed(mnemonic) {
  return mnemonicToEntropy(mnemonic, wordlist);
}

export function isValidMnemonic(mnemonic) {
  try {
    return validateMnemonic(mnemonic, wordlist);
  } catch (_) {
    return false;
  }
}

export function mnemonicToBuffer(mnemonic) {
  const enc = new TextEncoder();
  return enc.encode(mnemonic);
}

export function zeroBuffer(buf) {
  if (buf instanceof Uint8Array) {
    buf.fill(0x00);
  }
}

// ---------------------------------------------------------------------------
// Key derivation timestamp
// ---------------------------------------------------------------------------

export function derivedTimestamp(seed) {
  const offset = ((seed[0] << 24) | (seed[1] << 16) | (seed[2] << 8) | seed[3]) >>> 0;
  return TIMESTAMP_BASE + (offset % TIMESTAMP_WINDOW);
}

// ---------------------------------------------------------------------------
// KeyManager construction
// ---------------------------------------------------------------------------

/**
 * Build a deterministic kbpgp Ed25519 (EDDSA) KeyManager from a 32-byte seed.
 * Browser version — uses window.kbpgp internals from the extended kbpgp bundle.
 *
 * @param {Uint8Array|Buffer} seed - 32-byte master seed
 * @param {string} userid - PGP userid string
 * @returns {Promise<object>} kbpgp KeyManager with private key loaded
 */
export async function buildMasterKeyManager(seed, userid) {
  if (!(seed instanceof Uint8Array) && (typeof Buffer === 'undefined' || !Buffer.isBuffer(seed))) {
    throw new Error('[ceremony-browser] buildMasterKeyManager: seed must be Uint8Array or Buffer');
  }
  if (seed.length !== 32) {
    throw new Error('[ceremony-browser] buildMasterKeyManager: seed must be 32 bytes');
  }
  if (typeof userid !== 'string' || !userid) {
    throw new Error('[ceremony-browser] buildMasterKeyManager: userid must be a non-empty string');
  }

  const kbpgp = await _loadKbpgpBundle();

  // Verify the extended bundle is loaded (has ceremony internals)
  if (!kbpgp.keywrapper || !kbpgp.kbnacl) {
    throw new Error(
      '[ceremony-browser] kbpgp bundle is missing ceremony internals. ' +
      'Ensure /kbpgp.bundle.min.js is the extended bundle (built from kbpgp-with-internals.js).'
    );
  }

  const { keywrapper, userid: useridModule, kbnacl, ecc } = kbpgp;
  const { Lifespan, Primary, Subkey } = keywrapper;
  const { UserID } = useridModule;
  const { EDDSA } = ecc;
  const ECDH = ecc.ecdh.ECDH;
  const { KeyManager } = kbpgp;
  const C = kbpgp.const;
  const F = C.openpgp.key_flags;

  // Ensure seed is a Buffer (kbpgp internals expect Node Buffer interface — available in browser via bundle)
  const seedBuf = Buffer.from(seed);

  // Step 1: Derive Ed25519 keypair deterministically from seed
  const naclw = kbnacl.alloc({});
  const { publicKey, secretKey } = naclw.genFromSeed({ seed: seedBuf });

  const pub = new EDDSA.Pub({ key: Buffer.from(publicKey) });
  const priv = new EDDSA.Priv({ seed: seedBuf, key: Buffer.from(secretKey), pub });

  // EDDSA itself is the Pair class (kbpgp/lib/ecc/eddsa exports EDDSA = Pair)
  const pair = new EDDSA({ pub, priv });

  // Step 2: Derive creation timestamp from seed
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
 * Generate a random leaf (device) KeyManager.
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
