/**
 * OAuth Server Methods
 *
 * Handles the server-side of the GitHub OAuth login flow via ApplicationConsumables.
 *
 * Flow summary:
 *   New user:       oauth.consumable.create → { consumableId }
 *                   → client shows username picker
 *                   → oauth.user.create → { loginToken }
 *                   → Meteor.loginWithToken on client
 *
 *   Returning user: oauth.consumable.create → { loginToken }
 *                   → Meteor.loginWithToken on client
 */

import { Accounts } from 'meteor/accounts-base';

// ============================================================================
// Startup index
// ============================================================================

Meteor.startup(async () => {
	if (koad.mongo?.connection === null) {
		log.debug('[oauth-methods] Skipping index creation (no mongo connection)');
		return;
	}
	try {
		await Meteor.users.createIndexAsync(
			{ 'services.github.id': 1 },
			{ name: 'users_github_id', sparse: true }
		);
		log.debug('[oauth-methods] Index on services.github.id ready');
	} catch (error) {
		log.error('[oauth-methods] Failed to create github index:', error.message);
	}
});

// ============================================================================
// Internal helper — generate a Meteor stamped login token for a userId
// ============================================================================

async function generateLoginToken(userId) {
	const stamped = Accounts._generateStampedLoginToken();
	await Accounts._insertLoginToken(userId, stamped);
	return stamped.token;
}

// ============================================================================
// Methods
// ============================================================================

Meteor.methods({

	/**
	 * oauth.consumable.create
	 *
	 * Called from the OAuth callback handler (server-side, via `this.unblock()`).
	 * Receives the GitHub identity and sponsor tier from the exchange step.
	 *
	 * Returning user  → generates login token directly, returns { loginToken }.
	 * New user        → inserts an OAuth consumable, returns { consumableId }.
	 *
	 * Access token is NOT stored — per architectural decision from koad.
	 * Sponsor tier is written to user.sponsorTier on returning user path.
	 *
	 * @param {Object} params
	 * @param {String} params.provider       - 'github' (only supported value)
	 * @param {Object} params.githubUser     - Raw GitHub /user object
	 * @param {Number} params.sponsorTier    - 0–4
	 * @param {String} params.tierLabel      - Display label
	 * @param {String} params.avatar         - avatar_url from GitHub
	 * @returns {{ loginToken: String } | { consumableId: String }}
	 */
	async 'oauth.consumable.create'({ provider, githubUser, sponsorTier, tierLabel, avatar }) {
		check(provider, String);
		check(githubUser, Object);
		check(sponsorTier, Number);
		check(tierLabel, Match.Maybe(String));
		check(avatar, Match.Maybe(String));

		if (provider !== 'github') {
			throw new Meteor.Error('unsupported-provider', `Provider '${provider}' is not supported`);
		}

		const githubId = githubUser.id;
		if (!githubId) {
			throw new Meteor.Error('invalid-github-user', 'GitHub user has no id field');
		}

		// ── Returning user path ──────────────────────────────────────────────
		const existing = await Meteor.users.findOneAsync(
			{ 'services.github.id': githubId },
			{ fields: { _id: 1 } }
		);

		if (existing) {
			// Update sponsor tier so it stays fresh on each login
			await Meteor.users.updateAsync(
				{ _id: existing._id },
				{
					$set: {
						sponsorTier,
						tierLabel: tierLabel || null,
						'last.login': new Date(),
					},
				}
			);

			const loginToken = await generateLoginToken(existing._id);
			log.success(`[oauth.consumable.create] Returning user ${existing._id} — login token issued`);
			return { loginToken };
		}

		// ── New user path ────────────────────────────────────────────────────
		const consumableId = Random.id();
		await ApplicationConsumables.insertAsync({
			_id: consumableId,
			when: new Date(),
			ttl: 60 * 60 * 1000,  // 1 hour
			type: 'oauth',
			provider: 'github',
			handle: githubUser.login,
			avatar: avatar || githubUser.avatar_url || null,
			sponsorTier,
			tierLabel: tierLabel || null,
			githubData: {
				id:        githubUser.id,
				login:     githubUser.login,
				name:      githubUser.name || null,
				email:     githubUser.email || null,
				avatar_url: githubUser.avatar_url || null,
			},
		});

		log.success(`[oauth.consumable.create] New user consumable ${consumableId} created for @${githubUser.login}`);
		return { consumableId, githubHandle: githubUser.login };
	},

	/**
	 * oauth.user.create
	 *
	 * Called from the onboarding step when a new user picks a username.
	 * Validates the consumable, creates the Meteor user, returns a login token.
	 *
	 * @param {String} consumableId  - The consumable _id from oauth.consumable.create
	 * @param {String} username      - Chosen username (validated via invitation.preflight logic)
	 * @returns {{ loginToken: String }}
	 */
	async 'oauth.user.create'(consumableId, username) {
		check(consumableId, String);
		check(username, String);

		// ── Validate consumable ──────────────────────────────────────────────
		const consumable = await ApplicationConsumables.findOneAsync({ _id: consumableId });
		if (!consumable) {
			throw new Meteor.Error('invalid-consumable', 'OAuth session not found or already used');
		}

		// Manual TTL check (belt-and-suspenders on top of MongoDB TTL index)
		if (consumable.when && consumable.ttl) {
			const expiresAt = new Date(consumable.when.getTime() + consumable.ttl);
			if (expiresAt < new Date()) {
				await ApplicationConsumables.removeAsync({ _id: consumableId });
				throw new Meteor.Error('expired-consumable', 'OAuth session expired — please sign in again');
			}
		}

		if (consumable.type !== 'oauth') {
			throw new Meteor.Error('invalid-consumable', 'This consumable is not an OAuth consumable');
		}

		// ── Validate username ────────────────────────────────────────────────
		const usernameRegex = /^[a-zA-Z0-9-]{5,24}$/;
		if (!usernameRegex.test(username)) {
			throw new Meteor.Error(
				'invalid-username',
				'Username must be 5–24 characters and contain only letters, numbers, and dashes'
			);
		}

		// Check uniqueness
		const existingUser = await Meteor.users.findOneAsync({ username: username.trim().toLowerCase() });
		if (existingUser) {
			throw new Meteor.Error('username-taken', 'That username is already taken');
		}

		// Guard against race: ensure GitHub ID still has no account
		const existingGithub = await Meteor.users.findOneAsync(
			{ 'services.github.id': consumable.githubData.id },
			{ fields: { _id: 1 } }
		);
		if (existingGithub) {
			// Account appeared between consumable.create and user.create — issue a token
			await ApplicationConsumables.removeAsync({ _id: consumableId });
			const loginToken = await generateLoginToken(existingGithub._id);
			return { loginToken };
		}

		// ── Create user ──────────────────────────────────────────────────────
		// Accounts.createUser is synchronous in Meteor 3 with async onCreateUser —
		// use the async form to get the userId back properly.
		const userId = await Accounts.createUser({
			username: username.trim().toLowerCase(),
			services: {
				github: consumable.githubData,
			},
		});

		if (!userId) {
			throw new Meteor.Error('user-creation-failed', 'Failed to create user account');
		}

		// Write sponsor tier onto user doc (not covered by onCreateUser which only sees options/user)
		await Meteor.users.updateAsync(
			{ _id: userId },
			{
				$set: {
					sponsorTier: consumable.sponsorTier,
					tierLabel:   consumable.tierLabel || null,
				},
			}
		);

		// ── Consume the consumable ───────────────────────────────────────────
		await ApplicationConsumables.removeAsync({ _id: consumableId });

		// ── Issue login token ────────────────────────────────────────────────
		const loginToken = await generateLoginToken(userId);

		log.success(`[oauth.user.create] Created user ${username} (${userId}) via GitHub @${consumable.githubData.login}`);
		return { loginToken };
	},

});
