# Feature: Passenger Settings

## Summary

UI for managing which passengers are active and which websites their skills run on.

## Problem

Users need to control which entities (passengers) are enabled and which of their skills are active on different websites.

## Solution

A settings page in the extension where users can:
- View all available passengers
- Enable/disable each passenger globally
- Configure per-site permissions
- Manage skill execution rules

## Storage

Uses Chrome's `storage.sync` to persist settings.

## Key Settings

| Setting | Description |
|---------|-------------|
| `passengers[].enabled` | Global on/off for passenger |
| `passengers[].sites` | Per-site permissions |
| `passengers[].skills` | Per-skill toggles |
| `passengers[].sidebar` | Sidebar settings & priority |
| `global.autoEnableNewPassengers` | Auto-enable new passengers |
| `global.showNotifications` | Notification preferences |

## Status

See [progress.md](./progress.md) for detailed implementation status.

## Dependencies

- Feature: 008-passenger-skill-registry
- Feature: 007-chrome-extension-ui
