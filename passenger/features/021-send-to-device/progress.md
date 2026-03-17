# Progress: Send to Device

## Status: 🔲 Not Started

## To Do

- [ ] Define device registration schema
- [ ] Implement DDP send/receive methods
- [ ] Add popup UI for device selection
- [ ] Add context menu option
- [ ] Implement device service (listener)
- [ ] Handle offline devices gracefully

## Device Schema

```json
{
  "deviceId": "work-laptop",
  "name": "Work Laptop",
  "platform": "linux",
  "browser": "Chrome",
  "capabilities": ["browser", "notifications"]
}
```

## DDP Methods

- `passenger.sendToDevice({deviceId, url, title, sourceDevice})`
- `passenger.devices.list()`

## Device Service (Target Machine)

Each device runs a small service that:
1. Listens for incoming URLs (via DDP/WebSocket)
2. Opens browser with the URL
3. Optionally sends notification

```javascript
// On target device
ddp.subscribe('passenger.device.messages', { deviceId: 'home-desktop' });

ddp.on('message', (message) => {
  if (message.type === 'openUrl') {
    child_process.spawn('xdg-open', [message.url]);
  }
});
```

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

## Dependencies

- Feature: 016-activity-log (cross-device)
- Feature: 015-passenger-notifications

## Notes

Requires a small service running on each device that wants to receive URLs.
