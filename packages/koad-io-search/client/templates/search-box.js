/**
 * koadSearchBox Template
 * 
 * Main search input component with real-time local search.
 * 
 * Usage:
 *   {{> koadSearchBox placeholder="Search..."}}
 * 
 * Features:
 * - Real-time local search (as you type)
 * - Server search on Enter key
 * - Shows local results instantly
 * - Loading states
 * - Clear button
 */

Template.koadSearchBox.onCreated(function() {
	this.focused = new ReactiveVar(false);
	this.showResults = new ReactiveVar(false);
	this.showHint = new ReactiveVar(false);
});

Template.koadSearchBox.helpers({
	query() {
		return koad.search.query.get();
	},

	loading() {
		return koad.search.loading.get();
	},

	focused() {
		return Template.instance().focused.get();
	},

	showResults() {
		const instance = Template.instance();
		return instance.showResults.get() && koad.search.query.get().length >= 2;
	},

	showHint() {
		const instance = Template.instance();
		const query = koad.search.query.get();
		return instance.showHint.get() && query.length >= 2 && !koad.search.loading.get();
	},

	localResults() {
		const results = koad.search.localResults.get();
		return results;
	},

	placeholder() {
		return Template.currentData().placeholder || 'Search...';
	}
});

Template.koadSearchBox.events({
	'input .koad-search-box__input'(event, instance) {
		const query = event.target.value;
		koad.search.query.set(query);

		if (query.length >= 2) {
			// Show results panel
			instance.showResults.set(true);
			instance.showHint.set(true);

			// Execute local search with debounce
			koad.search.debouncedLocal(query);
		} else {
			instance.showResults.set(false);
			instance.showHint.set(false);
			koad.search.clear();
		}
	},

	'focus .koad-search-box__input'(event, instance) {
		instance.focused.set(true);
		const query = koad.search.query.get();
		if (query.length >= 2) {
			instance.showResults.set(true);
			instance.showHint.set(true);
		}
	},

	'blur .koad-search-box__input'(event, instance) {
		// Delay to allow click events on results
		setTimeout(() => {
			instance.focused.set(false);
			instance.showResults.set(false);
			instance.showHint.set(false);
		}, 200);
	},

	'keydown .koad-search-box__input'(event, instance) {
		if (event.key === 'Enter') {
			event.preventDefault();
			const query = koad.search.query.get();

			if (query.length >= 2) {
				instance.showHint.set(false);
				koad.search.remote(query).then(results => {
					if (DEBUG) {
						console.log('[search] Combined results:', results);
					}
					// Optionally navigate to results page or show modal
					// Router.go('searchResults', {}, { query: { q: query } });
				}).catch(error => {
					console.error('[search] Server search failed:', error);
				});
			}
		}

		if (event.key === 'Escape') {
			event.target.blur();
			instance.showResults.set(false);
			instance.showHint.set(false);
		}
	},

	'click .koad-search-box__clear'(event, instance) {
		event.preventDefault();
		koad.search.clear();
		instance.showResults.set(false);
		instance.showHint.set(false);
		instance.template.$('.koad-search-box__input').focus();
	}
});
