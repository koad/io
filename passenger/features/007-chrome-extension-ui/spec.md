# Technical Specification: Chrome Extension UI

## Overview

Complete Chrome extension interface with popup, options page, and content scripts.

## Extension Structure

```
passenger/
├── manifest.json           # Manifest V3
├── background/
│   └── index.js           # Service worker
├── panes/
│   ├── popup/              # Toolbar popup
│   │   ├── index.html
│   │   ├── styles.css
│   │   └── logic.js
│   └── settings/          # Options page
│       ├── index.html
│       ├── styles.css
│       └── logic.js
├── workers/
│   └── inject/            # Content scripts
└── icons/
    ├── 16.png
    ├── 48.png
    └── 128.png
```

## Manifest V3

```json
{
  "manifest_version": 3,
  "name": "koad:io Dark Passenger",
  "version": "1.0.0",
  "permissions": [
    "activeTab",
    "tabs",
    "storage",
    "notifications",
    "contextMenus"
  ],
  "host_permissions": [
    "<all_urls>"
  ],
  "action": {
    "default_popup": "panes/popup/index.html",
    "default_icon": "icons/48.png"
  },
  "background": {
    "service_worker": "background/index.js"
  }
}
```

## Popup (Toolbar)

- **Size**: 400px × 500px (max)
- **Sections**: Passenger info, skills/buttons, core actions
- **Communication**: chrome.runtime messaging

## Options Page

- **Route**: chrome://extensions/options?id=...
- **Sections**: Passenger settings, global preferences

## Content Scripts

- Injected on matching URLs
- Isolated world (own JS context)
- Communicates via chrome.runtime

## Implementation Files

- Manifest: `dist/manifest.json`
- Background: `dist/background/index.js`
- Popup: `dist/panes/popup/*`
- Settings: `dist/panes/settings/*`
