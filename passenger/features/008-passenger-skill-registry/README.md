# Feature: Passenger & Skill Registry

## Summary

Dark Passenger fetches and displays available passengers (entities) from the daemon, along with their defined skills (buttons/actions).

## Problem

Users need to see which entities are available to ride along, and what skills/capabilities each passenger provides in the browser.

## Solution

The daemon auto-detects entities with `passenger.json` files and exposes them via DDP. Dark Passenger subscribes to the passenger list and displays them in the UI.

## Key Concepts

### Passengers
Entities that can "ride along" with you while browsing. Each passenger has:
- Name and avatar
- Skills/buttons that work on specific websites
- Optional custom DDP endpoint
- Optional custom sidebar

### Skills
Actions that passengers provide on specific websites:
- Open URLs
- Inject scripts
- Call DDP methods
- Provide augments (scripts/styles)

### Augments
Scripts and styles that passengers inject into pages:
- Scripts: JavaScript that runs in page context
- Styles: CSS that modifies page appearance

## Passenger.json

Passengers are defined by their `passenger.json` file:

```json
{
  "handle": "alice",
  "name": "Alice",
  "avatar": "avatar.png",
  "buttons": [...],
  "ddp": {...},
  "sidebar": {...}
}
```

## DDP Methods

| Method | Description |
|--------|-------------|
| `passenger.check.in` | Select a passenger |
| `passenger.check.out` | Deselect current passenger |
| `passenger.reload` | Force rescan passengers |
| `passenger.ingest.url` | Send URL to passenger |
| `passenger.get.skills` | Get skills for current site |
| `passenger.get.augments` | Get augments for current site |
| `passenger.resolve.identity` | Lookup identity for domain |
| `passenger.check.url` | Check for domain warnings |
| `passenger.summarize` | Summarize page content |

## Status

See [progress.md](./progress.md) for detailed implementation status.

## Related Features

- Feature: 001-ddp-connection.md
- Feature: 002-entity-selector.md
- Feature: 007-chrome-extension-ui.md
