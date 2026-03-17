# Feature: Read Later

## Summary

Save URLs to a "read later" list managed by the active passenger.

## Problem

Users want to save URLs for later without using third-party services.

## Solution

Passengers with DDP can maintain a read later list. Without a passenger, uses local storage.

## Implementation

### Storage Options

**Local Storage** (default):
- Saved to `chrome.storage.local`
- Key: `readLater`

**Passenger Storage**:
- Via DDP method `passenger.readLater.add`
- Synced to entity's database

### DDP Methods

**Add URL**:
```
passenger.readLater.add({
  url: "https://article.com",
  title: "Article Title",
  added: "2024-01-15T10:30:00Z"
})
```

**Remove URL**:
```
passenger.readLater.remove(url)
```

**Get List**:
```
passenger.readLater.list()
```

**Response**:
```json
{
  "items": [
    {
      "url": "https://article.com",
      "title": "Article Title",
      "added": "2024-01-15T10:30:00Z"
    }
  ]
}
```

### Popup UI

```
┌─────────────────────────────────────────┐
│  Read Later                      [+]   │
├─────────────────────────────────────────┤
│                                         │
│  ┌─────────────────────────────────┐   │
│  │ Article Title                     │   │
│  │ https://article.com             │   │
│  │ [Open] [Delete]                 │   │
│  └─────────────────────────────────┘   │
│                                         │
│  ┌─────────────────────────────────┐   │
│  │ Another Article                   │   │
│  │ https://another.com              │   │
│  │ [Open] [Delete]                 │   │
│  └─────────────────────────────────┘   │
│                                         │
└─────────────────────────────────────────┘
```

## Status

- [ ] Implement local storage read later
- [ ] Implement DDP methods
- [ ] Add popup UI
- [ ] Add "read later" button to popup

## Related Features

- Feature: 008-passenger-skill-registry.md
