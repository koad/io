# Feature: Passenger Notifications

## Summary

Passengers can send notifications to the user about important events.

## Problem

- Users need to be notified of events from their entities
- Background processing needs a way to alert users

## Solution

Passengers send notifications via DDP. Extension displays using Chrome's notification API.

## DDP Methods

### Subscribe to Notifications

```
passenger.notifications.subscribe()
```

### Event

```json
{
  "type": "notification",
  "id": "abc123",
  "title": "GitHub Alert",
  "message": "New issue on your repo",
  "icon": "github",
  "priority": "normal",
  "actions": [
    { "id": "open", "label": "Open" },
    { "id": "dismiss", "label": "Dismiss" }
  ]
}
```

### Notification Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique notification ID |
| `title` | string | Notification title |
| `message` | string | Notification body |
| `icon` | string | Icon name |
| `priority` | string | low/normal/high |
| `actions` | array | Action buttons |

### Action Handling

When user clicks an action:
```
passenger.notifications.action({
  notificationId: "abc123",
  actionId: "open"
})
```

## Chrome Notifications

Uses `chrome.notifications.create()`:

```javascript
chrome.notifications.create(id, {
  type: "basic",
  iconUrl: "/icons/notification.png",
  title: "GitHub Alert",
  message: "New issue on your repo",
  buttons: [{ title: "Open" }, { title: "Dismiss" }]
});
```

## Settings

Users can configure:
- Enable/disable notifications
- Sound on/off
- Priority threshold
- Click behavior

```json
{
  "notifications": {
    "enabled": true,
    "sound": true,
    "minPriority": "normal"
  }
}
```

## Status

- [ ] Define notification schema
- [ ] Implement DDP subscription
- [ ] Display Chrome notifications
- [ ] Handle notification actions
- [ ] Add settings options

## Related Features

- Feature: 008-passenger-skill-registry.md
