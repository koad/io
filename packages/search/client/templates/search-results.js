/**
 * koadSearchResults Template
 * 
 * Displays search results grouped by collection.
 * 
 * Features:
 * - Grouped by collection type
 * - Custom display formatters
 * - Click handlers for navigation
 * - Empty states
 */

Template.koadSearchResults.helpers({
	hasResults() {
		const results = Template.currentData().results;
		return results && Object.keys(results).length > 0;
	},

	isLocal() {
		return Template.currentData().source === 'local';
	},

	collections() {
		const results = Template.currentData().results || {};
		return Object.keys(results).map(collectionName => ({
			collectionName,
			items: results[collectionName],
			count: results[collectionName].length
		}));
	}
});

Template.koadSearchResults.events({
	'click .koad-search-result-item'(event, instance) {
		const $item = $(event.currentTarget);
		const collection = $item.data('collection');
		const id = $item.data('id');

		if (DEBUG) {
			console.log('[search] Clicked result:', { collection, id, item: this.item });
		}

		// Trigger custom event that apps can listen to
		$(document).trigger('koad:search:select', {
			collection,
			id,
			item: this.item
		});

		// Default navigation behavior (can be overridden by listening to event above)
		if (collection === 'localStorage') {
			// For localStorage, maybe open a modal or copy to clipboard
			if (DEBUG) {
				console.log('[search] localStorage item:', this.item.key, '=', this.item.value);
			}
		} else {
			// For collection items, try to navigate to detail page
			// Apps should override this by listening to 'koad:search:select' event
			const routeName = `${collection}Detail`;
			if (Router && Router.routes[routeName]) {
				Router.go(routeName, { _id: id });
			}
		}
	}
});

Template.koadSearchResultItem.helpers({
	isLocalStorage() {
		return this.collection === 'localStorage';
	},

	getDisplayTitle(item, collection) {
		// Apps can override this by defining Template.koadSearchResultItem_title helper
		if (Template.koadSearchResultItem_title) {
			return Template.koadSearchResultItem_title(item, collection);
		}

		// Default title logic
		if (item.title) return item.title;
		if (item.name) return item.name;
		if (item.username) return item.username;
		if (item._id) return `${collection} #${item._id}`;
		return 'Untitled';
	},

	getDisplayMeta(item, collection) {
		// Apps can override this by defining Template.koadSearchResultItem_meta helper
		if (Template.koadSearchResultItem_meta) {
			return Template.koadSearchResultItem_meta(item, collection);
		}

		// Default meta logic
		if (item.description) return item.description;
		if (item.email) return item.email;
		if (item.created) return new Date(item.created).toLocaleDateString();
		if (item.createdAt) return new Date(item.createdAt).toLocaleDateString();
		return collection;
	}
});
