# Technical Specification: DDP Connection

## Overview

Real-time bidirectional communication between Chrome browser extension and koad:io daemon using DDP (Distributed Data Protocol) over WebSocket.

## Connection

### Endpoint
- **Default**: `ws://localhost:9568/websocket`
- **Configurable**: Via `KOAD_IO_BIND_IP` and `KOAD_IO_DAEMON_PORT` settings

### Reconnection Strategy
- Exponential backoff: 1s, 2s, 4s, 8s, 16s, max 30s
- Max retry attempts: unlimited (keep trying forever)
- Heartbeat interval: 30 seconds

## DDP Messages

### Connection
```
→ {"msg":"connect","version":"1","support":["1"]}
← {"msg":"connected","session":"..."}
```

### Method Call
```
→ {"msg":"method","method":"passenger.check.in","params":["alice"],"id":"1"}
← {"msg":"result","id":"1","result":{...}}
← {"msg":"updated","methods":["passenger.check.in"]}
```

### Subscription
```
→ {"msg":"sub","name":"passengers","params":["all"],"id":"1"}
← {"msg":"ready","subs":["1"]}
← {"msg":"added","collection":"passengers","id":"...","fields":{...}}
```

## Methods

### `passenger.check.in`
Check in a passenger (select entity for browsing)

**Params**: `[passengerName]`

**Returns**: `{ success: true, passenger: {...} }`

### `passenger.check.out`
Check out current passenger

**Params**: none

**Returns**: `{ success: true }`

### `passenger.reload`
Force rescan of passengers from filesystem

**Params**: none

**Returns**: `{ success: true, count: N }`

## Subscriptions

### `passengers`
- **Params**: `["all"]` - all passengers
- **Params**: `["current"]` - currently selected passenger
- **Publishes**: Passenger documents from `Passengers` collection

## Error Handling

| Error Code | Description |
|------------|-------------|
| 400 | Invalid parameters |
| 403 | Authentication failed |
| 404 | Passenger not found |
| 500 | Server error |

## Data Flow

```
┌─────────────────┐     DDP      ┌─────────────────┐
│  Chrome Ext     │◄────────────►│   Daemon        │
│                 │              │                 │
│  - Background   │              │  - MongoDB      │
│  - Popup        │              │  - DDP Server   │
│  - Content      │              │  - File Scanner │
└─────────────────┘              └─────────────────┘
```

## Implementation Files

- Background script: `dist/background/ddp-connection.js`
- Popup logic: `dist/panes/popup/logic.js`
- Content script: `dist/workers/*/ddp.js`
