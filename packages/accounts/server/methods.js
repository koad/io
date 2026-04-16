/**
 * Account Core Server Methods
 * 
 * Provides server-side methods for authentication and session management:
 * - Token consumption (one-time use tokens)
 * - Token generation and revocation
 * - Session authorization (cross-device authentication)
 * - Token memo updates
 */

// ============================================================================
// Methods
// ============================================================================

Meteor.methods({
	/**
	 * Gather Consumable Token
	 * 
	 * Retrieves and consumes a one-time use login token.
	 * Called by pending sessions after being authorized by a logged-in user.
	 * 
	 * Security:
	 * - Single-use: token is removed after retrieval
	 * - Time-limited: expires after TTL (typically 3 minutes)
	 * - Session-bound: consumable ID is the session ID
	 * 
	 * @param {String} consumableId - Consumable token ID (typically session ID)
	 * @returns {String} Login token payload
	 * @throws {Meteor.Error} 'invalid-consumable' if not found
	 * @throws {Meteor.Error} 'expired-consumable' if TTL exceeded
	 */
	'gather.consumable': async function(consumableId) {
		check(consumableId, String);

		if (DEBUG) {
			console.log(`[gather.consumable] Attempting to consume token ${consumableId}`);
		}

		// Find the consumable
		const consumable = await ApplicationConsumables.findOneAsync({ _id: consumableId });
		if (!consumable) {
			if (DEBUG) {
				console.log(`[gather.consumable] Token ${consumableId} not found`);
			}
			throw new Meteor.Error('invalid-consumable', 'Consumable not found or already used');
		}

		// Check if expired
		if (consumable.ttl && consumable.when) {
			const expiresAt = new Date(consumable.when.getTime() + consumable.ttl);
			const now = new Date();
			
			if (expiresAt < now) {
				const ageSeconds = Math.floor((now - consumable.when) / 1000);
				console.warn(`[gather.consumable] Token ${consumableId} expired (age: ${ageSeconds}s, TTL: ${consumable.ttl / 1000}s)`);
				
				// Clean up expired consumable
				await ApplicationConsumables.removeAsync({ _id: consumableId });
				
				throw new Meteor.Error(
					'expired-consumable', 
					'This authorization token has expired. Please scan again.'
				);
			}
		}

		// Validate payload exists
		if (!consumable.payload) {
			console.error(`[gather.consumable] Token ${consumableId} has no payload`);
			await ApplicationConsumables.removeAsync({ _id: consumableId });
			throw new Meteor.Error('invalid-consumable', 'Token has no payload');
		}

		if (DEBUG) {
			console.log(`[gather.consumable] Token ${consumableId} consumed successfully`);
		}

		// Remove the consumable (single-use)
		await ApplicationConsumables.removeAsync({ _id: consumableId });

		return consumable.payload;
	},

	/**
	 * Revoke Login Token
	 * 
	 * Removes a specific login token from the user's account.
	 * This will log out any sessions using that token.
	 * 
	 * @param {String} resumeTokenId - Token ID to revoke
	 * @returns {Boolean} true if successful
	 * @throws {Meteor.Error} 'not-authorized' if not logged in
	 * @throws {Meteor.Error} 'invalid-user' if user data malformed
	 * @throws {Meteor.Error} 'invalid-token' if token not found
	 */
	'revokeLoginToken': async function(resumeTokenId) {
		check(resumeTokenId, String);

		if (!this.userId) {
			throw new Meteor.Error('not-authorized', 'You must be logged in to revoke a token');
		}

		if (DEBUG) {
			console.log(`[revokeLoginToken] User ${this.userId} revoking token ${resumeTokenId}`);
		}

		// Get current user
		const user = await Meteor.userAsync();

		if (!user || !user.services || !user.services.resume || !user.services.resume.loginTokens) {
			console.error(`[revokeLoginToken] Invalid user structure for ${this.userId}`);
			throw new Meteor.Error('invalid-user', 'Invalid user or loginTokens not available');
		}

		const loginTokens = user.services.resume.loginTokens;

		// Find token to revoke
		const tokenIndex = loginTokens.findIndex(
			(loginToken) => loginToken._id === resumeTokenId
		);

		if (tokenIndex === -1) {
			console.warn(`[revokeLoginToken] Token ${resumeTokenId} not found for user ${this.userId}`);
			throw new Meteor.Error('invalid-token', 'Token not found or already revoked');
		}

		// Remove the token
		loginTokens.splice(tokenIndex, 1);

		// Update user document
		await Meteor.users.updateAsync(
			{ _id: this.userId },
			{ $set: { 'services.resume.loginTokens': loginTokens } }
		);

		if (DEBUG) {
			console.log(`[revokeLoginToken] Token ${resumeTokenId} revoked successfully`);
		}

		return true;
	},

	/**
	 * Enroll Device
	 * 
	 * Generates a new login token for adding a new device.
	 * The token can be shared (via QR code or manually) to log in on another device.
	 * 
	 * @returns {String} Login token
	 * @throws {Meteor.Error} 'not-authorized' if not logged in
	 * @throws {Meteor.Error} 'token-generation-failed' on error
	 */
	'enroll.device': async function() {
		if (!this.userId) {
			throw new Meteor.Error('not-authorized', 'You must be logged in to enroll a new device');
		}

		if (DEBUG) {
			console.log(`[enroll.device] User ${this.userId} enrolling new device`);
		}

		try {
			const user = await Meteor.userAsync();
			
			if (!user || !user.username) {
				throw new Error('User has no username');
			}

			// NOTE: koad.generateLoginToken is not yet implemented anywhere in the packages tree.
			// Device enrollment via this path is non-functional until it is defined.
			// Use Accounts._generateStampedLoginToken() + Accounts._insertLoginToken() directly
			// when implementing — see authorize.session for the reference pattern.
			// TODO: implement koad.generateLoginToken or replace this method body.
			throw new Error('koad.generateLoginToken not yet implemented — device enrollment is not functional');

		} catch (error) {
			console.error(`[enroll.device] Error for user ${this.userId}:`, error.message);
			throw new Meteor.Error('token-generation-failed', `Failed to generate login token: ${error.message}`);
		}
	},

	/**
	 * Authorize Session
	 * 
	 * Creates a one-time login token for a pending session.
	 * Used for cross-device authentication: logged-in user scans QR code
	 * from a pending session, this method generates a token for that session.
	 * 
	 * Flow:
	 *   1. New device visits /authenticate (creates pending session)
	 *   2. Logged-in user scans the session QR code
	 *   3. This method creates a consumable token for that session
	 *   4. Pending session auto-consumes the token and logs in
	 * 
	 * Security:
	 *   - Only logged-in users can authorize sessions
	 *   - Session cannot be already authorized
	 *   - Token expires after 3 minutes
	 *   - Token is single-use
	 * 
	 * @param {String} sessionId - Session ID to authorize
	 * @returns {String} Success message
	 * @throws {Meteor.Error} 'not-authorized' if not logged in
	 * @throws {Meteor.Error} 'session-not-found' if session doesn't exist
	 * @throws {Meteor.Error} 'session-already-authorized' if session already has a user
	 * @throws {Meteor.Error} 'already-consumable' if consumable already exists
	 */
	'authorize.session': async function(sessionId) {
		check(sessionId, String);

		if (!this.userId) {
			throw new Meteor.Error('not-authorized', 'You must be logged in to authorize a session');
		}

		if (DEBUG) {
			console.log(`[authorize.session] User ${this.userId} authorizing session ${sessionId}`);
		}

		// Find the session
		const session = await ApplicationSessions.findOneAsync({ _id: sessionId });
		if (!session) {
			console.warn(`[authorize.session] Session ${sessionId} not found`);
			throw new Meteor.Error('session-not-found', 'The session does not exist or has expired');
		}

		// Check if session is already authorized
		if (session.userId) {
			console.warn(`[authorize.session] Session ${sessionId} already authorized by user ${session.userId}`);
			throw new Meteor.Error('session-already-authorized', 'This session is already logged in');
		}

		// Check if consumable already exists
		const existingConsumable = await ApplicationConsumables.findOneAsync({ _id: sessionId });
		if (existingConsumable) {
			console.warn(`[authorize.session] Consumable already exists for session ${sessionId}`);
			throw new Meteor.Error('already-consumable', 'This session already has a pending token');
		}

		// Generate login token for this user
		const stampedLoginToken = Accounts._generateStampedLoginToken();
		await Accounts._insertLoginToken(this.userId, stampedLoginToken);

		if (DEBUG) {
			console.log(`[authorize.session] Generated login token for user ${this.userId}`);
		}

		// Find the token we just inserted
		const hashedToken = Accounts._hashLoginToken(stampedLoginToken.token);
		const user = await Meteor.users.findOneAsync({ _id: this.userId });
		
		if (!user || !user.services || !user.services.resume || !user.services.resume.loginTokens) {
			console.error(`[authorize.session] Invalid user structure for ${this.userId}`);
			throw new Meteor.Error('invalid-user', 'User data is malformed');
		}

		const loginTokens = user.services.resume.loginTokens;
		const tokenIndex = loginTokens.findIndex(
			(loginToken) => loginToken.hashedToken === hashedToken
		);

		// This should never happen, but check anyway
		if (tokenIndex === -1) {
			console.error(`[authorize.session] Token not found after insertion for user ${this.userId}`);
			throw new Meteor.Error('token-insertion-failed', 'Failed to locate generated token');
		}

		// Generate a unique ID for this token
		const newTokenId = Random.id();

		// Update the token with metadata
		const setObj = {};
		setObj[`services.resume.loginTokens.${tokenIndex}._id`] = newTokenId;
		setObj[`services.resume.loginTokens.${tokenIndex}.type`] = 'session-authorization';
		setObj[`services.resume.loginTokens.${tokenIndex}.authorizedSession`] = sessionId;
		setObj[`services.resume.loginTokens.${tokenIndex}.createdAt`] = new Date();
		
		await Meteor.users.updateAsync(
			{ _id: user._id },
			{ $set: setObj }
		);

		// Update session with consumable reference
		await ApplicationSessions.updateAsync(
			{ _id: session._id },
			{ $set: {
				consumable: newTokenId,
				authorizedBy: this.userId,
				authorizedAt: new Date()
			}}
		);

		// Create consumable token (3 minute expiration)
		await ApplicationConsumables.insertAsync({
			_id: sessionId, // Use session ID so the session can find it
			when: new Date(),
			ttl: 3 * MINUTES,
			payload: stampedLoginToken.token,
			authorizedBy: this.userId,
			tokenId: newTokenId
		});

		if (DEBUG) {
			console.log(`[authorize.session] Session ${sessionId} authorized successfully`);
		}

		return 'Session authorized successfully';
	},

	/**
	 * Update Token Memo
	 * 
	 * Sets a memo/note on a login token for identification purposes.
	 * Useful for naming devices or sessions.
	 * 
	 * @param {String} tokenId - Token ID to update
	 * @param {String} memo - Memo text
	 * @returns {Object} { success: true }
	 * @throws {Meteor.Error} 'not-authorized' if not logged in
	 * @throws {Meteor.Error} 'invalid-token' if token not found
	 */
	'update.token.memo': async function(tokenId, memo) {
		check(tokenId, String);
		check(memo, String);

		if (!this.userId) {
			throw new Meteor.Error('not-authorized', 'You must be logged in to update token memos');
		}

		// Limit memo length
		if (memo.length > 100) {
			throw new Meteor.Error('invalid-memo', 'Memo must be 100 characters or less');
		}

		if (DEBUG) {
			console.log(`[update.token.memo] User ${this.userId} updating token ${tokenId}`);
		}

		const user = await Meteor.users.findOneAsync({ _id: this.userId });
		
		if (!user || !user.services || !user.services.resume || !user.services.resume.loginTokens) {
			throw new Meteor.Error('invalid-user', 'User data is malformed');
		}

		const tokenIndex = user.services.resume.loginTokens.findIndex(token => token._id === tokenId);
		
		if (tokenIndex === -1) {
			console.warn(`[update.token.memo] Token ${tokenId} not found for user ${this.userId}`);
			throw new Meteor.Error('invalid-token', 'Token not found');
		}

		const setObj = {};
		setObj[`services.resume.loginTokens.${tokenIndex}.memo`] = memo;
		setObj[`services.resume.loginTokens.${tokenIndex}.memoUpdatedAt`] = new Date();
		
		await Meteor.users.updateAsync(
			{ _id: this.userId },
			{ $set: setObj }
		);

		if (DEBUG) {
			console.log(`[update.token.memo] Updated token ${tokenId} memo to "${memo}"`);
		}

		return { success: true };
	},

	/**
	 * Deprecated Method (Stub)
	 * 
	 * This method is deprecated and should not be used.
	 * Kept for backwards compatibility.
	 */
	'koad.io-accounts.identify': function() {
		throw new Meteor.Error('deprecated', 'This method is deprecated and should not be used');
	}
});

// ============================================================================
// Commented Out Methods (For Future Implementation)
// ============================================================================

/*
 * Archive Orphan Sessions
 * 
 * Marks orphaned sessions (disconnected but not cleaned up) as archived.
 * Could be re-enabled if session archiving is needed.
 */

/*
 * Revoke Orphan Sessions
 * 
 * Revokes orphaned sessions.
 * Could be re-enabled if session revocation is needed.
 */
