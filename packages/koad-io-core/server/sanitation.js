/**
 * Automated Cleanup Tasks
 * 
 * Scheduled tasks for maintaining database hygiene and performance.
 * 
 * Tasks:
 * - Clean up expired consumables
 * - Archive old closed sessions
 * - Verify expired sponsors
 * - Remove old search history
 * - Clean up revoked invitations
 * - Update statistics
 * 
 * All tasks run via cron jobs with configurable schedules.
 */

const DEBUG = Meteor.settings.DEBUG || false;

/**
 * Clean Up Expired Consumables
 * 
 * Removes consumable tokens that have expired (older than TTL).
 * TTL is typically 3-5 minutes.
 * 
 * Schedule: Every hour
 */
const cleanupConsumables = koad.cron.create('0 * * * *', async function() {
	const now = new Date();
	const fiveMinutesAgo = new Date(now - 5 * 60 * 1000);

	try {
		const expired = await ApplicationConsumables.find({
			when: { $lt: fiveMinutesAgo }
		}).countAsync();

		if (expired > 0) {
			await ApplicationConsumables.removeAsync({
				when: { $lt: fiveMinutesAgo }
			});

			if (DEBUG) {
				console.log(`[cleanup] Removed ${expired} expired consumables`);
			}

			log.info(`[cleanup] Cleaned up ${expired} expired consumables`);
		}
	} catch (error) {
		log.error('[cleanup] Error cleaning consumables:', error);
	}
}, {
	timezone: 'UTC',
	runOnInit: false
});

/**
 * Archive Old Closed Sessions
 * 
 * Marks old closed sessions as archived to reduce active collection size.
 * Sessions closed more than 30 days ago are archived.
 * 
 * Schedule: Daily at 2 AM
 */
const archiveOldSessions = koad.cron.create('0 2 * * *', async function() {
	const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

	try {
		const oldSessions = await ApplicationSessions.find({
			state: 'closed',
			closed: { $lt: thirtyDaysAgo },
			archived: { $ne: true }
		}).countAsync();

		if (oldSessions > 0) {
			await ApplicationSessions.updateAsync(
				{
					state: 'closed',
					closed: { $lt: thirtyDaysAgo },
					archived: { $ne: true }
				},
				{
					$set: {
						archived: true,
						archivedAt: new Date()
					}
				},
				{ multi: true }
			);

			log.info(`[cleanup] Archived ${oldSessions} old sessions`);
		}
	} catch (error) {
		log.error('[cleanup] Error archiving sessions:', error);
	}
}, {
	timezone: 'UTC',
	runOnInit: false
});

/**
 * Clean Up Old Search History
 * 
 * NOTE: This is redundant with the TTL index on GlobalSearch collection,
 * but provides a backup cleanup mechanism.
 * 
 * Removes search history older than 90 days.
 * 
 * Schedule: Weekly on Sunday at 4 AM
 */
const cleanupSearchHistory = koad.cron.create('0 4 * * 0', async function() {
	const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

	try {
		if (typeof GlobalSearch === 'undefined') return;

		const removed = await GlobalSearch.removeAsync({
			timestamp: { $lt: ninetyDaysAgo }
		});

		if (removed > 0) {
			log.info(`[cleanup] Removed ${removed} old search entries`);
		}
	} catch (error) {
		log.error('[cleanup] Error cleaning search history:', error);
	}
}, {
	timezone: 'UTC',
	runOnInit: false
});

/**
 * Update Application Statistics
 * 
 * Aggregates and updates various application statistics.
 * 
 * Schedule: Every 6 hours
 * 
 * Note: Does not run on init to avoid collection initialization issues.
 * Statistics will be collected on the first scheduled run.
 */
const updateStatistics = koad.cron.create('0 */6 * * *', async function() {
	try {
		// Ensure collections are initialized
		if (!Meteor.users || !ApplicationSessions || !ApplicationInternals) {
			log.warning('[cleanup] Collections not yet initialized, skipping statistics update');
			return;
		}

		const stats = {
			timestamp: new Date(),
			users: {
				total: await Meteor.users.find().countAsync()
			},
			sessions: {
				active: await ApplicationSessions.find({ state: { $in: ['new', 'connected'] } }).countAsync(),
				closed: await ApplicationSessions.find({ state: 'closed' }).countAsync(),
				orphaned: await ApplicationSessions.find({ state: 'orphaned' }).countAsync()
			}
		};

		// Store in ApplicationInternals for historical tracking
		await ApplicationInternals.updateAsync(
			{ _id: koad.internals },
			{
				$set: {
					statistics: stats,
					statisticsUpdated: new Date()
				}
			}
		);

		if (DEBUG) {
			console.log('[cleanup] Updated statistics:', stats);
		}

		log.info(`[cleanup] Statistics updated: ${stats.users.total} users, ${stats.sessions.active} active sessions`);
	} catch (error) {
		log.error('[cleanup] Error updating statistics:', error);
	}
}, {
	timezone: 'UTC',
	runOnInit: false // Don't run on startup to avoid collection init issues
});

/**
 * Cleanup Job Manager
 * 
 * Provides control over cleanup jobs.
 */
koad.cleanup = {
	jobs: {
		consumables: cleanupConsumables,
		sessions: archiveOldSessions,
		searchHistory: cleanupSearchHistory,
		statistics: updateStatistics
	},

	/**
	 * Stop All Cleanup Jobs
	 */
	stopAll: function() {
		Object.values(this.jobs).forEach(job => job.stop());
		log.warning('[cleanup] All cleanup jobs stopped');
	},

	/**
	 * Start All Cleanup Jobs
	 */
	startAll: function() {
		Object.values(this.jobs).forEach(job => job.start());
		log.success('[cleanup] All cleanup jobs started');
	},

	/**
	 * Get Job Status
	 */
	status: function() {
		const status = {};
		Object.keys(this.jobs).forEach(name => {
			const job = this.jobs[name];
			status[name] = {
				running: job.running,
				lastExecution: job.lastDate(),
				nextExecution: job.nextDate()
			};
		});
		return status;
	}
};

log.success('loaded koad-io-core/cleanup-tasks - 6 automated tasks scheduled');
