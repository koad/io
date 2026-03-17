# Technical Specification: Passenger Notifications

## Overview

Real-time notifications from passengers to the user via Chrome notifications API.

## DDP Subscription

### Subscribe
```javascript
ddp.subscribe('passenger.notifications', { passenger: 'alice' })
```

### Event Payload
```javascript
{
  type: "notification",
  id: "abc123",
  title: "GitHub Alert",
  message: "New issue on your repo",
  icon: "github",
  priority: "normal",      // low | normal | high
  actions: [
    { id: "open", label: "Open" },
    { id: "dismiss", label: "Dismiss" }
  ],
  timestamp: "2024-01-15T10:30:00Z"
}
```

## Chrome Notification

```javascript
chrome.notifications.create(id, {
  type: "basic",
  iconUrl: "/icons/notification.png",
  title: "GitHub Alert",
  message: "New issue on your repo",
  buttons: [
    { title: "Open" },
    { title: "Dismiss" }
  ],
  priority: 1
});
```

## Action Handling

```javascript
chrome.notifications.onButtonClicked.addListener((id, btnIdx) => {
  if (btnIdx === 0) {  // Open
    // Open related URL
  } else if (btnIdx === 1) {  // Dismiss
    // Dismiss notification
  }
  
  // Notify passenger
  ddp.call('passenger.notifications.action', {
    notificationId: id,
    actionId: btnIdx === 0 ? 'open' : 'dismiss'
  });
});
```

## Settings

```javascript
{
  "notifications": {
    "enabled": true,
    "sound": true,
    "minPriority": "normal",  // don't show below this
    "showPreview": true
  }
}
```

## Implementation Files

- Background listener: `dist/background/notifications.js`
- Storage: `dist/lib/notification-settings.js`
