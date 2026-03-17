# Technical Specification: Local-first Data

## Overview

All data stays within the user's local infrastructure - no cloud services, no third-party data leaks.

## Architecture

```
┌─────────────────┐     DDP      ┌─────────────────┐
│  Chrome Ext     │◄────────────►│   Daemon        │
│                 │              │                 │
│  Local Cache    │              │  MongoDB        │
│  (minimongo)    │              │  (entity)       │
└─────────────────┘              └─────────────────┘
```

## Data Flow

### Writing Data
1. Extension calls DDP method
2. Daemon stores in entity's MongoDB
3. Confirmation returned

### Reading Data
1. Extension subscribes to collection
2. Daemon publishes changes
3. Extension updates local cache

## Collections

### `browsingHistory`
```javascript
{
  _id: ObjectId,
  url: String,
  domain: String,
  title: String,
  visitedAt: Date,
  passenger: String,
  device: String
}
```

### `capturedData`
```javascript
{
  _id: ObjectId,
  type: "screenshot" | "form" | "selection",
  data: Object,
  url: String,
  capturedAt: Date,
  passenger: String
}
```

### `automationLogs`
```javascript
{
  _id: ObjectId,
  event: String,
  domain: String,
  details: Object,
  triggeredAt: Date,
  passenger: String
}
```

## Offline Support

- DDP handles offline gracefully
- When reconnected, syncs automatically
- No data loss during disconnection

## Security

- All data stays on localhost by default
- No external API calls except to visited websites
- Entity MongoDB on local machine only

## Settings

```javascript
{
  "data": {
    "storage": "local",     // "local" or "passenger"
    "passenger": "alice",  // which entity's DB
    "syncEnabled": true
  }
}
```

## Implementation Files

- Background data handler: `dist/background/data-sync.js`
- Storage utilities: `dist/lib/storage.js`
