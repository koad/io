# Technical Specification: Activity Log & Cross-Device Sync

## Overview

Track browsing activity and sync tabs across devices via passenger connection.

## Event Types

| Event | Description |
|-------|-------------|
| page.visit | URL visited |
| tab.opened | New tab opened |
| tab.closed | Tab closed |
| tab.moved | Tab moved to device |
| augment.loaded | Augment injected |
| skill.used | Skill triggered |
| screenshot.captured | Screenshot taken |

## Log Entry Schema

```javascript
{
  _id: ObjectId,
  event: String,
  data: {
    url: String,
    domain: String,
    title: String
  },
  passenger: String,
  device: String,
  browser: String,
  timestamp: Date
}
```

## Cross-Device Tab Sync

### Report Tabs
```javascript
ddp.call('passenger.tabs.report', {
  tabs: [
    { url: "https://github.com", title: "GitHub", active: true },
    { url: "https://reddit.com", title: "Reddit", active: false }
  ],
  browser: "Chrome",
  device: "work-laptop"
})
```

### List All Device Tabs
```javascript
ddp.call('passenger.tabs.list')
// Returns: { devices: [...] }
```

### Response
```javascript
{
  devices: [
    {
      name: "Work Laptop",
      browser: "Chrome",
      tabs: [
        { url: "...", title: "...", active: true }
      ]
    }
  ]
}
```

## UI - Activity Panel

```
┌─────────────────────────────────────────┐
│  Activity Log                      [Clear]│
├─────────────────────────────────────────┤
│  [Today]                                │
│  [10:30] 🔷 GitHub                     │
│  [10:28] 🎨 Dark Theme loaded          │
│  ───────────────────────────────────    │
│  [Open Tabs - All Devices]        [▶]   │
│  💻 Work Laptop                         │
│    └─ GitHub (active)                   │
│    └─ Reddit                            │
└─────────────────────────────────────────┘
```

## Storage

```javascript
{
  "activityLog": {
    "maxEntries": 1000,
    "storage": "local"   // or "passenger"
  }
}
```

## Implementation Files

- Background tracker: `dist/background/activity-tracker.js`
- Popup UI: `dist/panes/popup/activity-log.js`
- Cross-device: `dist/background/tab-sync.js`
