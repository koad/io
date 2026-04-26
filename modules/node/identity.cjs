// identity.cjs — CJS mirror of identity.js (VESTA-SPEC-149 v1.0)
//
// CJS entry for contexts that cannot consume ESM directly (Meteor server
// with older wiring, require()-based tooling). The API shape is identical
// to identity.js. Sign/verify delegation to koad.deps.pgp works the same way.
//
// Flight A: Full API surface + state wiring.
// Flight B: BIP39 derivation + Ed25519 PGP KeyManager construction + lockdown.
//
// ceremony.js is ESM-only; this file uses dynamic import() to load it.
// Dynamic import() is supported in Node.js 12+.

/**
 * Lazy-load ceremony helpers from ceremony.js (ESM).
 * @returns {Promise<object>}
 */
async function _ceremony() {
  return import('./ceremony.js');
}

'use strict';

// ---------------------------------------------------------------------------
// Internal state factory
// ---------------------------------------------------------------------------

function _makeState() {
  return {
    posture: null,
    handle: null,
    device: null,           // { fingerprint, publicKey, keyManager, type }
    master: null,           // { keyManager, type } | null — ceremony only
    mnemonic: null,         // string | null — ceremony §3 window only
    masterFingerprint: null,
    masterPublicKey: null,
    sigchainHeadCID: null,
  };
}

// ---------------------------------------------------------------------------
// Sign/verify delegation helpers
// ---------------------------------------------------------------------------

function _delegateClearsign(payload, km) {
  if (
    typeof globalThis !== 'undefined' &&
    globalThis.koad &&
    globalThis.koad.deps &&
    globalThis.koad.deps.pgp &&
    typeof globalThis.koad.deps.pgp.clearsign === 'function'
  ) {
    return globalThis.koad.deps.pgp.clearsign(payload, km);
  }
  // Standalone: load pgp.cjs (CJS build of pgp.js if present, otherwise throw with guidance)
  try {
    const { clearsign } = require('./pgp.cjs');
    return clearsign(payload, km);
  } catch (_e) {
    return Promise.reject(
      new Error(
        '[koad/identity] sign() requires koad.deps.pgp or pgp.cjs. ' +
        'Wire koad.deps.pgp before calling sign().'
      )
    );
  }
}

function _delegateVerify(armored, pubkey) {
  if (
    typeof globalThis !== 'undefined' &&
    globalThis.koad &&
    globalThis.koad.deps &&
    globalThis.koad.deps.pgp &&
    typeof globalThis.koad.deps.pgp.verify === 'function'
  ) {
    return globalThis.koad.deps.pgp.verify(armored, pubkey);
  }
  try {
    const { verify } = require('./pgp.cjs');
    return verify(armored, pubkey);
  } catch (_e) {
    return Promise.reject(
      new Error(
        '[koad/identity] verify() requires koad.deps.pgp or pgp.cjs. ' +
        'Wire koad.deps.pgp before calling verify().'
      )
    );
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function createKoadIdentity() {
  const _s = _makeState();

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

  const identity = {

    // -----------------------------------------------------------------------
    // Lifecycle
    // -----------------------------------------------------------------------

    async create({ handle, userid } = {}) {
      if (!handle) throw new Error('[koad/identity] create() requires handle');
      if (!userid) throw new Error('[koad/identity] create() requires userid');

      const {
        generateEntropySync,
        entropyToMnemonicString,
        mnemonicToSeed,
        mnemonicToBuffer,
        buildMasterKeyManager,
        buildLeafKeyManager,
        extractKMInfo,
      } = await _ceremony();

      const entropy = generateEntropySync();
      const mnemonicStr = entropyToMnemonicString(entropy);
      const masterSeed = mnemonicToSeed(mnemonicStr);
      const masterKM = await buildMasterKeyManager(masterSeed, userid);
      const { fingerprint: masterFP, publicKey: masterPub } = await extractKMInfo(masterKM);
      const leafKM = await buildLeafKeyManager(userid);
      const { fingerprint: leafFP, publicKey: leafPub } = await extractKMInfo(leafKM);
      const mnemonicBytes = mnemonicToBuffer(mnemonicStr);

      _s.handle = handle;
      _s.mnemonic = mnemonicBytes;
      _s.master = { keyManager: masterKM, type: 'ed25519-pgp' };
      _s.masterFingerprint = masterFP;
      _s.masterPublicKey = masterPub;
      _s.device = { fingerprint: leafFP, publicKey: leafPub, keyManager: leafKM, type: 'ed25519-pgp' };
      _s.sigchainHeadCID = null;
      _s.posture = 'ceremony';

      return { mnemonic: mnemonicStr, masterFingerprint: masterFP, leafFingerprint: leafFP };
    },

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

    lockdown() {
      if (_s.mnemonic instanceof Uint8Array) {
        _s.mnemonic.fill(0x00);
      }
      _s.mnemonic = null;
      _s.master = null;
      if (_s.posture === 'ceremony' || _s.posture === 'recovery') {
        _s.posture = 'routine';
      }
    },

    async importMnemonic({ mnemonic, userid } = {}) {
      if (!mnemonic) throw new Error('[koad/identity] importMnemonic() requires mnemonic');
      if (!userid) throw new Error('[koad/identity] importMnemonic() requires userid');

      const {
        isValidMnemonic,
        mnemonicToSeed,
        mnemonicToBuffer,
        buildMasterKeyManager,
        buildLeafKeyManager,
        extractKMInfo,
      } = await _ceremony();

      if (!isValidMnemonic(mnemonic)) {
        throw new Error('[koad/identity] importMnemonic() — invalid BIP39 mnemonic');
      }

      const masterSeed = mnemonicToSeed(mnemonic);
      const masterKM = await buildMasterKeyManager(masterSeed, userid);
      const { fingerprint: masterFP, publicKey: masterPub } = await extractKMInfo(masterKM);
      const leafKM = await buildLeafKeyManager(userid);
      const { fingerprint: leafFP, publicKey: leafPub } = await extractKMInfo(leafKM);
      const mnemonicBytes = mnemonicToBuffer(mnemonic);

      _s.handle = _s.handle || null;
      _s.mnemonic = mnemonicBytes;
      _s.master = { keyManager: masterKM, type: 'ed25519-pgp' };
      _s.masterFingerprint = masterFP;
      _s.masterPublicKey = masterPub;
      _s.device = { fingerprint: leafFP, publicKey: leafPub, keyManager: leafKM, type: 'ed25519-pgp' };
      _s.posture = 'recovery';

      return { masterFingerprint: masterFP, leafFingerprint: leafFP };
    },

    // -----------------------------------------------------------------------
    // Signing
    // -----------------------------------------------------------------------

    async sign(payload, { useMaster = false } = {}) {
      if (typeof payload !== 'string') {
        throw new Error('[koad/identity] sign() requires a string payload');
      }
      if (useMaster) {
        _assertMasterLoaded();
        return _delegateClearsign(payload, _s.master.keyManager);
      }
      _assertLoaded();
      return _delegateClearsign(payload, _s.device.keyManager);
    },

    async verify(armored, pubkey) {
      if (typeof armored !== 'string') throw new Error('[koad/identity] verify() requires armored string');
      if (typeof pubkey !== 'string') throw new Error('[koad/identity] verify() requires pubkey string');
      return _delegateVerify(armored, pubkey);
    },

    // -----------------------------------------------------------------------
    // State getters
    // -----------------------------------------------------------------------

    get isLoaded() {
      return !!(
        _s.device &&
        _s.device.keyManager &&
        (_s.posture === 'routine' || _s.posture === 'ceremony' || _s.posture === 'recovery')
      );
    },

    get isMasterLoaded() {
      return !!(_s.master && _s.master.keyManager);
    },

    get handle() { return _s.handle; },
    get fingerprint() { return _s.device ? _s.device.fingerprint : null; },
    get masterFingerprint() { return _s.masterFingerprint; },
    get sigchainHeadCID() { return _s.sigchainHeadCID; },
    get publicKey() { return _s.device ? _s.device.publicKey : null; },
    get masterPublicKey() { return _s.masterPublicKey; },
    get type() { return 'pgp'; },
    get posture() { return _s.posture; },
    /**
     * Returns the loaded device leaf keyManager, or null if no leaf is loaded.
     * Use this to access the underlying kbpgp KeyManager for operations that
     * the substrate doesn't directly expose (e.g., custom signing modes,
     * key export for at-rest encryption).
     *
     * @returns {object|null} kbpgp KeyManager or null
     */
    getKeyManager() { return _s.device ? _s.device.keyManager : null; },

    /** @deprecated Use getKeyManager() instead. Backwards-compat alias. */
    get _keyManager() { return _s.device ? _s.device.keyManager : null; },

    // Backwards-compat shim for identity-init.js
    setFromKeyManager(keyManager, cb) {
      try {
        if (!keyManager) throw new Error('[koad/identity] setFromKeyManager() requires a keyManager');

        let fp = null;
        if (keyManager.get_pgp_fingerprint) {
          const fpBuf = keyManager.get_pgp_fingerprint();
          fp = fpBuf ? fpBuf.toString('hex').toUpperCase() : null;
        }

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
// Legacy named exports — backwards compat
// ---------------------------------------------------------------------------

function createIdentityShape() {
  return { type: 'pgp', fingerprint: null, userid: null, publicKey: null };
}

function createIdentity({ type, userid, fingerprint = null, publicKey = null } = {}) {
  if (!type) throw new Error('[koad/identity] type is required');
  if (!userid) throw new Error('[koad/identity] userid is required');
  return { type, userid, fingerprint, publicKey };
}

module.exports = { createKoadIdentity, createIdentityShape, createIdentity };
