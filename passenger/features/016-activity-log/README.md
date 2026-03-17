# Feature: Activity Log & Cross-Device Sync

## Summary

Tracks browsing activity across all devices/browsers. Shows open tabs from other devices for easy tab sharing.

## Problem

- Users want to see their browsing history across multiple devices
- Need to move tabs between devices easily
- No unified view of all browser activity

## Solution

When a passenger with DDP is active, tab activity syncs across devices. Users can view all open tabs from any device.

## Cross-Device Tab Sync

### DDP Methods

**Report Open Tabs**:
```
passenger.tabs.report({
  tabs: [
    { url: "https://github.com", title: "GitHub" },
    { url: "https://reddit.com", title: "Reddit" }
  ],
  browser: "Chrome",
  device: "work-laptop"
})
```

**Get All Device Tabs**:
```
passenger.tabs.list()
```

**Response**:
```json
{
  "devices": [
    {
      "name": "Work Laptop",
      "browser": "Chrome",
      "tabs": [
        { "url": "https://github.com", "title": "GitHub", "active": true },
        { "url": "https://reddit.com", "title": "Reddit", "active": false }
      ]
    },
    {
      "name": "Home Desktop",
      "browser": "Brave",
      "tabs": [
        { "url": "https://youtube.com", "title": "YouTube", "active": true }
      ]
    }
  ]
}
```

## Activity Log Entry Schema

```json
{
  "id": "abc123",
  "timestamp": "2024-01-15T10:30:00Z",
  "event": "page.visit",
  "data": {
    "url": "https://github.com/koad/io",
    "domain": "github.com",
    "title": "koad/io"
  },
  "passenger": "alice",
  "device": "work-laptop",
  "browser": "Chrome"
}
```

### New Event Types

| Event | Description |
|-------|-------------|
| `page.visit` | URL visited |
| `tab.opened` | New tab opened |
| `tab.closed` | Tab closed |
| `tab.moved` | Tab moved to another device |
| `augment.loaded` | Augment injected |
| `skill.used` | Skill triggered |

## Storage

**Local** (default): `chrome.storage.local` key: `activityLog`

**Passenger**: Via DDP method `passenger.activity.log()`

## UI - Activity Panel

```
┌─────────────────────────────────────────┐
│  Activity Log                    [Clear]│
├─────────────────────────────────────────┤
│                                         │
│  [Today]                                │
│  [10:30] 🔷 Work Laptop - GitHub        │
│  [10:28] 🎨 Loaded Dark Theme           │
│  [10:25] 📋 Copied tab URL              │
│                                         │
│  ───────────────────────────────────    │
│                                         │
│  [Open Tabs - All Devices]        [▶]   │
│                                         │
│  💻 Work Laptop (Chrome)                 │
│    └─ GitHub (active)                   │
│    └─ Reddit                            │
│                                         │
│  💻 Home Desktop (Brave)                 │
│    └─ YouTube (active)                  │
│                                         │
└─────────────────────────────────────────┘
```

### Device Tab Actions

- **Open** - Open tab in current browser
- **Move** - Move tab to current device (close from other)
- **Sync** - Update tab list

## Settings

```json
{
  "activityLog": {
    "enabled": true,
    "maxEntries": 1000,
    "storage": "local",  // or "passenger"
    "passenger": "alice",
    "syncTabs": true,
    "syncDevices": true
  }
}
```

## Status

- [ ] Define log event schema
- [ ] Implement event tracking
- [ ] Store in chrome.storage.local
- [ ] Optional passenger sync
- [ ] Activity panel UI
- [ ] Cross-device tab reporting
- [ ] Cross-device tab listing UI
- [ ] Move tabs between devices
- [ ] Clear/export options

## Related Features

- Feature: 008-passenger-skill-registry.md
- Feature: 013-augment-management.md
