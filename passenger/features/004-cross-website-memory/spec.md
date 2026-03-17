# Technical Specification: Cross-website Memory

## Overview

Persistent storage of browsing activity that entities can query and act upon across sessions and websites.

## Storage Schema

### `pageVisits`
```javascript
{
  _id: ObjectId,
  url: String,
  domain: String,
  title: String,
  favicon: String,
  visitedAt: Date,
  timeOnPage: Number,      // seconds
  scrollDepth: Number,     // percentage
  passenger: String,
  device: String,
  custom: Object           // entity-specific data
}
```

### `domainProfiles`
```javascript
{
  _id: ObjectId,
  domain: String,
  visitCount: Number,
  firstVisit: Date,
  lastVisit: Date,
  totalTime: Number,
  custom: Object
}
```

### `entityMemory`
```javascript
{
  _id: ObjectId,
  key: String,
  value: Object,
  domain: String,          // optional, for context
  createdAt: Date,
  updatedAt: Date,
  passenger: String
}
```

## Capture Events

| Event | Trigger | Data Captured |
|-------|---------|---------------|
| page.visit | URL load | url, title, favicon, timestamp |
| page.exit | Tab closed | timeOnPage, scrollDepth |
| form.submit | Form submission | formData (if enabled) |
| selection | Text selection | selectedText, context |

## Data Retention

Default: 90 days (configurable)

```javascript
{
  "memory": {
    "retentionDays": 90,
    "captureForms": false,
    "captureSelection": true
  }
}
```

## Query API

### From Extension
```javascript
// Get pages visited on domain
ddp.call('memory.query', { domain: 'github.com' })

// Get entity memory
ddp.call('memory.get', { key: 'lastResearchTopic' })
```

## Implementation Files

- Content script: `dist/workers/*/memory-tracker.js`
- Background: `dist/background/memory-sync.js`
