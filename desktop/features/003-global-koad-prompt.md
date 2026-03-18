# Feature: Global koad:io Prompt (Command Palette)

## Summary
A global keyboard shortcut opens a unified command palette that serves as an entry point to all koad:io entities. Search across entity realms, trigger actions, or start conversations with agents.

## Inspiration
- Google Desktop (double-click ESC for file/content search)
- macOS Spotlight (Cmd+Space)
- Raycast / Alfred (productivity command palettes)
- OpenCode / Claude Desktop (AI agent interaction)

## Problem
koad:io has multiple entities (Alice, various agents, services) but no unified way to:
- Quickly search across all of them
- Trigger actions without context switching
- Have a "command center" accessible from anywhere

## Solution
A global popup (like Spotlight/Alfred) that:
1. Appears on keyboard shortcut (e.g., `Super+Space`)
2. Shows an input field for queries
3. Displays results from entities in real-time
4. Multiple action buttons for different intents

## User Experience

### Activation
- Press `Super+Space` (configurable) → popup appears
- Input is auto-focused, ready to type
- Press `Escape` to close

### Input Flow
1. User types query (e.g., "find meeting notes", "what is alice working on?", "search crypto prices")
2. As user types, entities are queried for matching results
3. Results appear in a list below
4. User can:
   - Press Enter to execute default action
   - Click an action button to send query to specific entity
   - Arrow keys to navigate results, Enter to select

### Action Buttons
| Button | Icon | Action |
|--------|------|--------|
| 🔍 Search | `system-search` | Search all entity realms for matching results |
| 💬 Chat | `chat` | Start conversation with primary entity (e.g., Alice) |
| 🧠 Think | `brain` | Send to reasoning/analysis entity |
| ⚡ Command | `terminal` | Execute as shell command |
| 📁 Files | `folder` | Search local files |

### Results Display
Results grouped by entity:
```
📁 Files
  - meeting-notes-2024.md (in ~/Documents)
  - notes/today.txt (modified yesterday)

💬 Alice
  - Found in memories: "meeting" mentioned 3 times
  - Can start conversation about this topic

🧠 Analysis
  - 5 documents contain "meeting"
  - Sentiment: neutral
```

## Implementation

### Window Type
Use Electron BrowserWindow with:
```javascript
{
  frame: false,
  transparent: true,
  alwaysOnTop: true,
  skipTaskbar: true,
  resizable: false,
  width: 600,
  height: 400,
  show: false, // Show on shortcut
}
```

### Global Shortcut
```javascript
const { globalShortcut } = require('electron');
globalShortcut.register('Super+Space', () => {
  promptWindow.show();
  promptWindow.focus();
});
```

### Entity Communication
- Connect to koad:io daemon via DDP
- Each entity exposes search/chat methods
- Debounce input (300-500ms) before querying

### UI Framework
- Vanilla JS + CSS
- Or: React/Vue for more complex UI
- Use Adwaita/GNOME design tokens for consistency

## Settings
- `global-shortcut`: Keyboard shortcut (default: `Super+Space`)
- `default-action`: Which action on Enter (default: `search`)
- `visible-buttons`: Which buttons to show (default: all)
- `entity-timeout`: Entity response timeout (ms, default: 2000)

## Status
- [ ] Not started
- [ ] In progress
- [ ] Complete

## Related Features
- Feature: 001-desktop-widget.md - Could show prompt indicator
- Feature: 004-app-icon-dropdown.md - Menu also opens prompt
- Feature: 002-name-workspace-shortcut.md - Uses similar popup mechanism
