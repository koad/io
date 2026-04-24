/**
 * Global Search System
 * 
 * Provides full-text search across collections registered by the app.
 * 
 * Features:
 * - Collection registration API
 * - Multi-field search per collection
 * - Regex-based text matching
 * - Custom query filters
 * - Result ranking
 * - Search history tracking
 * - Configurable result limits
 * 
 * Usage:
 *   // Register a collection for search (in your app code)
 *   koad.search.register('products', {
 *     collection: Products,
 *     fields: ['name', 'description', 'sku'],
 *     filter: (userId) => ({ published: true }), // Optional
 *     projection: { name: 1, price: 1, image: 1 }, // Optional
 *     sort: { createdAt: -1 } // Optional
 *   });
 * 
 *   // Search
 *   Meteor.call('search', 'query string', (err, results) => {
 *     console.log(results);
 *   });
 */

/**
 * GlobalSearch Collection
 * 
 * Stores search history for analytics and autocomplete.
 */
GlobalSearch = new Mongo.Collection('global_search', koad.mongo);

/**
 * Search Registry
 * 
 * Stores collection search configurations.
 * Key: collection name (string)
 * Value: { collection, fields, filter, projection, sort, limit }
 */
const searchRegistry = new Map();

/**
 * Register Collection API
 * 
 * Allows apps to register collections for server-side search.
 * Should be called in server startup code.
 */
koad.search = {
	register(name, config) {
		if (!name || typeof name !== 'string') {
			throw new Error('[search.register] Collection name must be a non-empty string');
		}

		if (!config.collection) {
			throw new Error(`[search.register] Collection "${name}" requires a collection object`);
		}

		if (!config.fields || !Array.isArray(config.fields) || config.fields.length === 0) {
			throw new Error(`[search.register] Collection "${name}" requires fields array`);
		}

		searchRegistry.set(name, {
			collection: config.collection,
			fields: config.fields,
			filter: config.filter || null, // Function: (userId) => query
			projection: config.projection || null,
			sort: config.sort || null,
			limit: config.limit || 10
		});

		log.debug(`[search] Registered collection "${name}" with fields:`, config.fields);
	},

	unregister(name) {
		searchRegistry.delete(name);
		log.debug(`[search] Unregistered collection "${name}"`);
	},

	getRegistered() {
		return Array.from(searchRegistry.keys());
	}
};

Meteor.methods({
	/**
	 * Global Search
	 * 
	 * Searches across registered collections for a query string.
	 * 
	 * @param {String} query - Search query
	 * @param {Object} options - Search options
	 * @param {Number} options.limit - Max results per collection (overrides registration limit)
	 * @param {Array} options.collections - Specific collections to search (default: all registered)
	 * @returns {Object} Search results grouped by collection
	 */
	async search(query, options = {}) {
		check(query, String);

		// Authorization: only logged-in users can search
		if (!this.userId) {
			throw new Meteor.Error('not-authorized', 'You must be logged in to search');
		}

		const DEBUG = Meteor.settings.DEBUG || false;

		if (!query || query.trim().length < 2) {
			return { results: {}, query, count: 0 };
		}

		const searchTerm = query.trim();
		const regex = new RegExp(searchTerm, 'i'); // Case-insensitive

		if (DEBUG) {
			log.debug(`[search] Query: "${searchTerm}" by user ${this.userId}`);
		}

		// Determine which collections to search
		const collectionsToSearch = options.collections || Array.from(searchRegistry.keys());

		if (collectionsToSearch.length === 0) {
			if (DEBUG) {
				log.debug('[search] No collections registered for search');
			}
			return { results: {}, query: searchTerm, count: 0 };
		}

		const results = {};
		let totalCount = 0;

		// Search each registered collection
		for (const collectionName of collectionsToSearch) {
			const config = searchRegistry.get(collectionName);
			
			if (!config) {
				if (DEBUG) {
					log.debug(`[search] Collection "${collectionName}" not registered, skipping`);
				}
				continue;
			}

			try {
				// Build search query
				const orConditions = config.fields.map(field => ({
					[field]: regex
				}));

				let baseQuery = { $or: orConditions };

				// Apply custom filter if provided
				if (config.filter && typeof config.filter === 'function') {
					const filterQuery = config.filter(this.userId);
					baseQuery = { $and: [baseQuery, filterQuery] };
				}

				// Build find options
				const findOptions = {
					limit: options.limit || config.limit || 10
				};

				if (config.projection) {
					findOptions.fields = config.projection;
				}

				if (config.sort) {
					findOptions.sort = config.sort;
				}

				// Execute search
				const docs = await config.collection.find(baseQuery, findOptions).fetchAsync();

				results[collectionName] = docs;
				totalCount += docs.length;

				if (DEBUG && docs.length > 0) {
					log.debug(`[search] Found ${docs.length} results in "${collectionName}"`);
				}
			} catch (error) {
				log.error(`[search] Error searching collection "${collectionName}":`, error.message);
			}
		}

		// Log search to history
		await GlobalSearch.insertAsync({
			userId: this.userId,
			query: searchTerm,
			resultCount: totalCount,
			timestamp: new Date(),
			collections: Object.keys(results)
		});

		if (DEBUG) {
			log.debug(`[search] Total results: ${totalCount} across ${Object.keys(results).length} collections`);
		}

		return {
			results,
			query: searchTerm,
			count: totalCount
		};
	},

	/**
	 * Get Search History
	 * 
	 * Returns recent searches for the current user.
	 * 
	 * @param {Number} limit - Max results (default: 10)
	 * @returns {Array} Recent searches
	 */
	async 'search.history'(limit = 10) {
		if (!this.userId) {
			throw new Meteor.Error('not-authorized', 'You must be logged in');
		}

		return await GlobalSearch.find(
			{ userId: this.userId },
			{
				limit,
				sort: { timestamp: -1 },
				fields: { query: 1, resultCount: 1, timestamp: 1 }
			}
		).fetchAsync();
	},

	/**
	 * Clear Search History
	 * 
	 * Removes all search history for the current user.
	 */
	async 'search.history.clear'() {
		if (!this.userId) {
			throw new Meteor.Error('not-authorized', 'You must be logged in');
		}

		const removed = await GlobalSearch.removeAsync({ userId: this.userId });
		return { removed };
	}
});

/**
 * Publish Search History
 * 
 * Sends user's recent searches to the client for autocomplete.
 */
Meteor.publish('searchHistory', function(limit = 10) {
	if (!this.userId) return this.ready();

	return GlobalSearch.find(
		{ userId: this.userId },
		{
			limit,
			sort: { timestamp: -1 },
			fields: { query: 1, timestamp: 1, resultCount: 1 }
		}
	);
});

// ============================================================================
// Database Indexes
// ============================================================================

Meteor.startup(async () => {
	if (koad.mongo?.connection === null) {
		log.debug('[search] Skipping index creation (no mongo connection)');
		return;
	}
	try {
		log.debug('[search] Creating database indexes...');

		// Find searches by user
		await GlobalSearch.createIndexAsync({ userId: 1, timestamp: -1 });
		
		// TTL index - auto-delete old searches after 30 days
		// Note: This index can also be used for finding recent searches
		try {
			await GlobalSearch.createIndexAsync(
				{ timestamp: 1 },
				{ expireAfterSeconds: 2592000, name: 'search_history_ttl' }
			);
		} catch (error) {
			if (error.message.includes('equivalent index already exists')) {
				// Drop old timestamp index and recreate with TTL
				log.debug('[search] Dropping old timestamp_1 or timestamp_-1 index and recreating with TTL...');
				await GlobalSearch.dropIndexAsync('timestamp_1').catch(() => {});
				await GlobalSearch.dropIndexAsync('timestamp_-1').catch(() => {});
				await GlobalSearch.createIndexAsync(
					{ timestamp: 1 },
					{ expireAfterSeconds: 2592000, name: 'search_history_ttl' }
				);
			} else {
				throw error;
			}
		}
		
		log.debug('[search] Database indexes created');
	} catch (error) {
		log.error('[search] Error creating indexes:', error.message);
	}
});

log.success('loaded koad-io-core/search');
