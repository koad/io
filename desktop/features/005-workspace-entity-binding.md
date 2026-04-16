# Feature: Workspace-Entity Binding

## Summary
Automatically switch the active koad:io entity based on the current workspace's name. When switching workspaces, if that workspace has a name set, the corresponding entity becomes active. When the workspace name is cleared, the entity binding is also cleared.

## Context
This is the cross-platform version. On GNOME, we can read native workspace names. On other platforms, we need to:
- Use platform-specific APIs (macOS spaces, Windows virtual desktops)
- Or maintain our own workspace mapping

## Problem
- No connection between workspace identity and koad:io entity
- Users must manually switch entities when moving between workspaces
- The "active entity" concept feels disconnected from workspace context

## Solution
Link workspace names directly to entity selection:

### Behavior on Workspace Switch

```
User switches to Workspace 2 (named "Crypto")
    │
    ▼
Is Workspace 2 named in koad:io config?
    │
    ├── YES → Set active entity to matching entity
    │         (e.g., "eCoinCore" if workspace named "Crypto")
    │
    └── NO  → Keep previously selected entity
             (manual selection persists)
```

### Entity Matching Logic

| Workspace Name | Entity Match | Example |
|---------------|--------------|---------|
| Exact match | Entity name | "Alice" → entity "Alice" |
| Contains keyword | Entity keywords | "Music" → entity with tag "music" |
| No match | Keep current | "Random" → no change |

### Matching Configuration
Entities can define keywords:
```json
// ~/.alice/passenger.json or entity config
{
  "name": "eCoinCore",
  "keywords": ["crypto", "coin", "blockchain", "ecoin"],
  "icon": "ecoincore-symbolic"
}
```

## Platform-Specific Implementation

### Linux (GNOME)
- Read workspace names via `wmctrl` or GNOME API
- Or: rely on GNOME extension for workspace events
- Communication: IPC or shared config file

### macOS
- Use `yabai` or `spaces` API
- Or: maintain virtual workspace mapping

### Windows
- Use Windows Virtual Desktop API
- Or: maintain virtual workspace mapping

### Cross-Platform Abstraction
```javascript
class WorkspaceManager {
  async getCurrentWorkspace() { ... }
  async getWorkspaceName(index) { ... }
  async onWorkspaceChange(callback) { ... }
}
```

## Storage
Store workspace-entity bindings:
```json
// ~/.koad-io/config/workspaces.json
{
  "workspace-names": {
    "0": "Dev",
    "1": "Music",
    "2": "Crypto"
  },
  "workspace-entity-bindings": {
    "0": "alice",
    "1": null,
    "2": "ecoincore"
  },
  "entity-keywords": {
    "alice": ["dev", "code", "programming"],
    "ecoincore": ["crypto", "coin", "blockchain"]
  }
}
```

## Settings
- `auto-switch-entities`: Enable auto-switching (default: true)
- `clear-on-name-remove`: Clear entity when name removed (default: true)
- `platform-workspace-api`: Which API to use

## Integration Points

### With Feature 002 (Name Workspace)
- When user names a workspace, prompt to bind an entity

### With Feature 004 (Tray Menu)
- Show current workspace name in tray tooltip
- Show entity bound to each workspace

### With Feature 001 (Desktop Widget)
- Widget can show current workspace context

## Status
- [x] Not started
- [x] In progress — Phase 1 (desktop-side state, refactored): desktop polls xdotool, reports workspace number to daemon via DDP (`workspace.setState`). Daemon owns mapping, entity discovery, and Passengers `selected` state. Config at `~/.koad-io/daemon/config/workspace-entities.json`. Widget subscribes to daemon's `current` publication reactively. (vulcan, 2026-04-16)
- [ ] Complete — Phase 2 follow-ons filed as koad/vulcan issues

## Related Features
- Feature: 002-name-workspace-shortcut.md - How workspaces get named
- Feature: 004-app-icon-dropdown.md - Shows current entity in menu
- Feature: 001-desktop-widget.md - Could display workspace context
