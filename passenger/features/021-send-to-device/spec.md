# Technical Specification: Send to Device

## Overview

Send URLs from one device to another via passenger DDP connection.

## Device Registration

### Register Device
```javascript
ddp.call('passenger.devices.register', {
  deviceId: "work-laptop",
  name: "Work Laptop",
  platform: "linux",
  browser: "Chrome",
  capabilities: ["browser", "notifications"]
})
```

### List Devices
```javascript
ddp.call('passenger.devices.list')
// Returns: { devices: [...] }
```

### Response
```javascript
{
  devices: [
    {
      deviceId: "home-desktop",
      name: "Home Desktop",
      platform: "linux",
      online: true,
      lastSeen: "2024-01-15T10:30:00Z"
    }
  ]
}
```

## Send URL

```javascript
ddp.call('passenger.sendToDevice', {
  deviceId: "home-desktop",
  url: "https://github.com/koad/io",
  title: "koad/io",
  sourceDevice: "work-laptop"
})
```

## Device Service (Listener)

Run on target device to receive URLs:

```javascript
// Daemon-side or standalone service
const ddp = new DDP('ws://localhost:9568/websocket');

ddp.connect().then(() => {
  ddp.subscribe('passenger.device.messages', { 
    deviceId: 'home-desktop' 
  });
  
  ddp.on('message', (msg) => {
    if (msg.type === 'openUrl') {
      // Open in browser
      require('child_process').spawn('xdg-open', [msg.url]);
      
      // Optional: send notification
      if (msg.notify) {
        sendNotification(msg.title, msg.url);
      }
    }
  });
});
```

## UI (Popup)

```
┌─────────────────────────────────────────┐
│  Send to Device                    [📱] │
├─────────────────────────────────────────┤
│                                         │
│  Current: Work Laptop                   │
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

## Settings

```javascript
{
  "sendToDevice": {
    "deviceId": "work-laptop",
    "deviceName": "Work Laptop",
    "autoAccept": true,           // auto-open received URLs
    "notifyOnReceive": true,
    "registerOnStartup": true
  }
}
```

## Implementation Files

- Popup UI: `dist/panes/popup/send-device.js`
- Background: `dist/background/device-communication.js`
- Service example: `examples/device-listener/`
