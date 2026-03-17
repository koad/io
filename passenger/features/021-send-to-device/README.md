# Feature: Send to Device

## Summary

Send URLs from one device to another. Open current tab on a different machine.

## Problem

- Viewing something on work computer, want to continue at home
- Need to move URL between devices quickly
- No built-in way to do this

## Solution

Send URL to configured devices via passenger DDP. Target device receives and opens in browser.

## Implementation

### Device Registration

Each device registers with the passenger:

```json
{
  "deviceId": "work-laptop",
  "name": "Work Laptop",
  "platform": "linux",
  "browser": "Chrome",
  "capabilities": ["browser", "notifications"]
}
```

### DDP Methods

**Send to Device**:
```
passenger.sendToDevice({
  deviceId: "home-desktop",
  url: "https://github.com/koad/io",
  title: "koad/io",
  sourceDevice: "work-laptop"
})
```

**List Devices**:
```
passenger.devices.list()
```

**Response**:
```json
{
  "devices": [
    {
      "deviceId": "home-desktop",
      "name": "Home Desktop",
      "platform": "linux",
      "online": true,
      "lastSeen": "2024-01-15T10:30:00Z"
    },
    {
      "deviceId": "phone",
      "name": "Android Phone",
      "platform": "android",
      "online": false,
      "lastSeen": "2024-01-14T18:00:00Z"
    }
  ]
}
```

### Device Service (on target machine)

Each device runs a small service that:
1. Listens for incoming URLs (via DDP/WebSocket)
2. Opens browser with the URL
3. Optionally sends notification

**Example service**:
```javascript
// On target device
ddp.subscribe('passenger.device.messages', { deviceId: 'home-desktop' });

ddp.on('message', (message) => {
  if (message.type === 'openUrl') {
    // Open in default browser
    child_process.spawn('xdg-open', [message.url]);
  }
});
```

## UI

### In Popup

```
┌─────────────────────────────────────────┐
│  Send to Device                    [📱] │
├─────────────────────────────────────────┤
│                                         │
│  Current: Work Laptop                  │
│                                         │
│  [📱 Home Desktop (online)]            │
│  [📱 Android Phone (offline)]          │
│                                         │
│  Or select:                            │
│  ┌─────────────────────────────────┐   │
│  │ Type device name...             │   │
│  └─────────────────────────────────┘   │
│                                         │
└─────────────────────────────────────────┘
```

### Context Menu

Right-click → "Send to Home Desktop"

## Settings

```json
{
  "sendToDevice": {
    "deviceId": "work-laptop",
    "deviceName": "Work Laptop",
    "autoAccept": true,
    "notifyOnReceive": true
  }
}
```

## Status

- [ ] Define device registration schema
- [ ] Implement DDP send/receive methods
- [ ] Add popup UI for device selection
- [ ] Add context menu option
- [ ] Implement device service (listener)
- [ ] Handle offline devices gracefully

## Related Features

- Feature: 016-activity-log.md (cross-device)
- Feature: 015-passenger-notifications.md
