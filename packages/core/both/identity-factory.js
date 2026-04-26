// both/identity-factory.js — koad.identity factory for Meteor addFiles context
//
// Implements VESTA-SPEC-149 v1.0.
//
// This file is loaded via api.addFiles() — NOT ESM. No import/export syntax.
// No require() of external modules. All logic is self-contained pure JS.
//
// The factory mirrors the full createKoadIdentity() API from:
//   modules/node/identity.cjs
//
// Ceremony methods (create, importMnemonic) require Node-only kbpgp internals
// and are unavailable in the browser. On the client they throw a clear message.
// Sign/verify/load/lockdown delegate to globalThis.koad.deps.pgp (already wired
// by client/deps.js and server before this runs).
//
// Load order dependency:
//   1. both/initial.js  — koad global exists
//   2. both/identity-factory.js  (this file)  — createKoadIdentity on globalThis
//   3. server/identity.js — koad.identity = createKoadIdentity() on server
//   4. client/identity.js — koad.identity = createKoadIdentity() on client
//   5. client/deps.js (ESM) — wires koad.deps.pgp (already runs last)
//
// NOTE: sign/verify work server-side immediately after koad.deps.pgp is wired
// (koad.deps.pgp is available server-side via server/deps or loaded inline).
// On the client, koad.deps.pgp is lazy-loaded by client/deps.js — it becomes
// available after the ESM module graph resolves on first use.

// ---------------------------------------------------------------------------
// Internal state factory
// ---------------------------------------------------------------------------

function _makeIdentityState() {
	return {
		posture: null,            // 'routine' | 'ceremony' | 'recovery' | null
		handle: null,             // spirit handle string
		device: null,             // { fingerprint, publicKey, keyManager, type } | null
		master: null,             // { keyManager, type } | null — ceremony only
		mnemonic: null,           // Uint8Array | null — ceremony §3 window only
		masterFingerprint: null,  // 40-hex string
		masterPublicKey: null,    // armored master pubkey (not sensitive)
		sigchainHeadCID: null,    // CID string | null
	};
}

// ---------------------------------------------------------------------------
// Sign/verify delegation helpers
// ---------------------------------------------------------------------------

function _delegateClearsignSync(payload, km) {
	// Always returns a Promise (sign is async).
	if (
		typeof globalThis !== 'undefined' &&
		globalThis.koad &&
		globalThis.koad.deps &&
		globalThis.koad.deps.pgp &&
		typeof globalThis.koad.deps.pgp.clearsign === 'function'
	) {
		return globalThis.koad.deps.pgp.clearsign(payload, km);
	}
	return Promise.reject(
		new Error(
			'[koad/identity] sign() requires koad.deps.pgp. ' +
			'On server: ensure server deps are wired. ' +
			'On client: koad.deps.pgp loads lazily — call after page init.'
		)
	);
}

function _delegateVerifySync(armored, pubkey) {
	if (
		typeof globalThis !== 'undefined' &&
		globalThis.koad &&
		globalThis.koad.deps &&
		globalThis.koad.deps.pgp &&
		typeof globalThis.koad.deps.pgp.verify === 'function'
	) {
		return globalThis.koad.deps.pgp.verify(armored, pubkey);
	}
	return Promise.reject(
		new Error(
			'[koad/identity] verify() requires koad.deps.pgp. ' +
			'On client: koad.deps.pgp loads lazily — call after page init.'
		)
	);
}

// ---------------------------------------------------------------------------
// Factory — createKoadIdentity
// ---------------------------------------------------------------------------
// Attached to globalThis so server/identity.js and client/identity.js can
// call it without require() or import.

createKoadIdentity = function createKoadIdentity() {
	var _s = _makeIdentityState();

	// ---------------------------------------------------------------------------
	// Reactivity — Tracker.Dependency (browser/Meteor only; no-op in Node)
	// ---------------------------------------------------------------------------

	var _readyDep = (typeof Tracker !== 'undefined') ? new Tracker.Dependency() : null;

	function _invalidate() {
		if (_readyDep) _readyDep.changed();
	}

	function _depend() {
		if (_readyDep) _readyDep.depend();
	}

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

	// Browser ceremony accessor — reads koad.deps.ceremony, which is wired
	// by client/deps.js (imported from client/ceremony-browser.js via mainModule).
	// deps.js runs before identity-factory.js is consumed, so this is always populated
	// by the time create() or importMnemonic() is called in a browser context.
	function _getCeremonyBrowser() {
		if (
			typeof globalThis !== 'undefined' &&
			globalThis.koad &&
			globalThis.koad.deps &&
			globalThis.koad.deps.ceremony
		) {
			return globalThis.koad.deps.ceremony;
		}
		throw new Error(
			'[koad/identity] koad.deps.ceremony is not loaded. ' +
			'Ensure client/deps.js has initialized (koad:io-core mainModule).'
		);
	}

	// ---------------------------------------------------------------------------
	// Browser ceremony helpers — called from create() and importMnemonic() browser branches.
	// These live outside the identity object so they can mutate _s directly.
	// ---------------------------------------------------------------------------

	async function _createBrowser(opts, state) {
		var ceremony = _getCeremonyBrowser();

		// Step 1: Generate entropy + mnemonic
		var entropy = await ceremony.generateEntropy();
		var mnemonic = ceremony.entropyToMnemonicString(entropy);

		// Step 2: Derive master seed from mnemonic
		var seed = ceremony.mnemonicToSeed(mnemonic);

		// Step 3: Build master KeyManager
		var masterKM = await ceremony.buildMasterKeyManager(seed, opts.userid);
		var masterInfo = await ceremony.extractKMInfo(masterKM);

		// Step 4: Build leaf (device) KeyManager
		var leafKM = await ceremony.buildLeafKeyManager(opts.userid);
		var leafInfo = await ceremony.extractKMInfo(leafKM);

		// Step 5: Adopt state
		state.handle = opts.handle;
		state.posture = 'ceremony';
		state.masterFingerprint = masterInfo.fingerprint;
		state.masterPublicKey = masterInfo.publicKey;
		state.master = { keyManager: masterKM, type: 'ed25519-pgp' };
		state.device = {
			fingerprint: leafInfo.fingerprint,
			publicKey: leafInfo.publicKey,
			keyManager: leafKM,
			type: 'ed25519-pgp',
		};
		state.mnemonic = null; // returned as string; caller is responsible for display and scrub

		_invalidate();

		return {
			mnemonic: mnemonic,
			masterFingerprint: masterInfo.fingerprint,
			leafFingerprint: leafInfo.fingerprint,
		};
	}

	async function _importMnemonicBrowser(opts, state) {
		var ceremony = _getCeremonyBrowser();

		if (!ceremony.isValidMnemonic(opts.mnemonic)) {
			throw new Error('[koad/identity] importMnemonic(): invalid BIP39 mnemonic');
		}

		// Step 1: Derive master seed from mnemonic
		var seed = ceremony.mnemonicToSeed(opts.mnemonic);

		// Step 2: Build master KeyManager
		var masterKM = await ceremony.buildMasterKeyManager(seed, opts.userid);
		var masterInfo = await ceremony.extractKMInfo(masterKM);

		// Step 3: Build new leaf KeyManager (randomly generated — device-specific)
		var leafKM = await ceremony.buildLeafKeyManager(opts.userid);
		var leafInfo = await ceremony.extractKMInfo(leafKM);

		// Step 4: Adopt state
		state.posture = 'recovery';
		state.masterFingerprint = masterInfo.fingerprint;
		state.masterPublicKey = masterInfo.publicKey;
		state.master = { keyManager: masterKM, type: 'ed25519-pgp' };
		state.device = {
			fingerprint: leafInfo.fingerprint,
			publicKey: leafInfo.publicKey,
			keyManager: leafKM,
			type: 'ed25519-pgp',
		};
		state.mnemonic = null;

		_invalidate();

		return {
			masterFingerprint: masterInfo.fingerprint,
			leafFingerprint: leafInfo.fingerprint,
		};
	}

	var identity = {

		// -----------------------------------------------------------------------
		// Lifecycle
		// -----------------------------------------------------------------------

		/**
		 * Lockdown ceremony — generate master + first device leaf.
		 * Server/Node only. Throws on client.
		 *
		 * SPEC-149 §6.
		 *
		 * @param {object} opts
		 * @param {string} opts.handle  - Spirit handle
		 * @param {string} opts.userid  - PGP userid string
		 * @returns {Promise<{mnemonic, masterFingerprint, leafFingerprint}>}
		 */
		create: async function create(opts) {
			opts = opts || {};
			if (!opts.handle) throw new Error('[koad/identity] create() requires handle');
			if (!opts.userid) throw new Error('[koad/identity] create() requires userid');

			// Browser path — use ceremony-browser.js (wired onto koad.deps.ceremony by deps.js)
			if (typeof Meteor !== 'undefined' && !Meteor.isServer) {
				return _createBrowser(opts, _s);
			}

			// Server: delegate to the full CJS substrate which has the BIP39/ceremony chain.
			// A temp instance is created; after create() we adopt its state via setFromKeyManager.
			// The mnemonic, masterFingerprint, and leafFingerprint are returned for display/storage
			// by the caller. The caller then persists the leaf key and calls load() on next boot.
			var mod;
			try {
				mod = require('/home/koad/.koad-io/modules/node/identity.cjs');
			} catch (e) {
				throw new Error('[koad/identity] create() failed to load ceremony module: ' + e.message);
			}

			// Create on the CJS instance (it has the full state + ceremony internals)
			var cjsIdentity = mod.createKoadIdentity();
			var result = await cjsIdentity.create(opts);

			// Adopt state: copy non-private fields that are accessible via getters.
			// The leaf keyManager is accessible via _keyManager getter.
			_s.handle = opts.handle;
			_s.posture = 'ceremony';
			_s.masterFingerprint = result.masterFingerprint;
			_s.masterPublicKey = cjsIdentity.masterPublicKey;
			_s.mnemonic = null; // mnemonic returned as string to caller for display; don't hold Uint8Array here

			// Adopt the leaf device key from the CJS instance via setFromKeyManager shim
			var leafKM = cjsIdentity._keyManager;
			if (leafKM) {
				_s.device = {
					fingerprint: result.leafFingerprint,
					publicKey: cjsIdentity.publicKey,
					keyManager: leafKM,
					type: 'ed25519-pgp',
				};
			}

			// NOTE: master keyManager is NOT adopted here — it stays in the cjsIdentity closure.
			// This means useMaster signing is not available on this instance after create().
			// For the full ceremony flow (master signing of genesis entries), use the CJS module
			// directly (Flight D). This instance is ready for leaf signing via sign().

			_invalidate();
			return result;
		},

		/**
		 * Routine boot — load a persisted device leaf into memory.
		 *
		 * SPEC-149 §8 bootstrap steps 1–5.
		 * Called by identity-init.js after shim path populates the key manager.
		 *
		 * @param {object} opts
		 * @param {string} opts.handle
		 * @param {string} opts.masterFingerprint
		 * @param {string} [opts.masterPublicKey]
		 * @param {object} opts.keyManager        - kbpgp KeyManager with private key
		 * @param {string} opts.leafFingerprint
		 * @param {string} [opts.leafPublicKey]
		 * @param {string} [opts.sigchainHeadCID]
		 */
		load: function load(opts) {
			opts = opts || {};
			if (!opts.handle) throw new Error('[koad/identity] load() requires handle');
			if (!opts.masterFingerprint) throw new Error('[koad/identity] load() requires masterFingerprint');
			if (!opts.keyManager) throw new Error('[koad/identity] load() requires keyManager');
			if (!opts.leafFingerprint) throw new Error('[koad/identity] load() requires leafFingerprint');

			_s.handle = opts.handle;
			_s.masterFingerprint = opts.masterFingerprint;
			_s.masterPublicKey = opts.masterPublicKey || null;
			_s.device = {
				fingerprint: opts.leafFingerprint,
				publicKey: opts.leafPublicKey || null,
				keyManager: opts.keyManager,
				type: 'ed25519-pgp',
			};
			_s.master = null;
			_s.mnemonic = null;
			_s.sigchainHeadCID = opts.sigchainHeadCID || null;
			_s.posture = 'routine';
			_invalidate();
		},

		/**
		 * Scrub master key + mnemonic from memory.
		 * SPEC-149 §6 step 6.
		 */
		lockdown: function lockdown() {
			if (_s.mnemonic instanceof Uint8Array) {
				_s.mnemonic.fill(0x00);
			}
			_s.mnemonic = null;
			_s.master = null;
			if (_s.posture === 'ceremony' || _s.posture === 'recovery') {
				_s.posture = 'routine';
			}
			_invalidate();
		},

		/**
		 * Recovery — reconstitute master from BIP39 mnemonic.
		 * Server/Node only. Throws on client.
		 *
		 * SPEC-149 §7.3.
		 *
		 * @param {object} opts
		 * @param {string} opts.mnemonic - 24-word BIP39 mnemonic
		 * @param {string} opts.userid   - PGP userid string
		 */
		importMnemonic: async function importMnemonic(opts) {
			opts = opts || {};
			if (!opts.mnemonic) throw new Error('[koad/identity] importMnemonic() requires mnemonic');
			if (!opts.userid) throw new Error('[koad/identity] importMnemonic() requires userid');

			// Browser path — use ceremony-browser.js (wired onto koad.deps.ceremony by deps.js)
			if (typeof Meteor !== 'undefined' && !Meteor.isServer) {
				return _importMnemonicBrowser(opts, _s);
			}

			var mod;
			try {
				mod = require('/home/koad/.koad-io/modules/node/identity.cjs');
			} catch (e) {
				throw new Error('[koad/identity] importMnemonic() failed to load ceremony module: ' + e.message);
			}

			var cjsIdentity = mod.createKoadIdentity();
			var result = await cjsIdentity.importMnemonic(opts);

			// Adopt leaf state from the CJS instance (same pattern as create())
			_s.handle = _s.handle || null;
			_s.posture = 'recovery';
			_s.masterFingerprint = result.masterFingerprint;
			_s.masterPublicKey = cjsIdentity.masterPublicKey;
			_s.mnemonic = null; // not held here; caller drives lockdown

			var leafKM = cjsIdentity._keyManager;
			if (leafKM) {
				_s.device = {
					fingerprint: result.leafFingerprint,
					publicKey: cjsIdentity.publicKey,
					keyManager: leafKM,
					type: 'ed25519-pgp',
				};
			}

			// NOTE: master keyManager stays in cjsIdentity closure (same as create()).
			// Flight D will provide a fuller ceremony harness if master signing is needed.

			_invalidate();
			return result;
		},

		// -----------------------------------------------------------------------
		// Signing
		// -----------------------------------------------------------------------

		/**
		 * Sign a payload string using the device leaf key.
		 * During ceremony posture, opts.useMaster === true uses master key.
		 *
		 * Delegates to koad.deps.pgp.clearsign.
		 *
		 * SPEC-149 §7, SPEC-148.
		 *
		 * @param {string} payload
		 * @param {object} [opts]
		 * @param {boolean} [opts.useMaster]
		 * @returns {Promise<string>} RFC 4880 clearsign armored string
		 */
		sign: async function sign(payload, opts) {
			opts = opts || {};
			if (typeof payload !== 'string') {
				throw new Error('[koad/identity] sign() requires a string payload');
			}
			if (opts.useMaster) {
				_assertMasterLoaded();
				return _delegateClearsignSync(payload, _s.master.keyManager);
			}
			_assertLoaded();
			return _delegateClearsignSync(payload, _s.device.keyManager);
		},

		/**
		 * Verify an RFC 4880 clearsigned message against a public key.
		 *
		 * Delegates to koad.deps.pgp.verify.
		 *
		 * SPEC-149 §7, SPEC-148.
		 *
		 * @param {string} armored - RFC 4880 clearsign armored string
		 * @param {string} pubkey  - Armored PGP public key
		 * @returns {Promise<{verified: boolean, payload?: string, error?: string}>}
		 */
		verify: async function verify(armored, pubkey) {
			if (typeof armored !== 'string') throw new Error('[koad/identity] verify() requires armored string');
			if (typeof pubkey !== 'string') throw new Error('[koad/identity] verify() requires pubkey string');
			return _delegateVerifySync(armored, pubkey);
		},

		// -----------------------------------------------------------------------
		// State — read-only getters (SPEC-149 §7)
		// -----------------------------------------------------------------------

		/**
		 * ready() — reactive read. Returns true when a device leaf is loaded.
		 * Registers a Tracker dependency so Blaze helpers/autoruns recompute when
		 * load(), lockdown(), create(), importMnemonic(), or setFromKeyManager() fire.
		 * In Node (no Tracker), behaves identically to isLoaded.
		 */
		ready: function ready() {
			_depend();
			return _s.posture !== null && _s.device !== null;
		},

		get isLoaded() {
			_depend();
			return !!(
				_s.device &&
				_s.device.keyManager &&
				(_s.posture === 'routine' || _s.posture === 'ceremony' || _s.posture === 'recovery')
			);
		},

		get isMasterLoaded() {
			_depend();
			return !!(_s.master && _s.master.keyManager);
		},

		get handle() { _depend(); return _s.handle; },

		get fingerprint() { _depend(); return _s.device ? _s.device.fingerprint : null; },

		get masterFingerprint() { _depend(); return _s.masterFingerprint; },

		get sigchainHeadCID() { _depend(); return _s.sigchainHeadCID; },

		get publicKey() { _depend(); return _s.device ? _s.device.publicKey : null; },

		get masterPublicKey() { _depend(); return _s.masterPublicKey; },

		get type() { return 'pgp'; },

		get posture() { _depend(); return _s.posture; },

		// Internal: expose device keyManager for bootstrap modules
		get _keyManager() { return _s.device ? _s.device.keyManager : null; },

		// -----------------------------------------------------------------------
		// Backwards-compat shim — called by identity-init.js
		// -----------------------------------------------------------------------

		/**
		 * setFromKeyManager — backwards-compat shim for identity-init.js.
		 *
		 * The old identity-init.js calls koad.identity.setFromKeyManager(km, cb).
		 * This shim populates device state from a kbpgp KeyManager directly.
		 * It does NOT set masterFingerprint or masterPublicKey — those require
		 * the full load() call with that data.
		 *
		 * @param {object} keyManager  - kbpgp KeyManager with private key loaded
		 * @param {function} [cb]      - Optional Node callback(err, ok)
		 */
		setFromKeyManager: function setFromKeyManager(keyManager, cb) {
			try {
				if (!keyManager) throw new Error('[koad/identity] setFromKeyManager() requires a keyManager');

				var fp = null;
				if (keyManager.get_pgp_fingerprint) {
					var fpBuf = keyManager.get_pgp_fingerprint();
					fp = fpBuf ? fpBuf.toString('hex').toUpperCase() : null;
				}

				keyManager.export_pgp_public({}, function(err, pgpPublic) {
					if (err) {
						if (cb) return cb(err);
						throw err;
					}
					_s.device = {
						fingerprint: fp,
						publicKey: pgpPublic,
						keyManager: keyManager,
						type: 'ed25519-pgp',
					};
					_s.posture = 'routine';
					_invalidate();
					if (cb) cb(null, true);
				});
			} catch (err) {
				if (cb) cb(err);
				else throw err;
			}
		},
	};

	return identity;
};
