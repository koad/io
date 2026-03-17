/**
 * Client-Side Search
 * 
 * Provides local and remote search functionality.
 * 
 * Features:
 * - Local collection search (instant, reactive)
 * - localStorage search (instant)
 * - Remote server search (on demand)
 * - Debounced local search
 * - Combined result sets
 * 
 * Usage:
 *   // Register local collections for search
 *   koad.search.registerLocal('tasks', Tasks, ['title', 'description']);
 *   
 *   // Search locally (instant)
 *   const localResults = koad.search.local('my query');
 *   
 *   // Search server (on Enter/click)
 *   const allResults = await koad.search.remote('my query');
 */

/**
 * SearchHistory Collection (Client)
 * 
 * Client-side cache of search history for autocomplete.
 */
SearchHistory = new Mongo.Collection('global_search');

/**
 * Local Collection Registry
 * 
 * Stores client-side collection search configurations.
 */
const localSearchRegistry = new Map();

/**
 * Search State
 * 
 * Reactive state for search UI components.
 */
koad.search = {
	// Reactive variables
	query: new ReactiveVar(''),
	localResults: new ReactiveVar({}),
	remoteResults: new ReactiveVar({}),
	loading: new ReactiveVar(false),
	error: new ReactiveVar(null),

	/**
	 * Register Local Collection
	 * 
	 * Register a Minimongo collection for local search.
	 * 
	 * @param {String} name - Collection name
	 * @param {Mongo.Collection} collection - Collection instance
	 * @param {Array} fields - Fields to search
	 * @param {Object} options - Optional config
	 */
	registerLocal(name, collection, fields, options = {}) {
		if (!name || typeof name !== 'string') {
			throw new Error('[search.registerLocal] Collection name must be a non-empty string');
		}

		if (!collection || !collection.find) {
			throw new Error(`[search.registerLocal] Collection "${name}" requires a Mongo.Collection instance`);
		}

		if (!fields || !Array.isArray(fields) || fields.length === 0) {
			throw new Error(`[search.registerLocal] Collection "${name}" requires fields array`);
		}

		localSearchRegistry.set(name, {
			collection,
			fields,
			filter: options.filter || null,
			projection: options.projection || null,
			sort: options.sort || null,
			limit: options.limit || 10
		});

		if (DEBUG) {
			console.log(`[search] Registered local collection "${name}" with fields:`, fields);
		}
	},

	/**
	 * Unregister Local Collection
	 */
	unregisterLocal(name) {
		localSearchRegistry.delete(name);
		if (DEBUG) {
			console.log(`[search] Unregistered local collection "${name}"`);
		}
	},

	/**
	 * Get Registered Collections
	 */
	getRegistered() {
		return Array.from(localSearchRegistry.keys());
	},

	/**
	 * Search Local Collections
	 * 
	 * Searches all registered local Minimongo collections.
	 * Returns results instantly from client-side cache.
	 * 
	 * @param {String} query - Search query
	 * @param {Object} options - Search options
	 * @returns {Object} Results grouped by collection
	 */
	local(query, options = {}) {
		if (!query || query.trim().length < 2) {
			this.localResults.set({});
			return {};
		}

		const searchTerm = query.trim();
		const regex = new RegExp(searchTerm, 'i');
		const results = {};
		let totalCount = 0;

		// Search registered collections
		for (const [name, config] of localSearchRegistry.entries()) {
			try {
				const orConditions = config.fields.map(field => ({
					[field]: regex
				}));

				let baseQuery = { $or: orConditions };

				// Apply custom filter if provided
				if (config.filter) {
					baseQuery = { $and: [baseQuery, config.filter] };
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

				// Execute local search
				const docs = config.collection.find(baseQuery, findOptions).fetch();

				if (docs.length > 0) {
					results[name] = docs;
					totalCount += docs.length;
				}
			} catch (error) {
				console.error(`[search] Error searching local collection "${name}":`, error);
			}
		}

		// Search localStorage
		const localStorageResults = this.searchLocalStorage(searchTerm);
		if (localStorageResults.length > 0) {
			results.localStorage = localStorageResults;
			totalCount += localStorageResults.length;
		}

		this.localResults.set(results);

		if (DEBUG) {
			console.log(`[search] Local search found ${totalCount} results`);
		}

		return {
			results,
			query: searchTerm,
			count: totalCount,
			source: 'local'
		};
	},

	/**
	 * Search localStorage
	 * 
	 * Searches all localStorage keys and values for matches.
	 * 
	 * @param {String} query - Search query
	 * @returns {Array} Matching localStorage items
	 */
	searchLocalStorage(query) {
		const results = [];
		const regex = new RegExp(query, 'i');

		try {
			for (let i = 0; i < localStorage.length; i++) {
				const key = localStorage.key(i);
				const value = localStorage.getItem(key);

				// Skip certain keys (like large binary data)
				if (key.startsWith('_') || key.length > 100) continue;

				// Check if key or value matches
				const keyMatches = regex.test(key);
				const valueMatches = regex.test(value);

				if (keyMatches || valueMatches) {
					results.push({
						key,
						value: value.length > 100 ? value.substring(0, 100) + '...' : value,
						matchedOn: keyMatches ? 'key' : 'value'
					});
				}

				// Limit localStorage results
				if (results.length >= 10) break;
			}
		} catch (error) {
			console.error('[search] Error searching localStorage:', error);
		}

		return results;
	},

	/**
	 * Debounced Local Search
	 * 
	 * Waits 300ms after typing stops before searching locally.
	 * 
	 * @param {String} query - Search query
	 * @param {Object} options - Search options
	 */
	debouncedLocal: _.debounce(function(query, options) {
		koad.search.local(query, options);
	}, 300),

	/**
	 * Remote Server Search
	 * 
	 * Calls the server search method and combines with local results.
	 * 
	 * @param {String} query - Search query
	 * @param {Object} options - Search options
	 * @returns {Promise} Combined search results
	 */
	remote(query, options = {}) {
		if (!query || query.trim().length < 2) {
			this.error.set('Query must be at least 2 characters');
			return Promise.resolve(null);
		}

		this.query.set(query);
		this.loading.set(true);
		this.error.set(null);

		// Get local results first
		const localResults = this.local(query, options);

		// Then fetch from server
		return new Promise((resolve, reject) => {
			Meteor.call('search', query, options, (error, serverResults) => {
				this.loading.set(false);

				if (error) {
					this.error.set(error.reason || error.message);
					reject(error);
				} else {
					this.remoteResults.set(serverResults.results || {});

					// Combine local and remote results
					const combined = {
						local: localResults.results || {},
						remote: serverResults.results || {},
						query: query,
						localCount: localResults.count || 0,
						remoteCount: serverResults.count || 0,
						totalCount: (localResults.count || 0) + (serverResults.count || 0)
					};

					resolve(combined);
				}
			});
		});
	},

	/**
	 * Clear Results
	 */
	clear() {
		this.query.set('');
		this.localResults.set({});
		this.remoteResults.set({});
		this.error.set(null);
		this.loading.set(false);
	},

	/**
	 * Get Search History
	 * 
	 * @returns {Promise} Recent searches
	 */
	getHistory() {
		return new Promise((resolve, reject) => {
			Meteor.call('search.history', (error, history) => {
				if (error) {
					reject(error);
				} else {
					resolve(history);
				}
			});
		});
	},

	/**
	 * Clear Search History
	 * 
	 * @returns {Promise} Removal count
	 */
	clearHistory() {
		return new Promise((resolve, reject) => {
			Meteor.call('search.history.clear', (error, result) => {
				if (error) {
					reject(error);
				} else {
					resolve(result);
				}
			});
		});
	}
};

if (DEBUG) {
	console.log('[search] Client search system initialized');
}
