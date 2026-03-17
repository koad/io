# Feature: DDP Connection

## Summary
The passenger extension maintains a real-time DDP (Distributed Data Protocol) connection with the local koad:io daemon, enabling instant communication and data synchronization.

## Problem
The browser operates in isolation from the local kingdom. Users need their browsing activity to be visible to their entities and vice versa - requiring real-time, bidirectional communication.

## Solution
DDP connection provides:
- Persistent WebSocket connection to daemon
- Real-time data push from daemon to browser
- Reactive updates when entity state changes
- Automatic reconnection on network interruptions
- Efficient binary data transfer

## Implementation
- Uses Meteor DDP protocol over WebSocket
- Connects to `$KOAD_IO_BIND_IP:9568` by default
- Maintains subscription to passenger registry
- Methods available for entity check-in/out
- Listens for real-time events from entities

## Settings
- `KOAD_IO_BIND_IP`: Daemon IP (default: localhost)
- `KOAD_IO_DAEMON_PORT`: Daemon port (default: 9568)
- Auto-reconnect with exponential backoff

## Status
- [x] Implemented

## Related Features
- Feature: 002-entity-selector.md
- Feature: 006-entity-automations.md
