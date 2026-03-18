/**
 * New User Shaper
 * 
 * Customizes user document structure when new users are created.
 * 
 * Key Features:
 * - Generates deterministic CID-based user IDs from username
 * - Normalizes usernames (lowercase, trimmed)
 * - Tracks creator entity (for multi-instance deployments)
 * - Prevents duplicate IDs
 * - Supports invitation tracking
 * 
 * User Document Structure:
 * {
 *   _id: String (CID generated from username),
 *   username: String (lowercase, normalized),
 *   creator: String (entity://internals URI),
 *   created: Date,
 *   profile: Object (optional),
 *   invitiation: Object (optional, typo preserved for compatibility),
 *   services: {
 *     resume: { loginTokens: [] },
 *     github: { ... } // If OAuth used
 *   },
 *   emails: [],
 *   roles: [],
 *   sponsorLinks: [],
 *   invitations: { quota: 9, spent: 0 }
 * }
 */

import { Accounts } from "meteor/accounts-base";

/**
 * User Creation Hook
 * 
 * Called when a new user is created (signup, OAuth, invitation redemption).
 * Shapes the user document before it's inserted into the database.
 * 
 * @param {Object} options - User creation options (username, profile, etc)
 * @param {Object} user - Initial user document from Meteor
 * @returns {Object} Shaped user document
 * @throws {Meteor.Error} 'username-required' if no username provided
 * @throws {Meteor.Error} 'duplicate-id' if CID collision detected
 */
Accounts.onCreateUser(async (options, user) => {
	// Validate required fields
	if (!options.username) {
		throw new Meteor.Error('username-required', 'Username is required for account creation');
	}

	// Normalize username (lowercase, trimmed)
	user.username = options.username.trim().toLowerCase();

	// Generate deterministic CID-based user ID
	// This ensures consistent IDs across instances and enables federation
	user._id = koad.generate.cid(user.username);

	// Check for ID collision (extremely rare with CIDs, but possible)
	const existingUser = await Meteor.users.findOneAsync(user._id);
	if (existingUser) {
		throw new Meteor.Error(
			'duplicate-id',
			'User with the same ID already exists. This username may be taken.'
		);
	}

	// Track which instance/entity created this user
	user.creator = `${koad.entity}://${koad.internals}`;

	// Use consistent 'created' field instead of Meteor's 'createdAt'
	user.created = user.createdAt;
	delete user.createdAt;

	// Copy optional fields
	if (options.profile) {
		user.profile = options.profile;
	}

	// Note: Typo 'invitiation' preserved for backward compatibility
	// TODO: Migrate to 'invitation' in future major version
	if (options.invitiation) {
		user.invitiation = options.invitiation;
	}

	// Initialize invitation quota
	user.invitations = {
		quota: 9, // Default quota, can be adjusted per-user later
		spent: 0
	};

	// Initialize counters
	user.counters = {
		login: 0,
		pageviews: 0
	};

	log.success(`[new-user] Created user: ${user.username} (${user._id})`);

	return user;
});

/**
 * Security: Deny all client-side updates to user documents
 * 
 * User documents contain sensitive data and must only be modified
 * through server-side methods with proper validation.
 */
Meteor.users.deny({
	update() { return true; }
});

log.success('loaded koad-io-accounts-core/new-user-shaper');
