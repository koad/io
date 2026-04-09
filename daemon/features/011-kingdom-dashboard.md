# Feature: Kingdom Dashboard

## Summary
The daemon serves a unified dashboard UI for the entire kingdom — entity health, screen sessions, passenger registry, quick-launch buttons for commands and hooks, scheduler controls. The one control room on localhost.

## Problem
Managing a multi-entity kingdom requires switching between terminals, screen sessions, logs, and individual entity UIs. There is no single view of "what's running, what's healthy, what needs attention."

## Solution
The daemon's own interface becomes the kingdom dashboard:
- Entity roster with live status (running/stopped/error)
- Screen session list with attach/tail buttons
- Passenger registry browser
- Quick-launch for any entity's commands/hooks
- Scheduler controls (add/remove/trigger tasks)
- Log viewer — tail any entity's latest log
- Served via `~/.koad-io/desktop/` as a PWA on localhost

## Architecture
- Dashboard reads from the daemon's in-memory collections (passenger registry, scheduler state)
- Connects to entity daemons via DDP for live data where needed
- Never exposed beyond 127.0.0.1
- Desktop app wraps it via `clicker.js` PWA launcher

## Opt-in
This is not part of gestation. The dashboard is available when the user is ready for it. The framework has it — the user discovers it. Same progressive disclosure as the rest of the platform.

## Status
- [ ] Not started — depends on 008-stateless-hub, 009-entity-scheduler

## Related Features
- Feature: 006-ui-serving.md
- Feature: 007-passenger-registry.md
- Feature: 009-entity-scheduler.md
- Feature: 010-meteor-shell-api.md
