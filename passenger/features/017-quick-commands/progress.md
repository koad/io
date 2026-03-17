# Progress: Quick Commands

## Status: 🔲 Not Started

## To Do

- [ ] Design command palette UI
- [ ] Implement command list
- [ ] Implement fuzzy search
- [ ] Add keyboard shortcut
- [ ] Connect commands to actions

## Trigger

- **Keyboard**: Ctrl+Shift+Space (configurable)
- **Popup**: Command icon button

## Commands

| Command | Action |
|---------|--------|
| copy tab | Copy current tab URL |
| copy tabs | Copy all tabs |
| discard tabs | Discard all tabs |
| read later | Add to read later |
| search [query] | Search the web |
| goto [url] | Open URL |
| settings | Open settings |
| passenger [name] | Switch passenger |
| notes | View/add notes |
| activity | View activity log |

## Fuzzy Matching

Commands should be fuzzy matched:
- `ct` → `copy tab`
- `rl` → `read later`
- `sr` → `search`

## Settings

```json
{
  "quickCommands": {
    "enabled": true,
    "shortcut": "Ctrl+Shift+Space"
  }
}
```

## Dependencies

- Feature: 010-core-passenger-features
- Feature: 014-read-later

## Notes

This is a power user feature - similar to Spotlight or Alfred.
