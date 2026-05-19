// SPDX-License-Identifier: AGPL-3.0-or-later
//
// key-store.js — Passenger sovereign key storage and signing context
//
// Implements koad.passenger.* API:
//   koad.passenger.signingContext()         → Promise<{ entity, privateKey, pubkeyBytes, sigchainTip }>
//   koad.passenger.activeDeviceKey()        → { id, description } | null
//   koad.passenger.importKey(seed, opts)    → Promise<void>
//   koad.passenger.generateKey(opts)        → Promise<{ pubkeyHex }>
//   koad.passenger.updateSigchainTip(cid)   → Promise<void>
//   koad.passenger.listKeys()               → Promise<Array<{ id, entity, description, publicKey }>>
//   koad.passenger.deleteKey(id)            → Promise<void>
//   koad.passenger.setActiveKey(id)         → void
//   koad.passenger.clearSession()           → void
//
// Storage: IndexedDB (koad.passenger.keystore), all private keys encrypted
// Encryption: PBKDF2 → AES-GCM (WebCrypto, never leaves the browser)
// Signing: @noble/ed25519 (provided by koad:io-sovereign-profiles via Npm.depends)
//
// Security model:
//   - Private key bytes never stored in plaintext
//   - Passphrase never stored; only derived AES key lives in memory during a session
//   - Session can be cleared at any time via clearSession()
//   - Keys remain encrypted at rest even across browser restarts
//
// Phase 2 (not in this file): browser-extension-native key signing (message
// passing to a privileged extension background context that holds the key).

// ── Constants ─────────────────────────────────────────────────────────────────

const DB_NAME    = 'koad.passenger.keystore';
const DB_VERSION = 1;
const KEYS_STORE = 'keys';
const TIPS_STORE = 'tips';

const PBKDF2_ITERATIONS = 200_000;
const PBKDF2_HASH       = 'SHA-256';
const AES_KEY_LEN       = 256;
const SALT_LEN          = 16;  // bytes
const IV_LEN            = 12;  // bytes for AES-GCM

// ── Module-level session state ────────────────────────────────────────────────

// Active session: decrypted key material held in memory only for the duration
// of a user session. Cleared by clearSession() or page unload.
let _sessionAesKey   = null;  // CryptoKey (AES-GCM), derived from passphrase
let _sessionSalt     = null;  // Uint8Array — salt used to derive _sessionAesKey
let _activeKeyId     = null;  // string — id of the currently active key record
let _cachedPrivKey   = null;  // Uint8Array (32 bytes) — decrypted private key seed
let _cachedPubKey    = null;  // Uint8Array (32 bytes) — public key
let _cachedEntity    = null;  // string — entity name from the active key record

// ── IndexedDB helpers ─────────────────────────────────────────────────────────

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = function(event) {
      const db = event.target.result;

      if (!db.objectStoreNames.contains(KEYS_STORE)) {
        const ks = db.createObjectStore(KEYS_STORE, { keyPath: 'id' });
        ks.createIndex('entity', 'entity', { unique: false });
      }

      if (!db.objectStoreNames.contains(TIPS_STORE)) {
        db.createObjectStore(TIPS_STORE, { keyPath: 'entity' });
      }
    };

    req.onsuccess  = () => resolve(req.result);
    req.onerror    = () => reject(req.error);
    req.onblocked  = () => reject(new Error('IndexedDB blocked — close other tabs using this extension'));
  });
}

function dbGet(db, store, key) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

function dbPut(db, store, value) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).put(value);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

function dbDelete(db, store, key) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).delete(key);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

function dbGetAll(db, store) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

// ── WebCrypto helpers ─────────────────────────────────────────────────────────

function randomBytes(len) {
  return crypto.getRandomValues(new Uint8Array(len));
}

/**
 * Derive an AES-GCM CryptoKey from a passphrase + salt using PBKDF2.
 *
 * @param {string}     passphrase
 * @param {Uint8Array} salt
 * @returns {Promise<CryptoKey>}
 */
async function deriveAesKey(passphrase, salt) {
  const enc          = new TextEncoder();
  const passphraseKey = await crypto.subtle.importKey(
    'raw', enc.encode(passphrase),
    { name: 'PBKDF2' },
    false, ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: PBKDF2_HASH,
    },
    passphraseKey,
    { name: 'AES-GCM', length: AES_KEY_LEN },
    false,   // not extractable — key never leaves WebCrypto
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt a 32-byte Ed25519 seed with AES-GCM.
 *
 * @param {Uint8Array} seedBytes  — 32-byte private key seed
 * @param {CryptoKey}  aesKey
 * @returns {Promise<{ encrypted: Uint8Array, iv: Uint8Array }>}
 */
async function encryptSeed(seedBytes, aesKey) {
  const iv        = randomBytes(IV_LEN);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    seedBytes
  );
  return { encrypted: new Uint8Array(encrypted), iv };
}

/**
 * Decrypt an AES-GCM-encrypted Ed25519 seed.
 *
 * @param {Uint8Array} encrypted
 * @param {Uint8Array} iv
 * @param {CryptoKey}  aesKey
 * @returns {Promise<Uint8Array>}  — 32-byte seed
 */
async function decryptSeed(encrypted, iv, aesKey) {
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    encrypted
  );
  return new Uint8Array(decrypted);
}

// ── Ed25519 helpers ───────────────────────────────────────────────────────────

/**
 * Derive the Ed25519 public key from a 32-byte seed.
 * Delegates to koad.sovereign.ed25519GetPublicKey, which is exposed by the
 * koad:io-sovereign-profiles package using the same @noble/ed25519 Npm dep.
 * key-store.js MUST load after koad:io-sovereign-profiles initializes.
 *
 * @param {Uint8Array} seedBytes — 32-byte private key seed
 * @returns {Promise<Uint8Array>} — 32-byte public key
 */
async function pubkeyFromSeed(seedBytes) {
  if (koad && koad.sovereign && typeof koad.sovereign.ed25519GetPublicKey === 'function') {
    return koad.sovereign.ed25519GetPublicKey(seedBytes);
  }

  throw new Error(
    'koad.passenger: koad.sovereign.ed25519GetPublicKey not available. ' +
    'Ensure koad:io-sovereign-profiles is loaded before key-store.js.'
  );
}

// ── Internal: session management ──────────────────────────────────────────────

/**
 * Unlock the session: derive the AES key and cache the active key's private bytes.
 * Throws if the passphrase is wrong (AES-GCM decryption will fail).
 *
 * @param {string} keyId       — record id to unlock
 * @param {string} passphrase
 * @returns {Promise<void>}
 */
async function _unlockSession(keyId, passphrase) {
  const db     = await openDb();
  const record = await dbGet(db, KEYS_STORE, keyId);

  if (!record) throw new Error(`koad.passenger: key "${keyId}" not found`);

  const salt   = record.salt;       // Uint8Array
  const iv     = record.iv;         // Uint8Array
  const enc    = record.encryptedKey; // Uint8Array

  const aesKey  = await deriveAesKey(passphrase, salt);
  // This throws DOMException if wrong passphrase:
  const seed    = await decryptSeed(enc, iv, aesKey);

  // Cache in memory
  _sessionAesKey = aesKey;
  _sessionSalt   = salt;
  _activeKeyId   = keyId;
  _cachedPrivKey = seed;
  _cachedPubKey  = record.publicKey;
  _cachedEntity  = record.entity;
}

// ── Public API ────────────────────────────────────────────────────────────────

// Declared without `const` so Meteor treats this as an eager global (same
// pattern as other Passenger client scripts which avoid import/export).
PassengerKeyStore = {};

/**
 * Import an existing Ed25519 key (raw 32-byte seed) into the key store.
 * Encrypts the seed with PBKDF2 + AES-GCM before storing.
 *
 * @param {Uint8Array|string} seedInput — 32-byte seed as Uint8Array, or hex string
 * @param {object}            opts
 * @param {string}            opts.entity        — entity name (e.g. 'juno')
 * @param {string}            opts.passphrase     — user passphrase for encryption
 * @param {string}            [opts.id]           — key id (default: 'root')
 * @param {string}            [opts.description]  — human-readable label
 * @returns {Promise<{ id: string, publicKey: Uint8Array }>}
 */
PassengerKeyStore.importKey = async function(seedInput, opts) {
  const { entity, passphrase, id = 'root', description = `${entity} root key` } = opts;

  if (!entity)     throw new Error('koad.passenger.importKey: entity is required');
  if (!passphrase) throw new Error('koad.passenger.importKey: passphrase is required');

  // Normalize seed
  let seedBytes;
  if (typeof seedInput === 'string') {
    // Hex string: each pair of hex chars → one byte
    if (seedInput.length !== 64) {
      throw new Error('koad.passenger.importKey: hex seed must be 64 chars (32 bytes)');
    }
    seedBytes = new Uint8Array(seedInput.match(/.{2}/g).map(b => parseInt(b, 16)));
  } else if (seedInput instanceof Uint8Array) {
    seedBytes = seedInput;
  } else {
    throw new TypeError('koad.passenger.importKey: seedInput must be Uint8Array or hex string');
  }

  if (seedBytes.length !== 32) {
    throw new Error('koad.passenger.importKey: Ed25519 seed must be exactly 32 bytes');
  }

  const salt             = randomBytes(SALT_LEN);
  const aesKey           = await deriveAesKey(passphrase, salt);
  const { encrypted, iv } = await encryptSeed(seedBytes, aesKey);
  const publicKey        = await pubkeyFromSeed(seedBytes);

  const record = {
    id,
    entity,
    description,
    encryptedKey: encrypted,
    publicKey,
    salt,
    iv,
    createdAt: new Date().toISOString(),
  };

  const db = await openDb();
  await dbPut(db, KEYS_STORE, record);

  // Auto-activate this key in the session
  _sessionAesKey = aesKey;
  _sessionSalt   = salt;
  _activeKeyId   = id;
  _cachedPrivKey = seedBytes;
  _cachedPubKey  = publicKey;
  _cachedEntity  = entity;

  return { id, publicKey };
};

/**
 * Generate a fresh Ed25519 keypair, encrypt it, and store it.
 *
 * @param {object} opts
 * @param {string} opts.entity       — entity name
 * @param {string} opts.passphrase   — user passphrase
 * @param {string} [opts.id]         — key id (default: 'root')
 * @param {string} [opts.description]
 * @returns {Promise<{ id: string, publicKey: Uint8Array, publicKeyHex: string }>}
 */
PassengerKeyStore.generateKey = async function(opts) {
  const seed = randomBytes(32);
  const result = await PassengerKeyStore.importKey(seed, opts);

  const hexChars = [];
  result.publicKey.forEach(b => hexChars.push(b.toString(16).padStart(2, '0')));
  return {
    id: result.id,
    publicKey: result.publicKey,
    publicKeyHex: hexChars.join(''),
  };
};

/**
 * Unlock a stored key with a passphrase and cache it for the session.
 * Subsequent calls to signingContext() use the cached key without re-prompting.
 *
 * @param {string} keyId
 * @param {string} passphrase
 * @returns {Promise<void>}
 */
PassengerKeyStore.unlock = async function(keyId, passphrase) {
  await _unlockSession(keyId, passphrase);
};

/**
 * Return signing context for the active key.
 * If the session is not unlocked, throws with a clear message.
 *
 * @returns {Promise<{ entity: string, privateKey: Uint8Array, pubkeyBytes: Uint8Array, sigchainTip: string|null }>}
 */
PassengerKeyStore.signingContext = async function() {
  if (!_cachedPrivKey || !_activeKeyId) {
    throw new Error(
      'koad.passenger: no key unlocked. Call koad.passenger.unlock(id, passphrase) first, ' +
      'or import/generate a key via the key management UI.'
    );
  }

  const db  = await openDb();
  const tip = await dbGet(db, TIPS_STORE, _cachedEntity);

  return {
    entity:      _cachedEntity,
    privateKey:  _cachedPrivKey,
    pubkeyBytes: _cachedPubKey,
    sigchainTip: tip ? tip.tipCid : null,
  };
};

/**
 * Return the active device key info (id + description), or null if no key is active.
 *
 * @returns {{ id: string, description: string, publicKey: Uint8Array } | null}
 */
PassengerKeyStore.activeDeviceKey = function() {
  if (!_activeKeyId || !_cachedPubKey) return null;
  return {
    id:          _activeKeyId,
    description: _cachedEntity ? `${_cachedEntity} — ${_activeKeyId}` : _activeKeyId,
    publicKey:   _cachedPubKey,
  };
};

/**
 * Update the locally-stored sigchain tip CID for the active entity.
 * Called by the profile editor after a successful publish.
 *
 * @param {string} cid — new tip CID
 * @returns {Promise<void>}
 */
PassengerKeyStore.updateSigchainTip = async function(cid) {
  if (!_cachedEntity) {
    throw new Error('koad.passenger: no key active. Cannot update sigchain tip.');
  }
  const db = await openDb();
  await dbPut(db, TIPS_STORE, {
    entity:    _cachedEntity,
    tipCid:    cid,
    updatedAt: new Date().toISOString(),
  });
};

/**
 * Set the active key by id without re-decrypting.
 * Used when switching between multiple keys that are already in the store.
 * The session must be re-unlocked if the passphrase is needed for the new key.
 *
 * @param {string} id
 */
PassengerKeyStore.setActiveKey = function(id) {
  // Clear cached private material — caller must unlock() if they need to sign
  _activeKeyId   = id;
  _cachedPrivKey = null;
  _cachedPubKey  = null;
  _cachedEntity  = null;
  _sessionAesKey = null;
};

/**
 * List all stored key records (public metadata only — no private key material).
 *
 * @returns {Promise<Array<{ id, entity, description, publicKey, createdAt }>>}
 */
PassengerKeyStore.listKeys = async function() {
  const db      = await openDb();
  const records = await dbGetAll(db, KEYS_STORE);
  return records.map(r => ({
    id:          r.id,
    entity:      r.entity,
    description: r.description,
    publicKey:   r.publicKey,
    createdAt:   r.createdAt,
  }));
};

/**
 * Delete a stored key by id. Also clears the session if it was the active key.
 *
 * @param {string} id
 * @returns {Promise<void>}
 */
PassengerKeyStore.deleteKey = async function(id) {
  if (_activeKeyId === id) PassengerKeyStore.clearSession();
  const db = await openDb();
  await dbDelete(db, KEYS_STORE, id);
};

/**
 * Export a stored key's private seed as a hex string for backup.
 *
 * Re-derives the PBKDF2 key from the provided passphrase + the record's stored salt,
 * decrypts the AES-GCM ciphertext, and returns the raw 32-byte Ed25519 seed as a
 * lowercase hex string (64 chars). Hex is preferred over PEM here because the key
 * material is a raw seed, not a PKCS#8 envelope; hex is unambiguous and trivially
 * re-importable via importKey().
 *
 * Decrypted bytes are zeroed before the function returns.
 *
 * @param {string} id         — key record id
 * @param {string} passphrase — passphrase used when the key was stored
 * @returns {Promise<string>} — 64-char lowercase hex seed
 * @throws if the key is not found or the passphrase is wrong
 */
PassengerKeyStore.exportKey = async function(id, passphrase) {
  if (!id)         throw new Error('koad.passenger.exportKey: id is required');
  if (!passphrase) throw new Error('koad.passenger.exportKey: passphrase is required');

  const db     = await openDb();
  const record = await dbGet(db, KEYS_STORE, id);

  if (!record) throw new Error(`koad.passenger.exportKey: key "${id}" not found`);

  const salt = record.salt;           // Uint8Array
  const iv   = record.iv;             // Uint8Array
  const enc  = record.encryptedKey;   // Uint8Array

  // Re-derive AES key from passphrase + stored salt.
  // This will throw (DOMException) if the passphrase is wrong — AES-GCM auth tag fails.
  const aesKey   = await deriveAesKey(passphrase, salt);
  const seedBytes = await decryptSeed(enc, iv, aesKey);

  // Convert to hex
  const hex = Array.from(seedBytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  // Zero the seed bytes in place to limit exposure window
  seedBytes.fill(0);

  return hex;
};

/**
 * Clear the in-memory session (decrypted key material).
 * The encrypted key record remains in IndexedDB — only the live session is dropped.
 */
PassengerKeyStore.clearSession = function() {
  _sessionAesKey = null;
  _sessionSalt   = null;
  _activeKeyId   = null;
  _cachedPrivKey = null;
  _cachedPubKey  = null;
  _cachedEntity  = null;
};

// ── Attach to koad.passenger global ──────────────────────────────────────────

if (typeof koad === 'undefined') {
  // Defensive: koad:io framework should have initialized koad before this file
  // runs, but guard against load-order edge cases in development.
  console.warn('key-store.js: koad global not found — defining empty stub. Ensure koad:io-core loads first.');
  koad = {};
}

koad.passenger = koad.passenger || {};

koad.passenger.signingContext    = PassengerKeyStore.signingContext;
koad.passenger.activeDeviceKey   = PassengerKeyStore.activeDeviceKey;
koad.passenger.importKey         = PassengerKeyStore.importKey;
koad.passenger.generateKey       = PassengerKeyStore.generateKey;
koad.passenger.unlock            = PassengerKeyStore.unlock;
koad.passenger.updateSigchainTip = PassengerKeyStore.updateSigchainTip;
koad.passenger.setActiveKey      = PassengerKeyStore.setActiveKey;
koad.passenger.listKeys          = PassengerKeyStore.listKeys;
koad.passenger.exportKey         = PassengerKeyStore.exportKey;
koad.passenger.deleteKey         = PassengerKeyStore.deleteKey;
koad.passenger.clearSession      = PassengerKeyStore.clearSession;
