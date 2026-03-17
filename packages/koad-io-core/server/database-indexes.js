/**
 * Database Indexes
 * 
 * Creates indexes on collections for optimal query performance.
 * Runs once on server startup.
 * 
 * Index Strategy:
 * - Index fields used in queries (find, findOne)
 * - Index fields used in sort operations
 * - Create compound indexes for multi-field queries
 * - Use sparse indexes for optional fields
 * - Monitor index usage with db.collection.stats()
 */

Meteor.startup(async () => {
	const DEBUG = Meteor.settings.DEBUG || false;

	if (DEBUG) {
		console.log('[database-indexes] Creating database indexes...');
	}

	try {
		// =====================================================================
		// ApplicationSessions Indexes
		// =====================================================================
		
		// Primary lookup by connection ID (already _id, no index needed)
		
		// Find sessions by user
		await ApplicationSessions.createIndexAsync({ userId: 1 });
		
		// Find sessions by state
		await ApplicationSessions.createIndexAsync({ state: 1 });
		
		// Find orphaned sessions
		await ApplicationSessions.createIndexAsync({ orphanedAt: 1 }, { sparse: true });
		
		// Find closed sessions
		await ApplicationSessions.createIndexAsync({ closed: 1 }, { sparse: true });
		
		// Find sessions by IP address
		await ApplicationSessions.createIndexAsync({ ipaddr: 1 });
		
		// Compound index for active user sessions
		await ApplicationSessions.createIndexAsync(
			{ userId: 1, state: 1, closed: 1 },
			{ name: 'active_user_sessions' }
		);

		// =====================================================================
		// ApplicationSponsors Indexes
		// =====================================================================
		
		// Find sponsors by user
		await ApplicationSponsors.createIndexAsync({ userId: 1 });
		
		// Find sponsors by platform
		await ApplicationSponsors.createIndexAsync({ platform: 1 });
		
		// Find sponsors by status
		await ApplicationSponsors.createIndexAsync({ status: 1 });
		
		// Find sponsors by platform user ID (prevent duplicates)
		await ApplicationSponsors.createIndexAsync(
			{ platform: 1, platformUserId: 1 },
			{ unique: true, name: 'unique_platform_sponsor' }
		);
		
		// Find expired sponsors
		await ApplicationSponsors.createIndexAsync({ expiresAt: 1 });
		
		// Compound index for active sponsors by user
		await ApplicationSponsors.createIndexAsync(
			{ userId: 1, status: 1, verified: 1 },
			{ name: 'active_user_sponsors' }
		);

		// =====================================================================
		// ApplicationInvitations Indexes
		// =====================================================================
		
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

		// =====================================================================
		// ApplicationConsumables Indexes
		// =====================================================================
		
		// Find consumables by session ID (_id is already indexed)
		
		// Find consumables by creator
		await ApplicationConsumables.createIndexAsync({ authorizedBy: 1 });
		
		// Find expired consumables (for cleanup)
		await ApplicationConsumables.createIndexAsync({ when: 1 });
		
		// TTL index - auto-delete consumables after 5 minutes
		await ApplicationConsumables.createIndexAsync(
			{ when: 1 },
			{ expireAfterSeconds: 300, name: 'consumables_ttl' }
		);

		// =====================================================================
		// Users Collection Indexes
		// =====================================================================
		
		// Username lookup (already indexed by Meteor)
		
		// Email lookup
		await Meteor.users.createIndexAsync({ 'emails.address': 1 });
		
		// GitHub OAuth ID lookup
		await Meteor.users.createIndexAsync(
			{ 'services.github.id': 1 },
			{ sparse: true, unique: true }
		);
		
		// Login token lookup (for resume token auth)
		await Meteor.users.createIndexAsync(
			{ 'services.resume.loginTokens.hashedToken': 1 }
		);
		
		// Find users with sponsor links
		await Meteor.users.createIndexAsync(
			{ 'sponsorLinks': 1 },
			{ sparse: true }
		);

		// =====================================================================
		// ApplicationDevices Indexes
		// =====================================================================
		
		if (typeof ApplicationDevices !== 'undefined') {
			// Find devices by serial number
			await ApplicationDevices.createIndexAsync({ serial: 1 }, { unique: true });
			
			// Find devices by last activity
			await ApplicationDevices.createIndexAsync({ asof: 1 });
		}

		// =====================================================================
		// ApplicationStatistics Indexes
		// =====================================================================
		
		if (typeof ApplicationStatistics !== 'undefined') {
			// Statistics are keyed by route (_id), no additional indexes needed
			
			// View count for sorting
			await ApplicationStatistics.createIndexAsync({ view_count: -1 });
		}

		// =====================================================================
		// ApplicationSupporters Indexes (for Ko-fi/manual verification)
		// =====================================================================
		
		if (typeof ApplicationSupporters !== 'undefined') {
			// Find supporters by platform
			await ApplicationSupporters.createIndexAsync({ platform: 1 });
			
			// Find supporters by email
			await ApplicationSupporters.createIndexAsync({ email: 1 });
			
			// Find supporters by username
			await ApplicationSupporters.createIndexAsync({ kofiUsername: 1 }, { sparse: true });
			
			// Prevent duplicate supporter entries
			await ApplicationSupporters.createIndexAsync(
				{ platform: 1, email: 1 },
				{ unique: true, name: 'unique_platform_supporter' }
			);
			
			// Find by last payment date (for expiration checks)
			await ApplicationSupporters.createIndexAsync({ lastPayment: 1 });
		}

		// =====================================================================
		// GlobalSearch Indexes
		// =====================================================================
		
		if (typeof GlobalSearch !== 'undefined') {
			// Find searches by user
			await GlobalSearch.createIndexAsync({ userId: 1, timestamp: -1 });
			
			// Find recent searches
			await GlobalSearch.createIndexAsync({ timestamp: -1 });
			
			// TTL index - auto-delete old searches after 30 days
			await GlobalSearch.createIndexAsync(
				{ timestamp: 1 },
				{ expireAfterSeconds: 2592000, name: 'search_history_ttl' }
			);
		}

		if (DEBUG) {
			console.log('[database-indexes] All indexes created successfully');
		}

	} catch (error) {
		console.error('[database-indexes] Error creating indexes:', error);
		// Don't throw - server should still start even if indexes fail
	}
});

log.success('loaded koad-io-core/database-indexes');
