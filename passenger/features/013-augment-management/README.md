# Feature: Augment Management

## Summary

UI in the popup to enable/disable augments temporarily or permanently for future visits.

## Problem

When a passenger provides augments (scripts/styles) for the current site, users need a way to:
- Enable/disable augments for the current session
- Save preferences so augments persist on refresh and future visits

## Solution

Popup shows available augments with toggle switches and "enable forever" options.

## UI Implementation

### Augment List in Popup

```
┌─────────────────────────────────────────┐
│  koad:io                                │
│  Alice                                   │
│                                         │
│  ───────────────────────────────────    │
│                                         │
│  Augments Available:                    │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │ 🎨 Dark Theme           [○]    │    │
│  │    [∞ Enable Forever]          │    │
│  └─────────────────────────────────┘    │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │ 📊 GitHub Stats         [●]    │    │
│  │    [∞ Enable Forever]          │    │
│  └─────────────────────────────────┘    │
│                                         │
│  ───────────────────────────────────    │
│                                         │
│  [copy tab] [discard tabs] [copy tabs]  │
│  [configure koad:io]                    │
└─────────────────────────────────────────┘
```

### Toggle States

- **Off** - Augment not running
- **On** - Augment running for this session only
- **On + Forever** - Augment running and saved to storage

### Storage Schema

```json
{
  "augments": {
    "alice": {
      "github:dark-theme": {
        "enabled": true,
        "permanent": true,
        "added": "2024-01-15T10:30:00Z"
      },
      "github:stats": {
        "enabled": true,
        "permanent": false
      }
    }
  }
}
```

### Permanent Augments

When "Enable Forever" is clicked:
1. Augment is saved to `chrome.storage.sync`
2. On page load, permanent augments are automatically injected
3. User can disable in settings or by toggling off

### Flow

1. User visits a page
2. Extension queries active passenger for augments
3. Popup shows available augments with current state
4. User can toggle on/off
5. User can click "Enable Forever" to persist
6. On refresh, permanent augments auto-enable

## Augment Definition (from passenger)

```json
{
  "augments": [
    {
      "id": "github:dark-theme",
      "name": "Dark Theme",
      "type": "style",
      "code": ".body { background: #0d0d0d; }",
      "permanent": false
    }
  ]
}
```

## Status

- [ ] Design augment list UI in popup
- [ ] Implement toggle on/off
- [ ] Implement "enable forever"
- [ ] Save to chrome.storage.sync
- [ ] Auto-load permanent augments on page visit

## Related Features

- Feature: 008-passenger-skill-registry.md
- Feature: 010-core-passenger-features.md
