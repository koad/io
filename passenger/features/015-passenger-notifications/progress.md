# Progress: Passenger Notifications

## Status: 🔲 Not Started

## To Do

- [ ] Define notification schema
- [ ] Implement DDP subscription
- [ ] Display Chrome notifications
- [ ] Handle notification actions
- [ ] Add settings options

## Notification Schema

| Field | Type | Description |
|-------|------|-------------|
| id | string | Unique notification ID |
| title | string | Notification title |
| message | string | Notification body |
| icon | string | Icon name |
| priority | string | low/normal/high |
| actions | array | Action buttons |

## DDP Subscription

- `passenger.notifications.subscribe()`
- `passenger.notifications.action({notificationId, actionId})`

## Settings

```json
{
  "notifications": {
    "enabled": true,
    "sound": true,
    "minPriority": "normal"
  }
}
```

## Dependencies

- Feature: 008-passenger-skill-registry (for DDP methods)

## Notes

Allows passengers to send real-time notifications to the user.
