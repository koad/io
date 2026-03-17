# koad:io-search

Search UI component with local and remote search capabilities for koad:io applications.

## Features

- **Real-time Local Search**: Searches client-side Minimongo collections and localStorage as you type
- **Server Search**: Searches server collections when user presses Enter or clicks search button
- **Combined Results**: Merges local and remote results for comprehensive search
- **Customizable Display**: Override result rendering with custom helpers
- **Debounced Input**: Optimized performance with debounced local search
- **Keyboard Navigation**: Full keyboard support (Enter to search server, Escape to close)

## Installation

```bash
meteor add koad:io-search
```

## Quick Start

### 1. Register Collections for Search

**Server-side** (register collections for remote search):

```javascript
// server/search-config.js
import { Products } from '/imports/api/products';
import { Tasks } from '/imports/api/tasks';

Meteor.startup(() => {
  // Register Products collection
  koad.search.register('products', {
    collection: Products,
    fields: ['name', 'description', 'sku'],
    filter: (userId) => ({ published: true }), // Only search published products
    projection: { name: 1, price: 1, image: 1 },
    sort: { createdAt: -1 },
    limit: 20
  });

  // Register Tasks collection
  koad.search.register('tasks', {
    collection: Tasks,
    fields: ['title', 'description', 'tags'],
    filter: (userId) => ({ 
      $or: [
        { ownerId: userId },
        { shared: true }
      ]
    }), // Only search user's tasks or shared tasks
    projection: { title: 1, status: 1, dueDate: 1 }
  });
});
```

**Client-side** (register collections for local search):

```javascript
// client/search-config.js
import { Products } from '/imports/api/products';
import { Tasks } from '/imports/api/tasks';

Meteor.startup(() => {
  // Register Products for local search
  koad.search.registerLocal('products', Products, ['name', 'description', 'sku'], {
    limit: 10,
    sort: { name: 1 }
  });

  // Register Tasks for local search
  koad.search.registerLocal('tasks', Tasks, ['title', 'description'], {
    filter: { completed: false }, // Only search incomplete tasks
    limit: 15
  });
});
```

### 2. Add Search Box to Your Template

```html
<template name="myLayout">
  <header>
    <nav>
      <!-- Add search box anywhere in your UI -->
      {{> koadSearchBox placeholder="Search products, tasks..."}}
    </nav>
  </header>
</template>
```

### 3. Handle Search Result Clicks (Optional)

```javascript
// client/search-handlers.js
$(document).on('koad:search:select', function(event, data) {
  const { collection, id, item } = data;
  
  // Custom navigation logic
  if (collection === 'products') {
    Router.go('productDetail', { _id: id });
  } else if (collection === 'tasks') {
    Router.go('taskDetail', { _id: id });
  }
});
```

## API Reference

### Server API

#### `koad.search.register(name, config)`

Register a collection for server-side search.

**Parameters:**
- `name` (String): Collection name (used as key in results)
- `config` (Object):
  - `collection` (Mongo.Collection): Collection instance
  - `fields` (Array): Fields to search (e.g., `['title', 'description']`)
  - `filter` (Function, optional): Function that returns MongoDB query (receives `userId`)
  - `projection` (Object, optional): Fields to return (e.g., `{ title: 1, price: 1 }`)
  - `sort` (Object, optional): Sort order (e.g., `{ createdAt: -1 }`)
  - `limit` (Number, optional): Max results (default: 10)

**Example:**
```javascript
koad.search.register('products', {
  collection: Products,
  fields: ['name', 'sku'],
  filter: (userId) => ({ 
    published: true,
    $or: [
      { ownerId: userId },
      { public: true }
    ]
  }),
  projection: { name: 1, price: 1, image: 1 },
  sort: { popularity: -1 },
  limit: 20
});
```

#### `koad.search.unregister(name)`

Unregister a collection from server search.

#### `koad.search.getRegistered()`

Returns array of registered collection names.

### Client API

#### `koad.search.registerLocal(name, collection, fields, options)`

Register a Minimongo collection for local (client-side) search.

**Parameters:**
- `name` (String): Collection name
- `collection` (Mongo.Collection): Collection instance
- `fields` (Array): Fields to search
- `options` (Object, optional):
  - `filter` (Object): MongoDB query filter
  - `projection` (Object): Fields to return
  - `sort` (Object): Sort order
  - `limit` (Number): Max results (default: 10)

#### `koad.search.local(query, options)`

Execute local search (searches Minimongo and localStorage).

**Returns:** `{ results, query, count, source: 'local' }`

#### `koad.search.remote(query, options)`

Execute server search and combine with local results.

**Returns:** Promise resolving to:
```javascript
{
  local: { ... },      // Local results
  remote: { ... },     // Server results
  query: "...",        // Search query
  localCount: 5,       // Local result count
  remoteCount: 10,     // Server result count
  totalCount: 15       // Combined count
}
```

#### `koad.search.clear()`

Clear search query and results.

### Reactive Variables

Access current search state:

```javascript
koad.search.query.get()         // Current query string
koad.search.localResults.get()  // Local search results
koad.search.remoteResults.get() // Server search results
koad.search.loading.get()       // Boolean: server search in progress
koad.search.error.get()         // Error message (if any)
```

## Customization

### Custom Result Display

Override how results are displayed by defining custom helpers:

```javascript
// Custom title formatter
Template.koadSearchResultItem_title = function(item, collection) {
  if (collection === 'products') {
    return `${item.name} - $${item.price}`;
  }
  if (collection === 'tasks') {
    return `[${item.status}] ${item.title}`;
  }
  return item.name || item.title || 'Untitled';
};

// Custom meta formatter
Template.koadSearchResultItem_meta = function(item, collection) {
  if (collection === 'products') {
    return `SKU: ${item.sku} | Stock: ${item.stock}`;
  }
  if (collection === 'tasks') {
    return `Due: ${moment(item.dueDate).fromNow()}`;
  }
  return '';
};
```

### Custom Styling

Override CSS classes:

```css
/* Change search box appearance */
.koad-search-box__input {
  border-radius: 8px;
  border-color: #your-color;
}

/* Change result item hover color */
.koad-search-result-item:hover {
  background-color: #your-hover-color;
}
```

## Events

### `koad:search:select`

Triggered when user clicks a search result.

```javascript
$(document).on('koad:search:select', function(event, data) {
  console.log('Selected:', data);
  // data = { collection: 'products', id: 'abc123', item: {...} }
});
```

## How It Works

1. **As User Types**: 
   - Local search executes immediately (debounced 300ms)
   - Searches all registered Minimongo collections
   - Searches localStorage keys/values
   - Results appear instantly

2. **On Enter Key**:
   - Calls server search method
   - Server searches registered collections
   - Returns combined local + remote results

3. **Result Grouping**:
   - Results grouped by collection name
   - Shows count per collection
   - Customizable display per collection type

## Best Practices

1. **Don't Register Everything**: Only register collections that make sense to search
2. **Use Filters**: Apply appropriate security filters (especially on server)
3. **Limit Results**: Keep result counts reasonable (10-20 per collection)
4. **Index Fields**: Add MongoDB indexes on searchable fields for performance
5. **Subscribe Data**: Ensure client has subscribed to data you want to search locally

## Example: Full Setup

```javascript
// imports/api/products/collection.js
export const Products = new Mongo.Collection('products');

// server/search.js
import { Products } from '/imports/api/products/collection';

Meteor.startup(() => {
  koad.search.register('products', {
    collection: Products,
    fields: ['name', 'description', 'sku', 'brand'],
    filter: (userId) => ({ 
      published: true,
      deleted: { $ne: true }
    }),
    projection: { 
      name: 1, 
      price: 1, 
      image: 1, 
      brand: 1 
    },
    sort: { popularity: -1 },
    limit: 15
  });
});

// client/search.js
import { Products } from '/imports/api/products/collection';

Meteor.startup(() => {
  koad.search.registerLocal('products', Products, 
    ['name', 'description', 'sku'], 
    {
      limit: 10,
      sort: { name: 1 }
    }
  );
});

// client/templates/layout.html
<template name="layout">
  <nav>
    {{> koadSearchBox placeholder="Search products..."}}
  </nav>
</template>

// client/templates/layout.js
$(document).on('koad:search:select', (event, data) => {
  if (data.collection === 'products') {
    Router.go('productPage', { _id: data.id });
  }
});
```

## License

MIT
