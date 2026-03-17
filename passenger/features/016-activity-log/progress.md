# Progress: Activity Log & Cross-Device Sync

## Status: 🔲 Not Started

## To Do

- [ ] Define log event schema
- [ ] Implement event tracking
- [ ] Store in chrome.storage.local
- [ ] Optional passenger sync
- [ ] Activity panel UI
- [ ] Cross-device tab reporting
- [ ] Cross-device tab listing UI
- [ ] Move tabs between devices
- [ ] Clear/export options

## Event Types

| Event | Description |
|-------|-------------|
| page.visit | URL visited |
| tab.opened | New tab opened |
| tab.closed | Tab closed |
| tab.moved | Tab moved to another device |
| augment.loaded | Augment injected |
| skill.used | Skill triggered |

## DDP Methods

- `passenger.tabs.report({tabs, browser, device})`
- `passenger.tabs.list()`
- `passenger.activity.log(event)`

## Settings

```json
{
  "activityLog": {
    "enabled": true,
    "maxEntries": 1000,
    "storage": "local",
    "syncTabs": true
  }
}
```

## Dependencies

- Feature: 008-passenger-skill-registry (for DDP methods)
- Feature: 013-augment-management (for loaded events)
- Feature: 015-passenger-notifications

## Notes

This is a larger feature that includes cross-device tab sharing.
