# Technical Specification: Read Later

## Overview

Save URLs to a list for later reading, stored locally or synced with passenger.

## Data Structure

```javascript
{
  _id: ObjectId,
  url: String,
  title: String,
  favicon: String,
  addedAt: Date,
  readAt: Date | null,
  passenger: String | null  // null = local storage
}
```

## Storage Options

### Local Storage (Default)
- Key: `readLater`
- Storage: `chrome.storage.local`

### Passenger Storage
- DDP method: `passenger.readLater.add`
- Synced to entity's MongoDB

## DDP Methods

### Add
```javascript
ddp.call('passenger.readLater.add', {
  url: "https://article.com",
  title: "Article Title"
})
```

### Remove
```javascript
ddp.call('passenger.readLater.remove', url)
```

### List
```javascript
ddp.call('passenger.readLater.list')
// Returns: { items: [...] }
```

### Mark Read
```javascript
ddp.call('passenger.readLater.markRead', url)
```

## UI (Popup)

```
┌─────────────────────────────────────────┐
│  Read Later                       [+]   │
├─────────────────────────────────────────┤
│                                         │
│  ┌─────────────────────────────────┐    │
│  │ Article Title                     │    │
│  │ https://article.com             │    │
│  │ [Open] [Delete]                 │    │
│  └─────────────────────────────────┘    │
│                                         │
└─────────────────────────────────────────┘
```

## Implementation Files

- Popup UI: `dist/panes/popup/read-later.js`
- Background: `dist/background/read-later.js`
- Storage: `dist/lib/read-later-storage.js`
