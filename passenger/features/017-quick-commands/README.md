# Feature: Quick Commands

## Summary

Command palette for quick access to all extension features, similar to Spotlight or Alfred.

## Problem

- Too many buttons and options in popup
- Need quick access to any feature
- Power user workflow

## Solution

Press a keyboard shortcut or click to open command palette.

## Trigger

- **Keyboard**: Ctrl+Shift+Space (configurable)
- **Popup**: Command icon button

## Commands

| Command | Action |
|---------|--------|
| `copy tab` | Copy current tab URL |
| `copy tabs` | Copy all tabs |
| `discard tabs` | Discard all tabs |
| `read later` | Add to read later |
| `search [query]` | Search the web |
| `goto [url]` | Open URL |
| `settings` | Open settings |
| `passenger [name]` | Switch passenger |
| `notes` | View/add notes |
| `activity` | View activity log |

## UI

```
┌─────────────────────────────────────────┐
│  🔍 > _                                │
├─────────────────────────────────────────┤
│                                         │
│  ► copy tab        Copy current URL    │
│  ► copy tabs       Copy all tabs       │
│  ► read later      Save for later      │
│  ► search...       Search the web      │
│  ► goto...         Open URL            │
│                                         │
└─────────────────────────────────────────┘
```

## Fuzzy Search

Commands are fuzzy matched:
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

## Status

- [ ] Design command palette UI
- [ ] Implement command list
- [ ] Implement fuzzy search
- [ ] Add keyboard shortcut
- [ ] Connect commands to actions

## Related Features

- Feature: 010-core-passenger-features.md
- Feature: 014-read-later.md
