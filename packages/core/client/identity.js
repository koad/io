/**
 * Client-Side Identity & Cryptography
 * 
 * Client-side identity placeholder. Clients receive their identity when they log in.
 * 
 * Client Behavior:
 * - Does not require a key initially
 * - Will receive identity information from the server when user logs in
 * - Can store the server's public key for encryption
 * 
 * Key Structure:
 * {
 *   type: 'kbpgp',
 *   publicKey: String (armored public key - can be set from server),
 *   fingerprint: String (key fingerprint),
 *   userid: String (entity name)
 * }
 */

koad.identity = {
	type: 'kbpgp',
	fingerprint: null,
	userid: null,
	publicKey: null,

	/**
	 * Sign Data (Client)
	 * 
	 * Signing is not available on the client side.
	 * Use Meteor.call to send data to server for signing.
	 */
	sign: function(payload, callback) {
		const error = new Error('[koad.identity.sign] Signing not available on client - use Meteor.call to sign on server');
		console.error(error.message);
		if (callback) return callback(error);
		throw error;
	},

	/**
	 * Verify Signature (Client)
	 * 
	 * Verification is not available on the client side.
	 * Use Meteor.call to send data to server for verification.
	 */
	verify: function(payload, signature, publicKeyArmored, callback) {
		const error = new Error('[koad.identity.verify] Verification not available on client - use Meteor.call to verify on server');
		console.error(error.message);
		if (callback) return callback(error, false);
		throw error;
	},

	/**
	 * Encrypt Data (Client)
	 * 
	 * Encryption is not available on the client side.
	 * Use Meteor.call to send data to server for encryption.
	 */
	encrypt: function(data, recipientPublicKey, callback) {
		const error = new Error('[koad.identity.encrypt] Encryption not available on client - use Meteor.call to encrypt on server');
		console.error(error.message);
		if (callback) return callback(error);
		throw error;
	},

	/**
	 * Decrypt Data (Client)
	 * 
	 * Decryption is not available on the client side.
	 * Use Meteor.call to send data to server for decryption.
	 */
	decrypt: function(encryptedData, callback) {
		const error = new Error('[koad.identity.decrypt] Decryption not available on client - use Meteor.call to decrypt on server');
		console.error(error.message);
		if (callback) return callback(error);
		throw error;
	},

	/**
	 * Set Server Public Key
	 * 
	 * Stores the server's public key for later use.
	 * This can be called when the client receives the server's identity.
	 * 
	 * @param {Object} identityInfo - Object with fingerprint, userid, publicKey
	 */
	setServerIdentity: function(identityInfo) {
		if (!identityInfo) {
			console.error('[koad.identity.setServerIdentity] Invalid identity info');
			return false;
		}

		koad.identity.fingerprint = identityInfo.fingerprint || null;
		koad.identity.userid = identityInfo.userid || null;
		koad.identity.publicKey = identityInfo.publicKey || null;

		console.log('[koad.identity.setServerIdentity] Server identity set:');
		console.log('  Type:', koad.identity.type);
		console.log('  Fingerprint:', koad.identity.fingerprint);
		console.log('  UserID:', koad.identity.userid);

		return true;
	},

	/**
	 * Get Public Key
	 * 
	 * Returns the server's public key if available.
	 * 
	 * @returns {String|null} Public key (armored) or null
	 */
	getPublicKey: function() {
		return koad.identity.publicKey;
	},

	/**
	 * Get Fingerprint
	 * 
	 * Returns the server's key fingerprint if available.
	 * 
	 * @returns {String|null} Fingerprint (hex) or null
	 */
	getFingerprint: function() {
		return koad.identity.fingerprint;
	}
};

console.log('[koad.identity] Client identity module loaded');
