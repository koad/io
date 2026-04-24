/**
 * Invitation System
 * 
 * Allows authenticated users to invite new members via token-based invitations.
 * 
 * Flow:
 * 1. User creates invitation (gets login token + invitation record)
 * 2. Invitation link is shared (/invite/:token)
 * 3. New user clicks link and logs in with token
 * 4. Invitation marked as redeemed
 * 
 * Collection Structure:
 * {
 *   _id: String (random ID),
 *   creator: String (userId who created it),
 *   creatorUsername: String,
 *   status: 'pending' | 'redeemed' | 'revoked',
 *   loginToken: String (the actual token for /invite/:token),
 *   recipientName: String (optional),
 *   recipientEmail: String (optional),
 *   memo: String (optional note),
 *   created: Date,
 *   redeemedAt: Date,
 *   redeemedBy: String (userId),
 *   redeemedByUsername: String
 * }
 */
ApplicationInvitations = new Mongo.Collection('invitations');

/**
 * Publish user's own invitations
 */
Meteor.publish('ApplicationInvitations', function() {
	if (!this.userId) return this.ready();
	return ApplicationInvitations.find({ creator: this.userId });
});

Meteor.methods({
	/**
	 * Create Invitation
	 * 
	 * Generates a login token and invitation record.
	 * 
	 * @param {String} recipientName - Optional recipient name
	 * @param {String} recipientEmail - Optional recipient email
	 * @param {String} memo - Optional note about invitation
	 * @returns {Object} { invitationId, invitationUrl, token }
	 */
	async 'invitation.create'({ recipientName, recipientEmail, memo } = {}) {
		const currentUser = Meteor.userId();
		if (!currentUser) {
			throw new Meteor.Error('not-authorized', 'You must be logged in to create invitations');
		}

		const user = await Meteor.users.findOneAsync({ _id: currentUser });
		if (!user) {
			throw new Meteor.Error('invalid-user', 'User not found');
		}

		// Check invitation quota (default 9, configurable per user)
		const maxInvitations = user.invitations?.quota || 9;
		const usedInvitations = await ApplicationInvitations.find({
			creator: currentUser,
			status: { $ne: 'revoked' } // Don't count revoked
		}).countAsync();

		if (usedInvitations >= maxInvitations) {
			throw new Meteor.Error(
				'quota-exceeded',
				`You have used all ${maxInvitations} of your available invitations`
			);
		}

		// Generate login token for the invitation
		const stampedLoginToken = Accounts._generateStampedLoginToken();
		await Accounts._insertLoginToken(currentUser, stampedLoginToken);

		// Find the token we just inserted
		const hashedToken = Accounts._hashLoginToken(stampedLoginToken.token);
		const updatedUser = await Meteor.users.findOneAsync({ _id: currentUser });
		const loginTokens = updatedUser.services.resume.loginTokens;
		const tokenIndex = loginTokens.findIndex(
			(loginToken) => loginToken.hashedToken === hashedToken
		);

		if (tokenIndex === -1) {
			throw new Meteor.Error('token-creation-failed', 'Failed to create invitation token');
		}

		// Mark the token as an invitation token
		const tokenId = Random.id();
		const setObj = {};
		setObj[`services.resume.loginTokens.${tokenIndex}._id`] = tokenId;
		setObj[`services.resume.loginTokens.${tokenIndex}.type`] = 'invitation';
		setObj[`services.resume.loginTokens.${tokenIndex}.memo`] = memo || 'Invitation token';

		await Meteor.users.updateAsync(
			{ _id: currentUser },
			{ $set: setObj }
		);

		// Create invitation record
		const invitationId = Random.id();
		await ApplicationInvitations.insertAsync({
			_id: invitationId,
			creator: currentUser,
			creatorUsername: user.username,
			status: 'pending',
			loginToken: Accounts._hashLoginToken(stampedLoginToken.token), // store hashed, never raw
			tokenId: tokenId,
			recipientName: recipientName || null,
			recipientEmail: recipientEmail || null,
			memo: memo || '',
			created: new Date()
		});

		// Update user's invitation counter
		await Meteor.users.updateAsync(
			{ _id: currentUser },
			{ $set: { 'invitations.spent': usedInvitations + 1 } }
		);

		// Generate invitation URL
		const rootUrl = Meteor.settings.public?.rootUrl || Meteor.absoluteUrl();
		const invitationUrl = `${rootUrl}invite/${stampedLoginToken.token}`;

		log.success(`[invitation.create] User ${user.username} created invitation ${invitationId}`);

		return {
			invitationId,
			invitationUrl,
			token: stampedLoginToken.token
		};
	},

	/**
	 * Legacy method name for backward compatibility
	 */
	async 'GenerateInviteCode'(recipientName, recipientEmail) {
		return await Meteor.call('invitation.create', {
			recipientName,
			recipientEmail
		});
	},
	async 'invitation.update'({ id, memo }) {
		check(id, String); 
		check(memo, String);       
		
		const currentUser = Meteor.userId();
		if (!currentUser) throw new Meteor.Error('not-authorized', 'You must be logged in to update an invitation.');
		
		const invitation = await ApplicationInvitations.findOneAsync({ _id: id });
		if (!invitation) throw new Meteor.Error('invalid-invitation', 'The invitation you are trying to update does not exist.');
		if (invitation.creator !== currentUser) throw new Meteor.Error('not-authorized', 'You can only update invitations you created.');
		
		await ApplicationInvitations.updateAsync(
			{ _id: invitation._id },
			{ $set: { memo } }
		);

		return { success: true };
	},
	async 'invitation.revoke'(id) {
		check(id, String);
		
		const currentUser = Meteor.userId();
		if (!currentUser) throw new Meteor.Error('not-authorized', 'You must be logged in to revoke an invitation.');
		
		const invitation = await ApplicationInvitations.findOneAsync({ _id: id });
		if (!invitation) throw new Meteor.Error('invalid-invitation', 'The invitation you are trying to revoke does not exist.');
		if (invitation.creator !== currentUser) throw new Meteor.Error('not-authorized', 'You can only revoke invitations you created.');
		
		await ApplicationInvitations.updateAsync(
			{ _id: id },
			{ $set: { status: 'revoked' } }
		);

		return { success: true };
	},
	async 'invitation.reclaim'(id) {
		check(id, String);

		const currentUser = Meteor.userId();
		if (!currentUser) throw new Meteor.Error('not-authorized', 'You must be logged in to reclaim an invitation.');
		
		const invitation = await ApplicationInvitations.findOneAsync({ _id: id });
		if (!invitation) throw new Meteor.Error('invalid-invitation', 'The invitation you are trying to reclaim does not exist.');
		if (invitation.creator !== currentUser) throw new Meteor.Error('not-authorized', 'You can only reclaim invitations you created.');
		if (invitation.status !== 'revoked') throw new Meteor.Error('not-authorized', 'You can only reclaim invitations that have been revoked.');
		
		await ApplicationInvitations.removeAsync({ _id: id });
		await Accounts.users.updateAsync({_id: currentUser}, {$set: {'invitations.spent': await ApplicationInvitations.find({ creator: currentUser }).countAsync() }});

		return { success: true };
	},
	async 'invitation.validate'(id) {
		check(id, String);

		const invitation = await ApplicationInvitations.findOneAsync({
			_id: id,
			status: 'pending', 
			revoked: { $ne: true }, 
			redeemed: { $ne: true } 
		});

		if (invitation) return { success: true };
		throw new Meteor.Error('invalid-invitation', 'This invitation is invalid or has been revoked.');
	},
	async 'invitation.preflight'(id, username) {
		check(id, String);
		check(username, String);
		if (this.userId) throw new Meteor.Error('not-authorized', 'nope');

		const invitation = await ApplicationInvitations.findOneAsync({_id: id, status: 'pending'});
		if (!invitation) throw new Meteor.Error('invalid-invitation', 'This invitation is not valid or has already been used.');

		const existingUser = await Meteor.users.findOneAsync({username: username});
		if (existingUser) return { available: false }; 

		const usernameRegex = /^[a-zA-Z0-9-]{5,24}$/;
		if (!usernameRegex.test(username)) throw new Meteor.Error('invalid-username', 'Username must be between 5-24 characters and can only contain letters, numbers, and dashes.');

		return { available: true };
	},

	/**
	 * Mark Invitation as Redeemed
	 * 
	 * Called when a user successfully logs in via an invitation token.
	 * This is typically called automatically when login succeeds.
	 * 
	 * @param {String} token - The invitation token that was used
	 */
	async 'invitation.redeem'(token) {
		check(token, String);

		const currentUser = Meteor.userId();
		if (!currentUser) {
			throw new Meteor.Error('not-authorized', 'You must be logged in to redeem an invitation');
		}

		const user = await Meteor.users.findOneAsync({ _id: currentUser });
		if (!user) {
			throw new Meteor.Error('invalid-user', 'User not found');
		}

		// Find the invitation by hashed token (we store hashed, never raw)
		const invitation = await ApplicationInvitations.findOneAsync({
			loginToken: Accounts._hashLoginToken(token),
			status: 'pending'
		});

		if (!invitation) {
			// Invitation may have already been redeemed or doesn't exist
			// This is not necessarily an error (could be a normal login token)
			return { success: false, reason: 'not-found' };
		}

		// Mark as redeemed
		await ApplicationInvitations.updateAsync(
			{ _id: invitation._id },
			{
				$set: {
					status: 'redeemed',
					redeemedAt: new Date(),
					redeemedBy: currentUser,
					redeemedByUsername: user.username
				}
			}
		);

		log.success(`[invitation.redeem] User ${user.username} redeemed invitation from ${invitation.creatorUsername}`);

		return { success: true };
	}
});

/**
 * Hook into login to auto-redeem invitations
 * 
 * When a user logs in with an invitation token, automatically mark
 * the invitation as redeemed.
 */
Accounts.onLogin(async (loginInfo) => {
	try {
		const { user } = loginInfo;
		const resumeToken = loginInfo.methodArguments?.[0]?.resume;

		if (!resumeToken || !user) return;

		// Check if this token is an invitation token
		const loginTokens = user.services?.resume?.loginTokens || [];
		const hashedToken = Accounts._hashLoginToken(resumeToken);
		const matchingToken = loginTokens.find(
			(token) => token.hashedToken === hashedToken
		);

		if (matchingToken?.type === 'invitation') {
			// Directly mark the invitation as redeemed — no reason to go through the method layer from a server hook
			const hashedResumeToken = Accounts._hashLoginToken(resumeToken);
			await ApplicationInvitations.updateAsync(
				{ loginToken: hashedResumeToken, status: 'pending' },
				{
					$set: {
						status: 'redeemed',
						redeemedAt: new Date(),
						redeemedBy: user._id,
						redeemedByUsername: user.username
					}
				}
			);
		}
	} catch (error) {
		console.error('[onLogin] Error processing invitation redemption:', error);
	}
});

// ============================================================================
// Database Indexes
// ============================================================================

Meteor.startup(async () => {
	if (koad.mongo?.connection === null) {
		log.debug('[invitations] Skipping index creation (no mongo connection)');
		return;
	}
	try {
		log.debug('[invitations] Creating database indexes...');

		// Find invitations by creator
		await ApplicationInvitations.createIndexAsync({ creator: 1 });
		
		// Find invitations by status
		await ApplicationInvitations.createIndexAsync({ status: 1 });
		
		// Find invitation by login token (for redemption)
		await ApplicationInvitations.createIndexAsync(
			{ loginToken: 1 },
			{ unique: true, sparse: true }
		);
		
		// Compound index for pending invitations by creator
		await ApplicationInvitations.createIndexAsync(
			{ creator: 1, status: 1 },
			{ name: 'creator_pending_invitations' }
		);
		
		log.debug('[invitations] Database indexes created');
	} catch (error) {
		log.error('[invitations] Error creating indexes:', error.message);
	}
});

