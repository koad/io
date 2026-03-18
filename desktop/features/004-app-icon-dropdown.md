# Feature: App Icon / System Tray Menu

## Summary
A system tray icon that shows a dropdown menu for quick entity selection, browser preferences, and access to settings/prompt.

## Current Implementation
Located at: `src/system/tray.js`

Already implemented with:
- System tray icon
- Entity selection from daemon passengers
- Browser selection (Brave, Chrome, Chromium)
- Settings access
- Quit application

## Menu Structure (Current)

```
┌─────────────────────────────────┐
│ Entity Selection (from DDP)    │
│   ○ Alice                       │
│   ○ eCoinCore                   │
│   ○ ...                         │
├─────────────────────────────────┤
│ Browser: [Brave ▼]              │
│   ○ Brave                       │
│   ○ Chrome                      │
│   ○ Chromium                    │
├─────────────────────────────────┤
│ settings                        │
│ quit application                │
└─────────────────────────────────┘
```

## Enhancement: Proposed Full Menu

```
┌─────────────────────────────────┐
│ 🧠 koad:io - [Selected Entity] │
├─────────────────────────────────┤
│ Entity:                    ▼   │
│   ┌─────────────────────┐      │
│   │ Alice               │      │
│   │ Alice (Reasoning)   │      │
│   │ eCoinCore           │      │
│   │ Custom Agent...     │      │
│   └─────────────────────┘      │
├─────────────────────────────────┤
│ 🔍 Open Search Prompt           │  ← Feature 003
│ ⚙️ Preferences                  │
│ 🌐 Entity Interface             │
├─────────────────────────────────┤
│ Default Browser:          ▼    │
│   Firefox                    │
│   Chrome                     │
│   Arc                        │
│   System Default             │
├─────────────────────────────────┤
│ ❌ Quit koad:io               │
└─────────────────────────────────┘
```

## Current Code (tray.js)

```javascript
const { app, Menu, Tray } = require('electron');
Application.tray = new Tray('./resources/logo-32x.png');

const contextMenu = Menu.buildFromTemplate([
  ...menuItems,  // Dynamic passenger list
  { type: 'separator' },
  { label: `Browser: ${selectedBrowser}`, submenu: [...] },
  { type: 'separator' },
  { label: 'settings', click: () => { ... } },
  { label: 'quit application', click: () => { app.quit(); }}
]);
```

## Enhancements to Implement

| Enhancement | Priority | Description |
|-------------|----------|-------------|
| Add "Open Search Prompt" button | High | Link to Feature 003 |
| Add "Entity Interface" button | Medium | Open entity's web UI |
| Dynamic browser list | Medium | Read installed browsers |
| Show current workspace name | Low | Integration with Feature 005 |
| Add entity status indicator | Low | Show online/offline |

## Settings
- `status-icon-visible`: Show/hide tray icon (default: true)
- `selected-entity`: Currently selected entity
- `entity-browser-{entityId}`: Browser per entity
- `show-quit-button`: Show quit option (default: true)

## Technical Notes
- Uses Electron `Tray` and `Menu`
- Connects to daemon via DDP (`simpleddp`)
- Auto-subscribes to `all` passengers collection
- Entity selection calls `passenger.check.in` method

## Status
- [x] Implemented in `src/system/tray.js`
- [ ] Enhanced (Open Prompt button)
- [ ] Enhanced (Entity Interface button)
- [ ] Complete

## Related Files
- `src/system/tray.js` - Main implementation
- `src/library/logger.js` - Logging
- `~/.koad-io/daemon/` - DDP server

## Related Features
- Feature: 003-global-koad-prompt.md - "Open Search Prompt" button
- Feature: 005-workspace-entity-binding.md - Show current workspace
