# koad:io Desktop - Features

This folder contains feature specifications for the koad:io Electron Desktop application.

## Features Overview

| # | Feature | Status | File |
|---|---------|--------|------|
| 001 | Desktop Widget | ✅ Implemented | [001-desktop-widget.md](./001-desktop-widget.md) |
| 002 | Name Workspace Shortcut | 🔲 Not started | [002-name-workspace-shortcut.md](./002-name-workspace-shortcut.md) |
| 003 | Global koad:io Prompt | 🔲 Not started | [003-global-koad-prompt.md](./003-global-koad-prompt.md) |
| 004 | App Icon / Tray Menu | ✅ Implemented | [004-app-icon-dropdown.md](./004-app-icon-dropdown.md) |
| 005 | Workspace-Entity Binding | 🔲 Not started | [005-workspace-entity-binding.md](./005-workspace-entity-binding.md) |

## Feature Status Legend

- ✅ Implemented - Code exists and works
- 🔄 In Progress - Currently being developed
- 🔲 Not Started - Planned but not yet implemented

## Architecture

```
┌─────────────────────────────────────────┐
│           koad:io Desktop               │
├─────────────────────────────────────────┤
│                                         │
│  ┌─────────────┐   ┌─────────────────┐ │
│  │  Desktop    │   │  System Tray    │ │
│  │  Widget     │   │  Menu           │ │
│  │  (001)      │   │  (004)          │ │
│  └─────────────┘   └─────────────────┘ │
│         │                 │              │
│         └────────┬────────┘              │
│                  ▼                        │
│  ┌─────────────────────────────────┐    │
│  │     Global Prompt (003)         │    │
│  └─────────────────────────────────┘    │
│                  │                        │
│         ┌────────┴────────┐              │
│         ▼                 ▼              │
│  ┌─────────────┐   ┌─────────────┐      │
│  │ Workspace   │   │  Entity     │      │
│  │ Binding     │   │  Selection  │      │
│  │ (005)       │   │  (002)      │      │
│  └─────────────┘   └─────────────┘      │
│                                          │
└──────────────────────────────────────────┘
```

## Feature Dependencies

```
001 Desktop Widget (existing)
    │
    │ (can show current workspace/entity)
    ▼
002 Name Workspace
    │
    │ (names workspaces)
    ▼
005 Workspace-Entity Binding
    │
    │ (auto-switches entity based on name)
    ▼
004 App Icon/Tray
    │
    │ (shows current entity, opens prompt)
    ▼
003 Global Prompt
```

## Adding a New Feature

1. Create new markdown file with 3-digit prefix (e.g., `006-`)
2. Use the feature template below
3. Update this README

## Feature Template

```markdown
# Feature: [Name]

## Summary
One sentence description

## Problem
Why is this needed?

## Solution
How it works

## Implementation
Technical details

## Settings
- `setting-name`: description (default: value)

## Status
- [ ] Not started
- [ ] In progress
- [ ] Complete

## Related Features
- Feature: 001-desktop-widget.md
```

## Related Code

| Feature | Source File |
|---------|-------------|
| 001 | `src/windows/desktop-widget.js` |
| 004 | `src/system/tray.js` |
| Keyboard Shortcuts | `src/system/keyboard-shortcuts.js` |
| IPC | `src/system/inter-process-communication.js` |
