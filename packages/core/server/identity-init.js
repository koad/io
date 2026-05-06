/**
 * Server-Side Identity Initialization
 *
 * Post-rekey (2026-05-06) workflow:
 * 1. Check if ~/.$ENTITY/id/entity.public.asc exists (new key layout)
 *    → If yes: load the public KeyManager (verify-only), set koad.identity,
 *      set koad.entity. Private key material stays off-disk (Keybase holds it).
 * 2. Else, fall back to legacy ~/.$ENTITY/id/kbpgp_key (private armored).
 *    → Load and set koad.identity (signing-capable).
 * 3. If neither exists: log a warning and skip. Key generation has been
 *    RETIRED from this script — use the gestation flow + Vesta rekey ceremony
 *    instead. Generating fresh keys here would silently fork an entity's
 *    identity from its sigchain entries.
 *
 * SPEC-149 §3: koad.entity is the entity handle string, not the fingerprint.
 */

const fs = require('fs');
const path = require('path');
const kbpgp = require('kbpgp');

/**
 * Generate a new kbpgp key pair
 * 
 * @param {String} userid - User ID for the key (entity name + email)
 * @param {Function} callback - Callback(err, keyManager)
 */
function generateKbpgpKey(userid, callback) {
	const F = kbpgp.const.openpgp;
	
	log.info('[identity] Generating new kbpgp key pair for', userid);
	
	const opts = {
		userid: userid,
		primary: {
			nbits: 4096,
			flags: F.certify_keys | F.sign_data | F.auth | F.encrypt_comm | F.encrypt_storage,
			expire_in: 0  // never expire
		},
		subkeys: [
			{
				nbits: 4096,
				flags: F.sign_data | F.auth,
				expire_in: 0
			},
			{
				nbits: 4096,
				flags: F.encrypt_comm | F.encrypt_storage,
				expire_in: 0
			}
		]
	};

	kbpgp.KeyManager.generate(opts, function(err, keyManager) {
		if (err) {
			log.error('[identity] Error generating key:', err);
			return callback(err);
		}

		// Sign the key
		keyManager.sign({}, function(err) {
			if (err) {
				log.error('[identity] Error signing key:', err);
				return callback(err);
			}

			log.success('[identity] Key generated successfully');
			callback(null, keyManager);
		});
	});
}

/**
 * Save kbpgp key to files
 * 
 * @param {KeyManager} keyManager - kbpgp KeyManager instance
 * @param {String} keyDir - Directory to save keys
 * @param {Function} callback - Callback(err)
 */
function saveKbpgpKey(keyManager, keyDir, callback) {
	// Ensure directory exists
	if (!fs.existsSync(keyDir)) {
		fs.mkdirSync(keyDir, { recursive: true, mode: 0o700 });
	}

	const privateKeyPath = path.join(keyDir, 'kbpgp_key');
	const publicKeyPath = path.join(keyDir, 'kbpgp_key.pub');

	// Export private key
	keyManager.export_pgp_private({}, function(err, pgp_private) {
		if (err) {
			log.error('[identity] Error exporting private key:', err);
			return callback(err);
		}

		// Export public key
		keyManager.export_pgp_public({}, function(err, pgp_public) {
			if (err) {
				log.error('[identity] Error exporting public key:', err);
				return callback(err);
			}

			// Write private key (secure permissions)
			fs.writeFileSync(privateKeyPath, pgp_private, { mode: 0o600 });
			log.success('[identity] Private key saved to', privateKeyPath);

			// Write public key
			fs.writeFileSync(publicKeyPath, pgp_public, { mode: 0o644 });
			log.success('[identity] Public key saved to', publicKeyPath);

			callback(null);
		});
	});
}

/**
 * Load kbpgp key from files
 * 
 * @param {String} keyDir - Directory containing keys
 * @param {Function} callback - Callback(err, keyManager)
 */
function loadKbpgpKey(keyDir, callback) {
	const privateKeyPath = path.join(keyDir, 'kbpgp_key');

	if (!fs.existsSync(privateKeyPath)) {
		return callback(new Error('Private key not found at ' + privateKeyPath));
	}

	const armoredKey = fs.readFileSync(privateKeyPath, 'utf8');

	kbpgp.KeyManager.import_from_armored_pgp({
		armored: armoredKey
	}, function(err, keyManager) {
		if (err) {
			log.error('[identity] Error importing key:', err);
			return callback(err);
		}

		// Check if key is locked (has passphrase)
		if (keyManager.is_pgp_locked()) {
			log.warning('[identity] Key is locked with passphrase - skipping for now');
			// TODO: Implement passphrase handling
			// For now, we only support unencrypted keys
			return callback(new Error('Key is locked with passphrase'));
		}

		log.success('[identity] Key loaded successfully');
		callback(null, keyManager);
	});
}

/**
 * Load a kbpgp KeyManager from a PGP public key (new layout, verify-only).
 *
 * @param {String} pubKeyPath — path to entity.public.asc
 * @param {Function} callback — Callback(err, keyManager)
 */
function loadKbpgpPublicKey(pubKeyPath, callback) {
	const armoredKey = fs.readFileSync(pubKeyPath, 'utf8');
	kbpgp.KeyManager.import_from_armored_pgp({
		armored: armoredKey
	}, function(err, keyManager) {
		if (err) {
			log.error('[identity] Error importing public key:', err);
			return callback(err);
		}
		callback(null, keyManager);
	});
}

/**
 * Initialize koad.identity on server startup.
 *
 * Resolution order (post-rekey):
 *   1. ~/.$ENTITY/id/entity.public.asc   — new layout, verify-only
 *   2. ~/.$ENTITY/id/kbpgp_key           — legacy, signing-capable
 *   3. neither                           — log warning, skip (do NOT generate)
 */
Meteor.startup(function() {
	const entityName = process.env.ENTITY;

	if (!entityName) {
		log.warning('[identity] ENTITY environment variable not set - skipping identity initialization');
		return;
	}

	const keyDir = path.join(process.env.HOME, `.${entityName}`, 'id');
	const newPubKeyPath = path.join(keyDir, 'entity.public.asc');
	const legacyPrivateKeyPath = path.join(keyDir, 'kbpgp_key');

	log.info('[identity] Initializing kbpgp identity for entity:', entityName);

	if (fs.existsSync(newPubKeyPath)) {
		// New layout — public-only, verify-capable, signing requires Keybase
		log.info('[identity] Found entity.public.asc (new layout), loading public key...');
		loadKbpgpPublicKey(newPubKeyPath, function(err, keyManager) {
			if (err) {
				log.error('[identity] Failed to load public key:', err.message);
				return;
			}
			koad.identity.setFromKeyManager(keyManager, function(err, success) {
				if (err) {
					log.error('[identity] Failed to set identity:', err.message);
					return;
				}
				koad.entity = entityName;
				log.success('[identity] Entity handle (verify-only):', koad.entity);
			});
		});
		return;
	}

	if (fs.existsSync(legacyPrivateKeyPath)) {
		// Legacy layout — private armored on disk, signing-capable
		log.warning('[identity] Falling back to legacy kbpgp_key. Run rekey ceremony to migrate to entity.public.asc.');
		loadKbpgpKey(keyDir, function(err, keyManager) {
			if (err) {
				log.error('[identity] Failed to load legacy key:', err.message);
				return;
			}
			koad.identity.setFromKeyManager(keyManager, function(err, success) {
				if (err) {
					log.error('[identity] Failed to set identity:', err.message);
					return;
				}
				koad.entity = entityName;
				log.success('[identity] Entity handle (legacy):', koad.entity);
			});
		});
		return;
	}

	// No key material — DO NOT generate. That would fork the entity's identity
	// from its sigchain entries. Direct the operator to gestation/rekey.
	log.warning('[identity] No key found at either ' + newPubKeyPath + ' or ' + legacyPrivateKeyPath + '.');
	log.warning('[identity] Key generation is disabled here — use the gestation flow or Vesta rekey ceremony.');
});

log.success('loaded koad-io-core/identity-init');
