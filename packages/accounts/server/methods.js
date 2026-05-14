/**
 * Account Core Server Methods
 *
 * Legacy methods from the Meteor.Accounts QR flow (SUPERSEDED by VESTA-SPEC-185).
 *
 * Per SPEC-185 §8.6: The login-token-based approach is retired.
 * The DDP connection IS the session; the PGP fingerprint IS the credential.
 * Use identity.authorizeSession / identity.revokeSession instead.
 *
 * Status: methods stubbed with Meteor.Error('superseded') pointing to replacements.
 * DO NOT re-implement these — the spec is clear that Meteor.Accounts is not the model.
 */

// ============================================================================
// Methods (superseded stubs)
// ============================================================================

Meteor.methods({
	/**
	 * @deprecated Superseded by VESTA-SPEC-185.
	 * The QR session-authorization flow now uses identity.authorizeSession.
	 */
	'gather.consumable': async function(consumableId) {
		check(consumableId, String);
		throw new Meteor.Error(
			'superseded',
			'gather.consumable is superseded by VESTA-SPEC-185. ' +
			'The new QR flow tags DDP sessions via identity.authorizeSession — no consumable token needed.'
		);
	},

	/**
	 * @deprecated Superseded by VESTA-SPEC-185.
	 * Session revocation is now via identity.revokeSession (clears DDP fingerprint).
	 */
	'revokeLoginToken': async function(resumeTokenId) {
		check(resumeTokenId, String);
		throw new Meteor.Error(
			'superseded',
			'revokeLoginToken is superseded by VESTA-SPEC-185. ' +
			'Use identity.revokeSession to clear a delegated DDP session fingerprint.'
		);
	},

	/**
	 * @deprecated Superseded by VESTA-SPEC-185.
	 * New device enrollment is via the QR ceremony at /me: Device B displays its
	 * DDP sessionId as a QR; Device A calls identity.authorizeSession to tag it.
	 */
	'enroll.device': async function() {
		throw new Meteor.Error(
			'superseded',
			'enroll.device is superseded by VESTA-SPEC-185. ' +
			'New device QR ceremony: display sessionId at /me, authorize via identity.authorizeSession.'
		);
	},

	/**
	 * @deprecated Superseded by VESTA-SPEC-185 §8.7.
	 * Session authorization is now via identity.authorizeSession, which tags the
	 * target DDP session's fingerprint directly — no login token required.
	 */
	'authorize.session': async function(sessionId) {
		check(sessionId, String);
		throw new Meteor.Error(
			'superseded',
			'authorize.session is superseded by VESTA-SPEC-185 §8.7. ' +
			'Use identity.authorizeSession({ targetSessionId }) to tag a pending DDP session.'
		);
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
