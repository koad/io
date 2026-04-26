// server/identity.js — Wire the koad.identity substrate on the server.
//
// Implements VESTA-SPEC-149 v1.0.
//
// The createKoadIdentity factory was loaded by both/identity-factory.js
// (via api.addFiles in package.js, after both/initial.js).
//
// On the server we additionally wire koad.deps.pgp so that sign/verify can
// delegate to it immediately (without lazy-loading the browser bundle).
//
// The old server/identity.js had:
//   - Module-level `let keyManager` closure
//   - koad.identity.sign() using kbpgp.box() — callback-based, detached sig
//   - koad.identity.verify() — callback-based
//   - koad.identity.encrypt() / decrypt() — REMOVED (not in SPEC-149)
//   - koad.identity.setFromKeyManager() — kept as backwards-compat shim
//   - koad.identity._keyManager() / _setKeyManager() — internal, kept as getter
//
// The new substrate's sign() uses koad.deps.pgp.clearsign() per SPEC-148.
// This is a deliberate upgrade from kbpgp.box (detached) to clearsign format.
//
// Callers of old sign() / verify() / encrypt() / decrypt() outside this package:
//   None found (grepped ~/.koad-io/ — only identity.js, identity-init.js,
//   and client/identity.js were callers). Flight E will migrate any consumers.

// Wire up server-side PGP delegation before creating the identity object.
// koad.deps is populated by client/deps.js on the client; on the server
// we wire it inline here using the same kbpgp package that's already
// in Npm.depends(). This mirrors what client/pgp.js does for the browser.

(function() {
	var kbpgp = require('kbpgp');

	// Ensure koad.deps exists
	if (!koad.deps) koad.deps = {};

	// Wire koad.deps.pgp server-side using inline clearsign/verify helpers.
	// These mirror the functions in client/pgp.js but use the Node kbpgp package.
	if (!koad.deps.pgp) {
		koad.deps.pgp = {

			/**
			 * PGP clearsign a plaintext string with the given kbpgp KeyManager.
			 *
			 * @param {string} plaintext - Text to sign
			 * @param {object} km        - kbpgp KeyManager with private key
			 * @returns {Promise<string>} RFC 4880 clearsign armored block
			 */
			clearsign: function(plaintext, km) {
				return new Promise(function(resolve, reject) {
					kbpgp.clearsign({ msg: plaintext, sign_with: km }, function(err, armored) {
						if (err) return reject(err);
						resolve(armored);
					});
				});
			},

			/**
			 * Verify a PGP clearsigned message.
			 *
			 * @param {string} armored - RFC 4880 clearsign armored block
			 * @param {string} pubkey  - Armored PGP public key of expected signer
			 * @returns {Promise<{verified: boolean, payload?: string, error?: string}>}
			 */
			verify: function(armored, pubkey) {
				return new Promise(function(resolve) {
					kbpgp.KeyManager.import_from_armored_pgp({ armored: pubkey }, function(err, km) {
						if (err) return resolve({ verified: false, error: 'key import failed: ' + err.message });

						var ring = new kbpgp.keyring.KeyRing();
						ring.add_key_manager(km);

						kbpgp.unbox({ armored: armored, keyfetch: ring }, function(err, literals) {
							if (err) return resolve({ verified: false, error: err.message });
							var payload = literals && literals[0] ? literals[0].toString() : '';
							resolve({ verified: true, payload: payload });
						});
					});
				});
			},
		};
	}

	// Create the identity substrate and attach it to the koad global.
	// createKoadIdentity is defined by both/identity-factory.js (loaded before this).
	koad.identity = createKoadIdentity();

	log.success('loaded koad-io-core/server/identity');
})();
