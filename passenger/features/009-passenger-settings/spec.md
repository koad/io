# Technical Specification: Passenger Settings

## Overview

Settings UI for managing passengers, their permissions, and skill execution rules.

## Storage Schema

```javascript
{
  "passengers": {
    "alice": {
      "enabled": true,
      "sites": {
        "github.com": true,
        "*": false  // disabled on all other sites
      },
      "skills": {
        "inject.script": true,
        "open.pwa": true
      },
      "sidebar": {
        "enabled": true,
        "priority": 10
      }
    },
    "maya": {
      "enabled": false,
      "sites": {},
      "skills": {},
      "sidebar": {
        "enabled": true,
        "priority": 5
      }
    }
  },
  "global": {
    "autoEnableNewPassengers": true,
    "showNotifications": true
  }
}
```

## URL Matching

Uses Chrome's `matchPatterns` for site permissions:

```json
{
  "sites": {
    "https://github.com/*": true,
    "https://*.youtube.com/*": true
  }
}
```

## UI Components

### Passenger List View
- Avatar + name display
- Toggle switch for global enable/disable
- Expand to show site-specific settings

### Per-Passenger Settings
- List of skills with individual toggles
- Site URL patterns with toggles
- "Run on all sites" option
- Sidebar settings (enable, priority)

### Sidebar Conflict Resolution
- When multiple passengers have sidebars for same URL
- Show conflict UI in settings
- Users can set priority or manually select
- Option to show all in tabs

### Global Settings
- Auto-enable new passengers toggle
- Notification preferences
- Import/export settings

## UI Layout

```
┌─────────────────────────────────────────┐
│  🛡 Passenger Settings                   │
├─────────────────────────────────────────┤
│                                          │
│  ┌─────────────────────────────────┐    │
│  │ 🎭 Alice                    [○] │    │
│  │    alice@koad.io                │    │
│  │                                 │    │
│  │    Sites:                       │    │
│  │    ☑ github.com                │    │
│  │    ☑ * (all other sites)      │    │
│  │                                 │    │
│  │    Skills:                      │    │
│  │    ☑ inject.script            │    │
│  │    ☑ open.pwa                 │    │
│  └─────────────────────────────────┘    │
│                                          │
│  ┌─────────────────────────────────┐    │
│  │ 🎭 Maya                      [●] │    │
│  │    ...                          │    │
│  └─────────────────────────────────┘    │
│                                          │
│  ───────────────────────────────────    │
│                                          │
│  Global Settings                         │
│  [○] Auto-enable new passengers        │
│  [●] Show notifications                │
│                                          │
└─────────────────────────────────────────┘
```

## Storage Keys

- `chrome.storage.sync` - Primary storage
- `chrome.storage.local` - Fallback for large data

## Implementation Files

- Settings UI: `dist/panes/settings/index.html`
- Settings CSS: `dist/panes/settings/styles.css`
- Settings Logic: `dist/panes/settings/logic.js`
- Background: `dist/background/settings.js`

## Import/Export

```javascript
// Export
const settings = await chrome.storage.sync.get();
const blob = new Blob([JSON.stringify(settings, null, 2)], {type: 'application/json'});
chrome.downloads.download({ url: URL.createObjectURL(blob), filename: 'passenger-settings.json' });

// Import
const text = await file.text();
const settings = JSON.parse(text);
await chrome.storage.sync.set(settings);
```
