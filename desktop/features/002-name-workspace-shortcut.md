# Feature: Name Workspace via Keyboard Shortcut

## Summary
Allow users to name the current workspace using a keyboard shortcut that opens a popup input box.

## Context
This is the Electron/Desktop version of the GNOME feature. In GNOME, workspace names are native. In a cross-platform desktop app, we store workspace names in koad:io configuration.

## Problem
- No easy way to name workspaces across platforms
- Need a quick keyboard shortcut to set workspace identity
- Workspace names should be meaningful (context-based)

## Solution
- Register a global keyboard shortcut (default: `Super+Shift+N`)
- When pressed: open a modal input dialog
- User types workspace name → press Enter to confirm
- Store workspace names in koad:io config

## User Flow
1. User presses `Super+Shift+N` (configurable)
2. Input dialog appears (centered on screen)
3. User types workspace name (e.g., "Music", "Dev", "Crypto")
4. User presses Enter → name saved, dialog closes
5. User presses Escape → cancel and close

## Implementation

### Shortcut Registration
Use `globalShortcut.register()` from Electron:
```javascript
const { globalShortcut } = require('electron');
globalShortcut.register('Super+Shift+N', () => {
  showWorkspaceNameDialog();
});
```

### Storage
Store workspace names in GSettings (GNOME) or local JSON:
```json
// ~/.koad-io/config/workspaces.json
{
  "workspace-names": {
    "0": "Dev",
    "1": "Music",
    "3": "Crypto"
  }
}
```

### Dialog UI
- Electron BrowserWindow (frameless, centered)
- Or native dialog: `dialog.showMessageBox()` (simpler but less customizable)

### Cross-Platform Considerations
| Platform | Workspace Detection | Storage |
|----------|-------------------|---------|
| Linux (GNOME) | Read via `wmctrl` or GNOME API | GSettings or JSON |
| macOS | `spaces` API or `yabai` | JSON |
| Windows | Virtual desktop API | JSON |

## Settings
- `name-shortcut`: Keyboard shortcut (default: `Super+Shift+N`)

## Related Features
- Feature: 001-desktop-widget.md - Widget can show current workspace name
- Feature: 005-workspace-entity-binding.md - Workspace name triggers entity switch
- Feature: 004-app-icon-dropdown.md - Current workspace shown in tray menu

## Status
- [ ] Not started
- [ ] In progress
- [ ] Complete
