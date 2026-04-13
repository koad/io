# Technical Specification: Entity Selector

## Overview

UI component for selecting which passenger (entity) accompanies the user while browsing.

## Data Source

- Fetches from DDP subscription `passengers`
- Passenger data structure from daemon

## Passenger Data Structure

```javascript
{
  _id: "alice",
  handle: "alice",
  name: "Alice",
  avatar: "avatar.png",        // path to image
  outfit: {
    hue: 12,
    saturation: 6,
    brightness: 15
  },
  buttons: [...],              // skill buttons
  ddp: {
    host: "KOAD_IO_BIND_IP",
    port: 3000,
    ssl: false
  }
}
```

## UI Components

### Toolbar Button
- Shows current passenger avatar/icon
- Click opens dropdown popup

### Dropdown Popup
```
┌─────────────────────────────────┐
│  🎭 Select Passenger            │
├─────────────────────────────────┤
│  ○ Alice                        │
│  ○ Maya                         │
│  ○ Bob                          │
└─────────────────────────────────┘
```

### Active State
- Selected passenger shown with filled radio/checkmark
- Badge updated on extension icon

## Behavior

### On Selection
1. Call `passenger.check.in(name)` method
2. Update badge with passenger name/initial
3. Store selection in `chrome.storage.local`
4. Subscribe to passenger-specific DDP events

### On Load
1. Fetch current selection from storage
2. If exists, reconnect to that passenger
3. Subscribe to passenger updates

## Storage Schema

```javascript
{
  "currentPassenger": "alice",
  "passengerList": [
    { "handle": "alice", "name": "Alice" },
    { "handle": "maya", "name": "Maya" }
  ]
}
```

## Implementation Files

- Popup HTML: `dist/panes/popup/index.html`
- Popup CSS: `dist/panes/popup/styles.css`
- Popup Logic: `dist/panes/popup/logic.js`
- Background: `dist/background/passenger-selector.js`
