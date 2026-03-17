# Feature: UI Serving

## Summary
The daemon serves the user interface for the koad:io desktop application and provides administration Progressive Web App (PWA) pages for managing the ecosystem.

## Problem
Users need to interact with their koad:io kingdom through a visual interface. The desktop app and admin tools need a central server to serve their UI assets.

## Solution
The daemon provides UI serving capabilities:
- Serves the Electron desktop widget UI
- Provides admin PWA pages for system management
- Handles HTTP and WebSocket connections
- Supports real-time updates via DDP

## Implementation
- Built on Meteor/WebApp infrastructure
- Serves static assets from `src/public/`
- Provides API endpoints for desktop and admin interfaces
- WebSocket support via DDP protocol

## Settings
- `KOAD_IO_PORT`: Port for daemon HTTP server (default: 9568)
- `KOAD_IO_BIND_IP`: IP address to bind to (default: 127.0.0.1)

## Status
- [x] Implemented

## Related Features
- Feature: 004-process-management.md
