# Technical Specification: Augment Management

## Overview

UI for managing (enabling/disabling) scripts and styles that passengers inject into pages.

## Augment Types

### Script Augments
```javascript
{
  id: "github:dark-theme",
  name: "Dark Theme",
  type: "script",
  code: "document.body.style.background = '#0d0d0d';",
  runAt: "document_end"    // document_start | document_end | document_idle
}
```

### Style Augments
```javascript
{
  id: "github:dark-theme",
  name: "Dark Theme",
  type: "style",
  code: "body { background: #0d0d0d; color: #fff; }"
}
```

## Augment List UI

```
┌─────────────────────────────────────────┐
│  Augments Available:                    │
│                                         │
│  🎨 Dark Theme           [○]           │
│     [∞ Enable Forever]                  │
│                                         │
│  📊 GitHub Stats           [●]         │
│     [∞ Enable Forever]                  │
│                                         │
└─────────────────────────────────────────┘
```

## Toggle States

| State | Meaning |
|-------|---------|
| ○ Off | Not running |
| ● On | Running this session |
| ● + ∞ | Running permanently |

## Storage Schema

```javascript
{
  "augments": {
    "alice": {
      "github:dark-theme": {
        "enabled": true,
        "permanent": true,
        "addedAt": "2024-01-15T10:30:00Z"
      },
      "github:stats": {
        "enabled": true,
        "permanent": false
      }
    }
  }
}
```

## Loading Flow

1. Page loads
2. Extension queries active passenger for augments
3. Check storage for saved preferences
4. Merge with default state
5. Inject enabled augments
6. Update UI with current state

## Implementation Files

- Popup logic: `dist/panes/popup/augments.js`
- Content script: `dist/workers/inject/augment-loader.js`
- Storage: `dist/lib/augment-storage.js`
