# Technical Specification: Quick Commands

## Overview

Command palette for quick access to all extension features (like Spotlight/Alfred).

## Trigger

| Method | Shortcut |
|--------|----------|
| Keyboard | Ctrl+Shift+Space (configurable) |
| Popup | Click command icon |

## Command Structure

```javascript
{
  id: "copy-tab",
  label: "Copy Tab",
  keywords: ["copy", "tab", "url", "clipboard"],
  action: "copyTab"
}
```

## Built-in Commands

| Command | Action | Keywords |
|---------|--------|----------|
| copy tab | Copy current URL | ct, copy, tab |
| copy tabs | Copy all URLs | tabs, copy, all |
| discard tabs | Discard all tabs | discard, kill, tabs |
| read later | Save URL | rl, read, later, bookmark |
| search [query] | Web search | s, search, find |
| goto [url] | Open URL | go, open, url |
| settings | Open settings | settings, options, config |
| passenger [name] | Switch passenger | p, passenger, entity |
| notes | View/add notes | notes, annotate |
| activity | View activity | log, history |

## Fuzzy Matching

Using Fuse.js or similar:
- `ct` → `copy tab`
- `rl` → `read later`
- `sr` → `search`

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

## Settings

```javascript
{
  "quickCommands": {
    "enabled": true,
    "shortcut": "Ctrl+Shift+Space",
    "fuzzyThreshold": 0.3
  }
}
```

## Implementation Files

- Command palette UI: `dist/panes/popup/commands.js`
- Command registry: `dist/lib/commands.js`
- Keyboard handler: `dist/background/commands-shortcut.js`
