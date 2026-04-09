# Feature: Stateless Hub

## Summary
The daemon runs in-memory only (`MONGO_URL=false`) with no persistent state of its own. It connects dynamically to entity daemons that hold their own databases. The framework daemon is a hub, not a store.

## Problem
A central daemon with its own persistent database creates a single point of failure and a security concern — all entity data colocated. If the daemon goes down, state is lost or stale.

## Solution
The framework daemon runs stateless with fixtured in-memory collections:
- `MONGO_URL=false` triggers `{connection: null}` on all koad:io-core collections
- Entity daemons (`~/.entity/daemon/`) each run their own Mongo for persistent state
- The framework daemon discovers and connects to entity daemons dynamically via DDP
- Hub can restart at any time with zero data loss — entities hold the truth

## Architecture
```
~/.koad-io/daemon (in-memory, hub, 127.0.0.1)
  ├── connects to entity daemons via DDP
  ├── routes orchestration calls
  └── holds only ephemeral session state
```

## Entity Daemon Pattern
Any entity needing persistent state runs its own daemon:
- `~/.entity/daemon/.env` with real `MONGO_URL`
- Own screen session (`entity-daemon`)
- Own Meteor REPL via `entity shell`
- Security boundary is per-entity, per-database

## Settings
- `MONGO_URL=false` in `~/.koad-io/daemon/.env`
- Entity daemons set their own `MONGO_URL` independently

## Status
- [ ] Blocked — koad:io-core MONGO_URL=false string comparison bug (upstart.js)

## Related Features
- Feature: 005-mongodb-management.md
- Feature: 007-passenger-registry.md
