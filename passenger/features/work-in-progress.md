# Work In Progress

This file tracks features that can be implemented independently (not depending on other unimplemented features).

## Features That Can Be Built Now

| # | Feature | Difficulty | Dependencies | Status |
|---|---------|------------|--------------|--------|
| 1 | **019 Web Search** | Easy | None (advanced: 012, 017) | Basic done |
| 2 | **020 URL Shortener** | Easy | None | Not started |
| 3 | **014 Read Later** | Easy | None | Not started |
| 4 | **018 Screenshot Capture** | Medium | None | Not started |
| 5 | **017 Quick Commands** | Medium | None | Not started |
| 6 | **010 Core Passenger Features** | Easy | None | In progress |
| 7 | **022 Sovereign Profiles** | Medium | None | In progress |
| 8 | **023 Passenger Auth** | Medium | 022 | In progress |

---

## Features With Dependencies

These features require other features to be implemented first:

| # | Feature | Depends On |
|---|---------|------------|
| 009 | Passenger Settings | 008 |
| 011 | Community Chat Rooms | 008 |
| 012 | Community Notes | 008 |
| 013 | Augment Management | 008 |
| 015 | Passenger Notifications | 008 |
| 016 | Activity Log | 008, 013, 015 |
| 021 | Send to Device | 015, 016 |

---

## Recommended Implementation Order

### Phase 1: Standalone Features (No Dependencies)

```
1. 019 Web Search          - Basic already done
2. 020 URL Shortener       - Simple is.gd API
3. 014 Read Later          - Local storage first
4. 018 Screenshot Capture  - Chrome APIs
5. 017 Quick Commands      - Command palette
6. 010 Core Features       - Finish remaining
```

### Phase 2: Features Requiring 008 (Passenger Registry)

```
7.  009 Passenger Settings
8.  015 Passenger Notifications
9.  013 Augment Management
10. 012 Community Notes
11. 011 Community Chat Rooms
```

### Phase 3: Advanced Features

```
12. 016 Activity Log & Cross-Device Sync
13. 021 Send to Device
```

---

## Feature Details

### 1. Web Search (019) ✅ Basic Done

**Remaining**:
- Context menu for selected text
- Keyboard shortcut for selected text
- Selected text action UI
- DDP ingest for selected text
- Add note with selection

**Why easy**: Core search is already implemented.

---

### 2. URL Shortener (020)

**To Do**:
- Implement is.gd/v.gd integration
- Add passenger DDP method support
- UI in popup
- Context menu option
- Click tracking display

**Why easy**: Simple third-party API, straightforward UI.

---

### 3. Read Later (014)

**To Do**:
- Implement local storage read later
- Add popup UI
- Add "read later" button

**Why easy**: Local storage CRUD, no complex dependencies.

---

### 4. Screenshot Capture (018)

**To Do**:
- Implement visible capture
- Implement full page capture
- Implement selection capture
- Preview UI
- Save to clipboard/download/passenger

**Why easy**: Chrome provides captureVisibleTab API.

---

### 5. Quick Commands (017)

**To Do**:
- Design command palette UI
- Implement command list
- Implement fuzzy search
- Add keyboard shortcut
- Connect commands to actions

**Why easy**: Standalone UI component, doesn't need other features.

---

### 6. Core Passenger Features (010)

**Remaining**:
- DOM element removal (Ctrl+Shift+click)

**Why easy**: Simple content script addition.

---

## Agent Reminder

When working on features, you MUST update this file:

1. **When starting a feature**: Move it to "Currently Working On"
2. **When completing a feature**: Mark as complete, move to "Completed"
3. **When blocked**: Note the blocker in the feature's progress.md

---

## Currently Working On

_(Fill this in when working on a feature)_

---

## Completed

_(Features completed go here)_

---

## Notes

- **008 Passenger & Skill Registry** is the foundation for most features
- Once 008 is complete on the extension side, many other features unlock
- Features in Phase 1 can all be built in parallel
- No feature in Phase 1 depends on any other unimplemented feature
