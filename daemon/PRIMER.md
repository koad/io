# koad:io Daemon — Primer

> The kingdom's long-running backbone. Not an entity — a framework service.

## What this is

The daemon is a Meteor 3.4 application that runs at the framework level. It provides process management, entity state, peer networking, sponsor sync, and the operator dashboard. It is the central hub for viewing, managing, and orchestrating all entities in the kingdom.

## How to start it

```bash
# From anywhere — the start command uses DATADIR from the cascade:
koad-io start

# Or explicitly:
cd ~/.koad-io/daemon
koad-io start
```

**No entity.** The daemon is invoked as `koad-io`, not `<entity>`. It is framework infrastructure, not entity work. The `.env` here sets `KOAD_IO_TYPE=daemon`.

**Never run `meteor` directly.** The `koad-io start` command runs the environment cascade (framework `.env` → daemon `.env` → config), resolves ports, bind addresses, and settings, then launches inside a screen session. Bypassing the cascade skips all of this.

## Screen lifecycle

```bash
# Check if running:
screen -list | grep koad-io

# Attach to watch output:
screen -r <screen-name>

# Stop:
screen -S <screen-name> -X quit

# Restart:
screen -S <screen-name> -X quit && koad-io start
```

## Logs

Runtime output is piped to `logs/<timestamp>.log`:
```bash
tail -f ~/.koad-io/daemon/logs/*.log
```

## Configuration

| File | Purpose |
|------|---------|
| `.env` | Port (28282), bind IP (127.0.0.1), app name, MONGO_URL |
| `config/<hostname>.json` | Meteor settings (per-device) |

## Current state

- **MONGO_URL=false** — runs with in-memory collections (no external Mongo required)
- **Bind:** `127.0.0.1:28282` (localhost only — never exposed)
- **Meteor 3.4** on Node

## Structure

```
.env                        # Cascade config
config/<hostname>.json      # Meteor settings
src/
  .meteor/                  # Meteor runtime
  server/
    clicker.js              # Process management
    passenger-api.js        # Dark Passenger API
    passenger-methods.js    # Passenger DDP methods
  client/
    templates.html          # Dashboard UI
    styles.css              # Dashboard styles
    application-logic.js    # Client logic
  public/                   # Static assets
builds/                     # Production bundles
logs/                       # Runtime logs
scripts/                    # Maintenance scripts
features/                   # Feature specs
```

## What it does

- **Entity state** — tracks all entities, their health, last activity
- **Process management** — spawn, monitor, restart entity harness sessions
- **Dark Passenger** — worker system for background entity tasks
- **Peer networking** — ZeroTier-based entity-to-entity mesh (planned)
- **Sponsor sync** — GitHub Sponsors API integration (planned)
- **Dashboard** — operator PWA for the kingdom view

## What it is not

- Not an entity. No ENTITY.md, no trust bonds, no identity.
- Not invoked with an entity name. `koad-io start`, not `juno start`.
- Not the place for entity-specific logic. Entity behavior lives in entity hooks and commands.
