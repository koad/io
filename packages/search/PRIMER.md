# PRIMER: koad:io-search

**Meteor package name:** `koad:io-search`  
**Version:** 3.6.9  
**State:** Built, active — UI-only package (no server-side exports)

---

## What It Does

A search UI component for koad:io apps. Provides a Blaze template (`{{> koadSearchBox}}`) with real-time local search (Minimongo + localStorage) and on-demand remote/server search.

Architecture:
- **Local search** — searches client-side Minimongo collections as-you-type (debounced 300ms)
- **Server search** — triggered on Enter or clicking search button, calls a Meteor method
- **Combined results** — merges both, grouped by collection name
- **Keyboard support** — Enter searches server, Escape closes results

## Dependencies

**Meteor:** `ecmascript`, `templating@1.4.4` (client), `reactive-var` (client), `reactive-dict` (client), `tracker` (client), `underscore` (client), `koad:io-core` (client)

**No server-side dependencies.** This is a client-only package.

## Usage

### Register collections

```javascript
// Server — for remote search
koad.search.register('products', {
  collection: Products,
  fields: ['name', 'description', 'sku'],
  filter: (userId) => ({ published: true }),
  projection: { name: 1, price: 1 },
  sort: { createdAt: -1 },
  limit: 20
});

// Client — for local (Minimongo) search
koad.search.registerLocal('products', Products, ['name', 'description'], {
  filter: { active: true },
  limit: 10
});
```

### Add to template

```html
{{> koadSearchBox placeholder="Search..."}}
```

### Handle result selection

```javascript
$(document).on('koad:search:select', function(event, data) {
  // data = { collection: 'products', id: 'abc123', item: {...} }
  Router.go('productPage', { _id: data.id });
});
```

## Client API

```javascript
koad.search.local(query, options)      // search Minimongo + localStorage
koad.search.remote(query, options)     // call server, returns Promise
koad.search.clear()                    // reset query and results

// Reactive state
koad.search.query.get()
koad.search.localResults.get()
koad.search.remoteResults.get()
koad.search.loading.get()
koad.search.error.get()
```

## Server API

```javascript
koad.search.register(name, config)     // register collection for server search
koad.search.unregister(name)           // remove registration
koad.search.getRegistered()            // list registered collection names
```

## Customization

Override result display by defining helpers:
```javascript
Template.koadSearchResultItem_title = function(item, collection) { ... };
Template.koadSearchResultItem_meta  = function(item, collection) { ... };
```

Override CSS:
```css
.koad-search-box__input { /* search input */ }
.koad-search-result-item:hover { /* hover state */ }
```

## File Map

```
client/
  templates/
    search-box.html/.css/.js      ← input component
    search-results.html/.css/.js  ← results dropdown
```

## Known Issues / Notes

- **This package exports nothing** — it provides templates and extends `koad` via side effects
- Server-side method registration (for remote search) must be set up in the consuming app's server code
- No standalone template for result items — overriding display requires following the naming convention `koadSearchResultItem_title`
- localStorage search is included in local results alongside Minimongo — useful for recently viewed items stored in session
