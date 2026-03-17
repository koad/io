/**
 * Database Indexes
 * 
 * Creates indexes on koad-io-core collections for optimal query performance.
 * Runs once on server startup.
 * 
 * Index Strategy:
 * - Index fields used in queries (find, findOne)
 * - Index fields used in sort operations
 * - Create compound indexes for multi-field queries
 * - Use sparse indexes for optional fields
 * - Monitor index usage with db.collection.stats()
 * 
 * IMPORTANT: Indexes for collections defined in other packages should be
 * created in those packages, not here:
 * - ApplicationSponsors, ApplicationInvitations, Meteor.users -> koad-io-accounts-core
 * - GlobalSearch -> koad-io-core/server/search.js
 * 
 * Note: Meteor MongoDB has issues with concurrent index creation.
 * We don't batch them with Promise.all - Meteor handles the queue internally.
 */

Meteor.startup(async () => {
	const DEBUG = Meteor.settings.DEBUG || false;

	if (DEBUG) {
		log.debug('[database-indexes] Creating database indexes...');
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
		
		// Find sessions by instance (for orphan cleanup)
		await ApplicationSessions.createIndexAsync({ instance: 1 });
		
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
		// ApplicationConsumables Indexes
		// =====================================================================
		
		// Find consumables by session ID (_id is already indexed)
		
		// Find consumables by creator
		await ApplicationConsumables.createIndexAsync({ authorizedBy: 1 });
		
		// TTL index - auto-delete consumables after 5 minutes
		// Note: This also serves as the index for finding expired consumables
		try {
			await ApplicationConsumables.createIndexAsync(
				{ when: 1 },
				{ expireAfterSeconds: 300, name: 'consumables_ttl' }
			);
		} catch (error) {
			if (error.message.includes('equivalent index already exists')) {
				// Drop old index without TTL and recreate with TTL
				log.debug('[database-indexes] Dropping old when_1 index and recreating with TTL...');
				await ApplicationConsumables.dropIndexAsync('when_1').catch(() => {});
				await ApplicationConsumables.createIndexAsync(
					{ when: 1 },
					{ expireAfterSeconds: 300, name: 'consumables_ttl' }
				);
			} else {
				throw error;
			}
		}

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
		// ApplicationSupporters Indexes
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

		if (DEBUG) {
			log.debug('[database-indexes] All indexes created successfully');
		}

	} catch (error) {
		console.error('[database-indexes] Error creating indexes:', error);
		// Don't throw - server should still start even if indexes fail
	}
});

log.success('loaded koad-io-core/database-indexes');
