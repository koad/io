// identity.js — koad.identity substrate API (ESM)
//
// Implements VESTA-SPEC-149 v1.0.
//
// This module exports `createKoadIdentity()` which returns a koad.identity
// object with the full API surface. Bootstrap modules (server identity-init,
// dark-passenger, CLI key-loader) call createKoadIdentity() at boot and attach
// the result to globalThis.koad.identity.
//
// Flight A: API shape + state wiring + real sign/verify delegation.
//           Ceremony internals (BIP39 derivation, OPFS, sigchain writes)
//           are stubbed and throw clearly — see Flight B markers below.
//
// API surface (SPEC-149 §7, corrected for entity=spirit):
//
//   Lifecycle:
//     koad.identity.create({ handle, userid })   — lockdown ceremony
//     koad.identity.load({ ... })                — routine boot
//     koad.identity.lockdown()                   — scrub master + mnemonic
//     koad.identity.importMnemonic({ mnemonic }) — recovery reconstitution
//
//   Signing:
//     koad.identity.sign(payload)                — leaf signs; master if in ceremony
//     koad.identity.verify(armored, pubkey)      — PGP verify via koad.deps.pgp
//
//   State (read-only properties):
//     koad.identity.isLoaded          — leaf loaded and ready to sign?
//     koad.identity.isMasterLoaded    — master transiently in memory?
//     koad.identity.handle            — entity handle string
//     koad.identity.fingerprint       — leaf fingerprint (40 hex)
//     koad.identity.masterFingerprint — master fingerprint (40 hex)
//     koad.identity.sigchainHeadCID   — CID of most recent sigchain entry
//     koad.identity.publicKey         — armored leaf public key
//     koad.identity.masterPublicKey   — armored master public key
//     koad.identity.type              — 'pgp' (implementation detail: kbpgp)
//     koad.identity.posture           — 'routine' | 'ceremony' | 'recovery' | null
//
// Usage:
//   import { createKoadIdentity } from '@koad-io/node/identity';
//   globalThis.koad.identity = createKoadIdentity();
//   await koad.identity.load({ keyPath, sigchainHeadCID });

// ---------------------------------------------------------------------------
// Internal state — private to this factory closure
// ---------------------------------------------------------------------------

/**
 * Create an internal state bag. All mutable identity state lives here;
 * the public API exposes only getters over this object.
 */
function _makeState() {
  return {
    posture: null,           // 'routine' | 'ceremony' | 'recovery' | null
    handle: null,            // spirit handle string
    // leaf (device key)
    device: null,            // { fingerprint, keyManager, type }
    // master key — transient, ceremony only
    master: null,            // { keyManager, type } | null
    mnemonic: null,          // string | null — ceremony §3 window only
    // pubkeys that persist after lockdown
    masterFingerprint: null, // 40-hex string
    masterPublicKey: null,   // armored master pubkey (not sensitive)
    sigchainHeadCID: null,   // CID string | null
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a koad.identity object. Attach to globalThis.koad.identity at boot.
 *
 * @returns {object} The koad.identity API object.
 */
export function createKoadIdentity() {
  const _s = _makeState();

  // -------------------------------------------------------------------------
  // State helpers (internal)
  // -------------------------------------------------------------------------

  function _assertLoaded() {
    if (!_s.device || !_s.device.keyManager) {
      throw new Error('[koad/identity] No leaf key loaded. Call load() or create() first.');
    }
  }

  function _assertMasterLoaded() {
    if (!_s.master || !_s.master.keyManager) {
      throw new Error('[koad/identity] Master key is not in memory. Only available during ceremony.');
    }
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  const identity = {

    // -----------------------------------------------------------------------
    // Lifecycle
    // -----------------------------------------------------------------------

    /**
     * Lockdown ceremony — generate master + first device leaf, write genesis
     * sigchain entries, show mnemonic, lock down master after quiz confirmation.
     *
     * SPEC-149 §6.
     *
     * @param {object} opts
     * @param {string} opts.handle  - Spirit handle (e.g. 'koad')
     * @param {string} opts.userid  - PGP userid string (e.g. 'koad <koad@koad.sh>')
     * @returns {Promise<void>}
     */
    async create({ handle, userid } = {}) {
      if (!handle) throw new Error('[koad/identity] create() requires handle');
      if (!userid) throw new Error('[koad/identity] create() requires userid');
      // Flight B: BIP39 entropy → mnemonic → seed → master Ed25519 PGP keypair.
      // Flight B: Device leaf generation (independent of mnemonic).
      // Flight B: Genesis sigchain entry + leaf-authorize entry (SPEC-111 v1.9 §5.8).
      // Flight C: Mnemonic display UI (§6 step 3) + confirmation quiz (§6 step 5).
      // Flight B: Lockdown (§6 step 6) — zero mnemonic + master private from memory,
      //           persist leaf encrypted-at-rest, persist master pubkey, publish to IPFS.
      throw new Error(
        '[koad/identity] create() — not yet implemented. Ceremony internals land in Flight B.' +
        ' (BIP39 derivation, sigchain genesis, lockdown scrub, IPFS publish)'
      );
    },

    /**
     * Routine boot — load a persisted device leaf into memory.
     *
     * SPEC-149 §8 bootstrap steps 1–5.
     *
     * @param {object} opts
     * @param {string} opts.handle          - Spirit handle
     * @param {string} opts.masterFingerprint  - 40-hex master pubkey fingerprint
     * @param {string} opts.masterPublicKey    - Armored master public key
     * @param {object} opts.keyManager      - kbpgp KeyManager with leaf private key loaded
     *                                        (decryption is caller's responsibility — platform-specific)
     * @param {string} opts.leafFingerprint - 40-hex leaf fingerprint
     * @param {string} opts.leafPublicKey   - Armored leaf public key
     * @param {string} [opts.sigchainHeadCID] - CID of current sigchain tip (may be null for new spirits)
     * @returns {void}
     */
    load({
      handle,
      masterFingerprint,
      masterPublicKey,
      keyManager,
      leafFingerprint,
      leafPublicKey,
      sigchainHeadCID = null,
    } = {}) {
      if (!handle) throw new Error('[koad/identity] load() requires handle');
      if (!masterFingerprint) throw new Error('[koad/identity] load() requires masterFingerprint');
      if (!keyManager) throw new Error('[koad/identity] load() requires keyManager');
      if (!leafFingerprint) throw new Error('[koad/identity] load() requires leafFingerprint');

      _s.handle = handle;
      _s.masterFingerprint = masterFingerprint;
      _s.masterPublicKey = masterPublicKey || null;
      _s.device = {
        fingerprint: leafFingerprint,
        publicKey: leafPublicKey || null,
        keyManager,
        type: 'ed25519-pgp',
      };
      _s.master = null;
      _s.mnemonic = null;
      _s.sigchainHeadCID = sigchainHeadCID;
      _s.posture = 'routine';
    },

    /**
     * Scrub master key + mnemonic from memory. Call after lockdown ceremony
     * step 6 is complete.
     *
     * SPEC-149 §6 step 6. Atomically sets master + mnemonic to null.
     * After this call, isMasterLoaded === false and posture transitions to 'routine'.
     *
     * @returns {void}
     */
    lockdown() {
      // Zero the mnemonic string if possible. JS strings are immutable, so we
      // can only drop the reference — the V8 GC will handle reclaim. A future
      // Flight B implementation may use a Buffer or Uint8Array for the mnemonic
      // to enable deterministic zeroing.
      _s.mnemonic = null;
      _s.master = null;
      if (_s.posture === 'ceremony' || _s.posture === 'recovery') {
        _s.posture = 'routine';
      }
    },

    /**
     * Recovery — reconstitute master from BIP39 mnemonic, prune all existing
     * leaves, generate fresh device leaf, publish sigchain entries.
     *
     * SPEC-149 §7.3.
     *
     * @param {object} opts
     * @param {string} opts.mnemonic - 24-word BIP39 mnemonic (space-separated)
     * @returns {Promise<void>}
     */
    async importMnemonic({ mnemonic } = {}) {
      if (!mnemonic) throw new Error('[koad/identity] importMnemonic() requires mnemonic');
      // Flight B: BIP39 seed derivation → master Ed25519 PGP keypair reconstitution.
      // Flight B: koad.prune-all sigchain entry (master-signed, SPEC-111 v1.9 §5.8).
      // Flight B: Fresh device leaf generation + koad.leaf-authorize entry.
      // Flight B: Lockdown after new leaf is authorized.
      throw new Error(
        '[koad/identity] importMnemonic() — not yet implemented. Recovery ceremony lands in Flight B.'
      );
    },

    // -----------------------------------------------------------------------
    // Signing
    // -----------------------------------------------------------------------

    /**
     * Sign a payload string. Uses the device leaf by default.
     * During ceremony posture with master loaded, master may be used if
     * opts.useMaster === true (for signing genesis/leaf-authorize entries only).
     *
     * Delegates to koad.deps.pgp.clearsign when available; throws if not wired.
     *
     * SPEC-149 §7, SPEC-148.
     *
     * @param {string} payload         - Plaintext payload to clearsign
     * @param {object} [opts]
     * @param {boolean} [opts.useMaster] - Use master key instead of leaf (ceremony only)
     * @returns {Promise<string>} RFC 4880 clearsign armored string
     */
    async sign(payload, { useMaster = false } = {}) {
      if (typeof payload !== 'string') {
        throw new Error('[koad/identity] sign() requires a string payload');
      }

      if (useMaster) {
        _assertMasterLoaded();
        const km = _s.master.keyManager;
        return _delegateClearsign(payload, km);
      }

      _assertLoaded();
      const km = _s.device.keyManager;
      return _delegateClearsign(payload, km);
    },

    /**
     * Verify an RFC 4880 clearsigned message against a public key.
     *
     * Delegates to koad.deps.pgp.verify when available.
     *
     * SPEC-149 §7, SPEC-148.
     *
     * @param {string} armored - RFC 4880 clearsign armored string
     * @param {string} pubkey  - Armored PGP public key
     * @returns {Promise<{verified: boolean, payload?: string, error?: string}>}
     */
    async verify(armored, pubkey) {
      if (typeof armored !== 'string') {
        throw new Error('[koad/identity] verify() requires armored string');
      }
      if (typeof pubkey !== 'string') {
        throw new Error('[koad/identity] verify() requires pubkey string');
      }
      return _delegateVerify(armored, pubkey);
    },

    // -----------------------------------------------------------------------
    // State — read-only getters (SPEC-149 §7 canonical slots)
    // -----------------------------------------------------------------------

    /** @returns {boolean} True if a device leaf is loaded and ready to sign */
    get isLoaded() {
      return !!(
        _s.device &&
        _s.device.keyManager &&
        (_s.posture === 'routine' || _s.posture === 'ceremony' || _s.posture === 'recovery')
      );
    },

    /** @returns {boolean} True if master key is transiently in memory */
    get isMasterLoaded() {
      return !!(_s.master && _s.master.keyManager);
    },

    /** @returns {string|null} Spirit handle string (e.g. 'koad') */
    get handle() {
      return _s.handle;
    },

    /** @returns {string|null} 40-hex leaf fingerprint */
    get fingerprint() {
      return _s.device ? _s.device.fingerprint : null;
    },

    /** @returns {string|null} 40-hex master pubkey fingerprint */
    get masterFingerprint() {
      return _s.masterFingerprint;
    },

    /** @returns {string|null} CID of most recent sigchain entry */
    get sigchainHeadCID() {
      return _s.sigchainHeadCID;
    },

    /** @returns {string|null} Armored leaf public key */
    get publicKey() {
      return _s.device ? _s.device.publicKey : null;
    },

    /** @returns {string|null} Armored master public key (not sensitive; persists after lockdown) */
    get masterPublicKey() {
      return _s.masterPublicKey;
    },

    /**
     * Key type tag.
     * 'pgp' — the user-facing type. Implementation detail (kbpgp) is not exported.
     * @returns {'pgp'}
     */
    get type() {
      return 'pgp';
    },

    /**
     * Current runtime posture.
     * 'routine' | 'ceremony' | 'recovery' | null
     * @returns {string|null}
     */
    get posture() {
      return _s.posture;
    },

    // -----------------------------------------------------------------------
    // Internal access — for bootstrap modules only
    // -----------------------------------------------------------------------

    /**
     * Expose internal device keyManager for bootstrap modules that need to
     * wire legacy koad.identity.setFromKeyManager() callers.
     *
     * @private — do not use from consumer code.
     */
    get _keyManager() {
      return _s.device ? _s.device.keyManager : null;
    },

    /**
     * setFromKeyManager — backwards-compat shim for identity-init.js callers.
     *
     * The old code called koad.identity.setFromKeyManager(km, cb).
     * This shim populates device state from a kbpgp KeyManager directly.
     * It does NOT set masterFingerprint or masterPublicKey — those require
     * the full load() call from a bootstrap module that has that data.
     *
     * @param {object} keyManager  - kbpgp KeyManager with private key
     * @param {function} [cb]      - Optional Node callback(err, ok)
     * @returns {void}
     */
    setFromKeyManager(keyManager, cb) {
      try {
        if (!keyManager) throw new Error('[koad/identity] setFromKeyManager() requires a keyManager');

        // Extract fingerprint from kbpgp key manager.
        // kbpgp stores fingerprint as a Buffer; convert to 40-hex string.
        let fp = null;
        if (keyManager.get_pgp_fingerprint) {
          const fpBuf = keyManager.get_pgp_fingerprint();
          fp = fpBuf ? fpBuf.toString('hex').toUpperCase() : null;
        }

        // Export public key armored string for the state bag.
        keyManager.export_pgp_public({}, (err, pgpPublic) => {
          if (err) {
            if (cb) return cb(err);
            throw err;
          }
          _s.device = {
            fingerprint: fp,
            publicKey: pgpPublic,
            keyManager,
            type: 'ed25519-pgp',
          };
          _s.posture = 'routine';
          if (cb) cb(null, true);
        });
      } catch (err) {
        if (cb) cb(err);
        else throw err;
      }
    },
  };

  return identity;
}

// ---------------------------------------------------------------------------
// Sign/verify delegation helpers
// ---------------------------------------------------------------------------

/**
 * Delegate clearsign to koad.deps.pgp if available, else require pgp.js directly.
 * This allows the module to work both in Meteor (where koad.deps.pgp is wired by
 * client/deps.js and server/deps.js) and in standalone Node contexts.
 *
 * @param {string} payload  - Plaintext to clearsign
 * @param {object} km       - kbpgp KeyManager
 * @returns {Promise<string>}
 */
async function _delegateClearsign(payload, km) {
  // Prefer globally available koad.deps.pgp (Meteor + daemon contexts)
  if (
    typeof globalThis !== 'undefined' &&
    globalThis.koad &&
    globalThis.koad.deps &&
    globalThis.koad.deps.pgp &&
    typeof globalThis.koad.deps.pgp.clearsign === 'function'
  ) {
    return globalThis.koad.deps.pgp.clearsign(payload, km);
  }

  // Standalone Node: import pgp.js directly from this package
  const { clearsign } = await import('./pgp.js');
  return clearsign(payload, km);
}

/**
 * Delegate verify to koad.deps.pgp if available, else import pgp.js.
 *
 * @param {string} armored  - RFC 4880 clearsign armored string
 * @param {string} pubkey   - Armored PGP public key
 * @returns {Promise<{verified: boolean, payload?: string, error?: string}>}
 */
async function _delegateVerify(armored, pubkey) {
  if (
    typeof globalThis !== 'undefined' &&
    globalThis.koad &&
    globalThis.koad.deps &&
    globalThis.koad.deps.pgp &&
    typeof globalThis.koad.deps.pgp.verify === 'function'
  ) {
    return globalThis.koad.deps.pgp.verify(armored, pubkey);
  }

  const { verify } = await import('./pgp.js');
  return verify(armored, pubkey);
}

// ---------------------------------------------------------------------------
// Legacy named exports — preserve backwards compatibility
// ---------------------------------------------------------------------------

/**
 * @deprecated Use createKoadIdentity() instead.
 * Retained so any import of { createIdentityShape } from '@koad-io/node/identity'
 * does not break during the transition period.
 */
export function createIdentityShape() {
  return {
    type: 'pgp',
    fingerprint: null,
    userid: null,
    publicKey: null,
  };
}

/**
 * @deprecated Use createKoadIdentity() instead.
 */
export function createIdentity({ type, userid, fingerprint = null, publicKey = null } = {}) {
  if (!type) throw new Error('[koad/identity] type is required');
  if (!userid) throw new Error('[koad/identity] userid is required');
  return { type, userid, fingerprint, publicKey };
}
