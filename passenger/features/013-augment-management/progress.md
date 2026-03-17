# Progress: Augment Management

## Status: 🔲 Not Started

## To Do

- [ ] Design augment list UI in popup
- [ ] Implement toggle on/off
- [ ] Implement "enable forever"
- [ ] Save to chrome.storage.sync
- [ ] Auto-load permanent augments on page visit

## Augment Types

| Type | Description |
|------|-------------|
| script | JavaScript to inject |
| style | CSS styles to apply |

## Storage Schema

```json
{
  "augments": {
    "alice": {
      "github:dark-theme": {
        "enabled": true,
        "permanent": true,
        "added": "2024-01-15T10:30:00Z"
      }
    }
  }
}
```

## Dependencies

- Feature: 008-passenger-skill-registry (for augments from passengers)
- Feature: 010-core-passenger-features (for popup UI)

## Notes

Augments are scripts/styles that passengers provide for specific sites.
