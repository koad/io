/**
 * Server-Side Identity Initialization
 * 
 * Handles automatic kbpgp key generation and loading on server startup.
 * 
 * Workflow:
 * 1. Check if ~/.$ENTITY/id/kbpgp_key exists
 * 2. If not, generate a new kbpgp key pair
 * 3. Save the keys to ~/.$ENTITY/id/kbpgp_key and ~/.$ENTITY/id/kbpgp_key.pub
 * 4. Load the key into koad.identity
 * 5. Set koad.entity to the entity handle string (SPEC-149 §3)
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
 * Initialize koad.identity on server startup
 * 
 * This runs automatically when the server starts.
 */
Meteor.startup(function() {
	const entityName = process.env.ENTITY;

	if (!entityName) {
		log.warning('[identity] ENTITY environment variable not set - skipping identity initialization');
		return;
	}

	const keyDir = path.join(process.env.HOME, `.${entityName}`, 'id');
	const privateKeyPath = path.join(keyDir, 'kbpgp_key');

	log.info('[identity] Initializing kbpgp identity for entity:', entityName);

	// Check if key exists
	if (fs.existsSync(privateKeyPath)) {
		// Load existing key
		log.info('[identity] Found existing key, loading...');
		
		loadKbpgpKey(keyDir, function(err, keyManager) {
			if (err) {
				log.error('[identity] Failed to load key:', err.message);
				return;
			}

			// Set identity
			koad.identity.setFromKeyManager(keyManager, function(err, success) {
				if (err) {
					log.error('[identity] Failed to set identity:', err.message);
					return;
				}

				// Set koad.entity to the entity handle (SPEC-149 §3 — not the fingerprint)
				koad.entity = entityName;
				log.success('[identity] Entity handle:', koad.entity);
			});
		});
	} else {
		// Generate new key
		log.warning('[identity] No existing key found, generating new key...');
		
		const userid = `${entityName} <${entityName}@koad.io>`;
		
		generateKbpgpKey(userid, function(err, keyManager) {
			if (err) {
				log.error('[identity] Failed to generate key:', err.message);
				return;
			}

			// Save the key
			saveKbpgpKey(keyManager, keyDir, function(err) {
				if (err) {
					log.error('[identity] Failed to save key:', err.message);
					return;
				}

				// Set identity
				koad.identity.setFromKeyManager(keyManager, function(err, success) {
					if (err) {
						log.error('[identity] Failed to set identity:', err.message);
						return;
					}

					// Set koad.entity to the entity handle (SPEC-149 §3 — not the fingerprint)
					koad.entity = entityName;
					log.success('[identity] New entity created, handle:', koad.entity);
				});
			});
		});
	}
});

log.success('loaded koad-io-core/identity-init');
