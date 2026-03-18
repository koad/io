/**
 * Database Indexes for Accounts Collections
 * 
 * Creates indexes on Meteor.users and related collections.
 * Runs once on server startup.
 */

Meteor.startup(async () => {
	try {
		log.debug('[accounts] Creating database indexes...');
		
		// =====================================================================
		// Meteor.users Collection Indexes
		// =====================================================================
		
		// Username lookup (already indexed by Meteor accounts-base)
		// Email lookup (already indexed by Meteor accounts-base)
		
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
		
		log.debug('[accounts] Database indexes created');
	} catch (error) {
		log.error('[accounts] Error creating indexes:', error.message);
	}
});
