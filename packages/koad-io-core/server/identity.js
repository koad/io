/**
 * Server-Side Identity & Cryptography using Keybase PGP (kbpgp)
 * 
 * This module provides cryptographic identity management using kbpgp keys.
 * Keys are stored in ~/.$ENTITY/id/kbpgp_key (private) and ~/.$ENTITY/id/kbpgp_key.pub (public).
 * 
 * Server Behavior:
 * - On first run, if no key exists, generates a new kbpgp key pair
 * - Keys are stored persistently in the entity's id directory
 * - Loaded automatically on server startup (see identity-init.js)
 * 
 * Key Structure:
 * {
 *   type: 'kbpgp',
 *   publicKey: String (armored public key),
 *   fingerprint: String (key fingerprint),
 *   userid: String (entity name)
 * }
 */

const kbpgp = require('kbpgp');

// Module-level variables
let keyManager = null; // kbpgp KeyManager instance
let privateKey = null; // Armored private key
let publicKey = null;  // Armored public key

koad.identity = {
	type: 'kbpgp',
	fingerprint: null,
	userid: null,
	publicKey: null,

	/**
	 * Sign Data
	 * 
	 * Creates a detached signature for the given payload using kbpgp.
	 * 
	 * @param {Any} payload - Data to sign (will be JSON stringified if object)
	 * @param {Function} callback - Callback(err, signature)
	 */
	sign: function(payload, callback) {
		if (!keyManager) {
			const error = new Error('[koad.identity.sign] No key loaded - cannot sign');
			console.error(error.message);
			if (callback) return callback(error);
			throw error;
		}

		// Convert payload to string if needed
		const message = typeof payload === 'string' ? payload : JSON.stringify(payload);
		
		// Sign the message
		kbpgp.box({ 
			msg: message, 
			sign_with: keyManager,
			detached: true // Create detached signature
		}, function(err, result_string) {
			if (err) {
				console.error('[koad.identity.sign] Error signing:', err);
				if (callback) return callback(err);
				throw err;
			}
			
			if (callback) {
				callback(null, result_string);
			}
		});
		
		// If no callback provided, we can't return the async result
		if (!callback) {
			console.warn('[koad.identity.sign] No callback provided - signature will be processed asynchronously');
		}
	},

	/**
	 * Verify Signature
	 * 
	 * Verifies a detached signature against the original payload.
	 * 
	 * @param {Any} payload - Original data
	 * @param {String} signature - Signature to verify
	 * @param {String} publicKeyArmored - Signer's public key (armored)
	 * @param {Function} callback - Callback(err, valid)
	 */
	verify: function(payload, signature, publicKeyArmored, callback) {
		// Convert payload to string if needed
		const message = typeof payload === 'string' ? payload : JSON.stringify(payload);
		
		// Import the public key
		kbpgp.KeyManager.import_from_armored_pgp({
			armored: publicKeyArmored
		}, function(err, signer) {
			if (err) {
				console.error('[koad.identity.verify] Error importing public key:', err);
				return callback(err, false);
			}
			
			// Verify the signature
			kbpgp.unbox({ 
				keyfetch: signer, 
				armored: signature,
				data: Buffer.from(message)
			}, function(err, literals) {
				if (err) {
					console.error('[koad.identity.verify] Signature verification failed:', err);
					return callback(null, false);
				}
				
				callback(null, true);
			});
		});
	},

	/**
	 * Encrypt Data
	 * 
	 * Encrypts data for a specific recipient using their public key.
	 * 
	 * @param {Any} data - Data to encrypt (will be JSON stringified if object)
	 * @param {String} recipientPublicKey - Recipient's public key (armored)
	 * @param {Function} callback - Callback(err, encryptedData)
	 */
	encrypt: function(data, recipientPublicKey, callback) {
		// Convert data to string if needed
		const message = typeof data === 'string' ? data : JSON.stringify(data);
		
		// Import recipient's public key
		kbpgp.KeyManager.import_from_armored_pgp({
			armored: recipientPublicKey
		}, function(err, recipient) {
			if (err) {
				console.error('[koad.identity.encrypt] Error importing recipient key:', err);
				return callback(err);
			}
			
			// Encrypt the message
			kbpgp.box({ 
				msg: message, 
				encrypt_for: recipient,
				sign_with: keyManager // Sign as well
			}, function(err, result_string) {
				if (err) {
					console.error('[koad.identity.encrypt] Error encrypting:', err);
					return callback(err);
				}
				
				callback(null, result_string);
			});
		});
	},

	/**
	 * Decrypt Data
	 * 
	 * Decrypts data that was encrypted for this identity.
	 * 
	 * @param {String} encryptedData - Encrypted data (armored)
	 * @param {Function} callback - Callback(err, decryptedData)
	 */
	decrypt: function(encryptedData, callback) {
		if (!keyManager) {
			const error = new Error('[koad.identity.decrypt] No key loaded - cannot decrypt');
			console.error(error.message);
			if (callback) return callback(error);
			throw error;
		}

		// Decrypt the message
		kbpgp.unbox({ 
			keyfetch: keyManager, 
			armored: encryptedData
		}, function(err, literals) {
			if (err) {
				console.error('[koad.identity.decrypt] Error decrypting:', err);
				return callback(err);
			}
			
			const decrypted = literals[0].toString();
			
			// Try to parse as JSON
			try {
				const parsed = JSON.parse(decrypted);
				callback(null, parsed);
			} catch (e) {
				// Not JSON, return as string
				callback(null, decrypted);
			}
		});
	},

	/**
	 * Set Identity from Key Manager
	 * 
	 * Internal function to set the identity from a loaded kbpgp KeyManager.
	 * Called by identity-init.js during server startup.
	 * 
	 * @param {KeyManager} km - kbpgp KeyManager instance
	 * @param {Function} callback - Callback(err, success)
	 */
	setFromKeyManager: function(km, callback) {
		if (!km) {
			const error = new Error('[koad.identity.setFromKeyManager] Invalid KeyManager');
			console.error(error.message);
			if (callback) return callback(error, false);
			return false;
		}

		keyManager = km;
		
		// Extract fingerprint
		const fingerprint = km.get_pgp_fingerprint();
		if (fingerprint) {
			koad.identity.fingerprint = fingerprint.toString('hex');
		}
		
		// Extract userid
		const userids = km.get_userids();
		if (userids && userids.length > 0) {
			koad.identity.userid = userids[0];
		}
		
		// Export public key
		km.export_pgp_public({}, function(err, pgp_public) {
			if (err) {
				console.error('[koad.identity.setFromKeyManager] Error exporting public key:', err);
				if (callback) return callback(err, false);
				return;
			}
			
			publicKey = pgp_public;
			koad.identity.publicKey = pgp_public;
			
			// Export private key
			km.export_pgp_private({}, function(err, pgp_private) {
				if (err) {
					console.error('[koad.identity.setFromKeyManager] Error exporting private key:', err);
					if (callback) return callback(err, false);
					return;
				}
				
				privateKey = pgp_private;
				
				console.log('[koad.identity.setFromKeyManager] Identity configured:');
				console.log('  Type:', koad.identity.type);
				console.log('  Fingerprint:', koad.identity.fingerprint);
				console.log('  UserID:', koad.identity.userid);
				
				if (callback) callback(null, true);
			});
		});
	},

	/**
	 * Get Public Key
	 * 
	 * Returns the armored public key for this identity.
	 * Safe to share publicly.
	 * 
	 * @returns {String} Public key (armored)
	 */
	getPublicKey: function() {
		return publicKey;
	},

	/**
	 * Get Fingerprint
	 * 
	 * Returns the key fingerprint.
	 * 
	 * @returns {String} Fingerprint (hex)
	 */
	getFingerprint: function() {
		return koad.identity.fingerprint;
	},

	/**
	 * Internal: Get KeyManager
	 * For testing and advanced use only
	 */
	_keyManager: function() { 
		return keyManager; 
	},

	/**
	 * Internal: Set KeyManager
	 * For testing and advanced use only
	 */
	_setKeyManager: function(km) { 
		keyManager = km; 
	}
};

log.success('loaded koad-io-core/server/identity');
