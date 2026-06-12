/**
 * ApplicationCounters Collection
 * 
 * In-memory collection for tracking runtime statistics and metrics.
 * Does not persist to MongoDB (connection: null).
 * 
 * Use Cases:
 * - Error counting by type
 * - Request counting
 * - Performance metrics
 * - Runtime statistics
 * 
 * Document Structure:
 * {
 *   _id: String (counter name),
 *   count: Number,
 *   lastUpdated: Date,
 *   ... (counter-specific fields)
 * }
 * 
 * Examples:
 * - { _id: 'Errors', count: 42, noVisitRecordFound: 3 }
 * - { _id: 'Requests', count: 1337, perSecond: 10 }
 * 
 * Note: Being in-memory, counters reset on server restart.
 * For persistent metrics, use ApplicationStatistics collection.
 * 
 * TODO: Implement periodic snapshots to ApplicationProcesses
 * This would preserve metrics across restarts and enable historical analysis.
 */

ApplicationCounters = new Meteor.Collection("counters", {
	idGeneration: 'MONGO',
	connection: null // In-memory only, no MongoDB persistence
});

/**
 * Security: Deny all client-side operations
 * 
 * ApplicationCounters are server-only and should never be modified by clients.
 */
ApplicationCounters.allow({
	insert: function (userId, doc) {
		return false;
	},
	update: function (userId, doc, fieldNames, modifier) {
		return false;
	},
	remove: function (userId, doc) {
		return false;
	}
});

/**
 * Helper: Increment Counter
 * 
 * Convenience function for incrementing a counter field.
 * Creates the counter document if it doesn't exist.
 * 
 * @param {String} counterId - Counter document ID
 * @param {String} field - Field to increment (default: 'count')
 * @param {Number} amount - Amount to increment by (default: 1)
 */
koad.counters = {
	increment: async (counterId, field = 'count', amount = 1) => {
		const counter = await ApplicationCounters.findOneAsync(counterId);
		
		if (!counter) {
			const newCounter = {
				_id: counterId,
				created: new Date(),
				[field]: amount
			};
			await ApplicationCounters.insertAsync(newCounter);
		} else {
			const update = { $inc: {} };
			update.$inc[field] = amount;
			update.$set = { lastUpdated: new Date() };
			await ApplicationCounters.updateAsync(counterId, update);
		}
	},
	
	/**
	 * Get Counter Value
	 * 
	 * @param {String} counterId - Counter document ID
	 * @param {String} field - Field to get (default: 'count')
	 * @returns {Number} Counter value or 0 if not found
	 */
	get: async (counterId, field = 'count') => {
		const counter = await ApplicationCounters.findOneAsync(counterId);
		return counter?.[field] || 0;
	},
	
	/**
	 * Reset Counter
	 * 
	 * @param {String} counterId - Counter document ID
	 */
	reset: async (counterId) => {
		await ApplicationCounters.removeAsync(counterId);
	}
};

// TODO: Implement periodic snapshots
// Meteor.setInterval(() => {
//   const counters = ApplicationCounters.find().fetch();
//   ApplicationProcesses.update(
//     { _id: koad.internals },
//     { $set: { counters, countersSnapshot: new Date() } }
//   );
// }, 60 * 1000); // Every minute

log.success('loaded koad-io-core/counters');
