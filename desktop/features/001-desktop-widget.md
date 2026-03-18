# Feature: Desktop Widget

## Summary
A floating, transparent widget window that stays on all workspaces, displaying hotlinks/buttons that allow quick access to entity functions and open applications.

## Inspiration
- Google Desktop gadget
- Windows desktop widgets
- Rainmeter
- WebPASS /station

## Problem
- Need quick access to entity functions without switching contexts
- Want entity "presence" visible at all times
- No unified launcher for entity-specific actions

## Solution
A frameless, transparent, always-on-top window in the bottom-left corner:
- Loads from daemon (passenger UI)
- Displays buttons defined in entity's `passenger.json`
- Each button triggers an action (open URL, launch app, etc.)

## Current Implementation
Located at: `src/windows/desktop-widget.js`

### Window Properties
```javascript
{
  width: 230,
  height: 227,
  frame: false,
  transparent: true,
  type: 'utility',
  skipTaskbar: true,
  setVisibleOnAllWorkspaces: true,
}
```

### Position
- Default: bottom-left of primary display
- Persisted in `~/.koad-io/desktop/.local/userdata/window-state-desktop-widget.json`

### Data Source
Loads from daemon endpoint: `http://127.0.0.1:28282`

### Passenger JSON Structure
Buttons defined in `~/.alice/passenger.json`:
```json
{
  "handle": "alice",
  "name": "Alice",
  "buttons": [
    { "key": "cross", "label": "Home", "action": "open.pwa", "target": "..." },
    { "key": "coffin-cross", "label": "File", "action": "open.with.default.app", "target": "..." },
    { "key": "church", "label": "Calendar", "action": "open.pwa.with.brave", "target": "..." }
  ]
}
```

### Button Actions
| Action | Behavior |
|--------|----------|
| `open.pwa` | Open as PWA in browser |
| `open.with.default.app` | Open with system default app |
| `open.pwa.with.brave` | Open with Brave browser |
| `open.with.{browser}` | Open with specific browser |

## Enhancements (Future)
- [ ] Allow drag to reposition
- [ ] Resize handles
- [ ] Opacity controls
- [ ] Multiple entities (switchable widget)
- [ ] Mini-mode (collapsed to single icon)

## Settings
- `widget-position`: Saved automatically
- `widget-opacity`: Window opacity (default: 1.0)
- `widget-visible`: Show/hide widget

## Technical Notes
- Uses Electron `BrowserWindow` with `transparent: true`
- Uses `setVisibleOnAllWorkspaces()` for multi-workspace support
- State persistence via `fs-jetpack`
- Window type `utility` prevents it from appearing in taskbar

## Status
- [x] Implemented in `src/windows/desktop-widget.js`
- [ ] Enhanced
- [ ] Complete

## Related Files
- `src/windows/desktop-widget.js` - Main implementation
- `~/.alice/passenger.json` - Button configuration
