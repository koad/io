# Feature: Community Chat Rooms

## Summary

Passengers can provide community chat rooms tied to specific URLs/domains, allowing users to discuss what's on the current page with others.

## Problem

Users want to discuss web content with others in real-time, but there's no built-in way to do this for arbitrary URLs.

## Solution

When visiting a URL, the sidebar can load a community chat room specific to that domain/path. Other users viewing the same URL can join the conversation.

## Implementation

### Passenger Configuration

In `passenger.json`:

```json
{
  "chat": {
    "enabled": true,
    "provider": "ddp",
    "roomPrefix": "web:"
  }
}
```

### DDP Method

**Method**: `passenger.get.chatroom`

**Request**:
```json
{
  "domain": "github.com",
  "url": "https://github.com/koad/io",
  "title": "koad/io"
}
```

**Response**:
```json
{
  "available": true,
  "room": {
    "id": "web:github.com/koad/io",
    "name": "koad/io Discussion",
    "participants": 12,
    "messages": [
      {
        "user": "alice",
        "text": "This is a great repo!",
        "timestamp": "2024-01-15T10:30:00Z"
      }
    ]
  },
  "joinUrl": "wss://chat.koad.io/room/web:github.com/koad/io"
}
```

### No Chat Available

```json
{
  "available": false,
  "message": "No chat room for this domain"
}
```

### Sidebar Integration

When a chat room is available:
1. Sidebar shows chat icon with participant count
2. Clicking opens the chat room in side panel
3. Messages sync in real-time via WebSocket

### Room Naming Convention

```
web:{domain}:{path}
web:github.com/koad
web:reddit.com/r/programming
web:youtube.com/watch?v=xyz
```

## Use Cases

- Discuss news articles in real-time
- Collaborate on documentation
- Ask questions about products
- Community moderation of content

## Status

- [ ] Define passenger.json chat schema
- [ ] Implement passenger.get.chatroom method
- [ ] Implement sidebar chat UI
- [ ] Connect to real-time messaging
- [ ] Handle room creation/joining

## Related Features

- Feature: 008-passenger-skill-registry.md
- Feature: 009-passenger-settings.md
