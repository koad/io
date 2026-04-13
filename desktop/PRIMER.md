# koad:io Desktop — Primer

> The operator's local surface. Not an entity — framework infrastructure.

## What this is

The desktop app is an Electron shell + Meteor interface that provides the local operator UI: taskbar widget, entity management, quick launch, DDP connection to the daemon. It runs at the framework level — any entity can start it, none of them own it.

## How to start it

```bash
# From anywhere:
koad-io start

# Or explicitly:
cd ~/.koad-io/desktop
koad-io start
```

**No entity.** The desktop is invoked as `koad-io`, not `<entity>`. It is framework infrastructure. Any entity can trigger it on the user's behalf, but the cascade runs entity-free — kingdom `.env` only.

**Never run `npm start` or `electron .` directly.** The `koad-io start` command runs the environment cascade, resolves ports and settings, then launches. Bypassing the cascade skips identity context and configuration.

## Configuration

| File | Purpose |
|------|---------|
| `.env` | Port (44124) |
| `config/<hostname>.json` | Settings (per-device) |

## Structure

```
.env                    # Cascade config (port only)
src/
  main.js               # Electron entry point
  windows/              # Electron window management
  menus/                 # Application menus
  system/                # System tray, shortcuts
  lighthouse-connect.js  # DDP connection to daemon
  library/               # Shared utilities
  groove-basin/          # Media integration
resources/               # App icons, assets
config/                  # Per-device settings
commands/                # Desktop-specific commands
```

## Relationship to other infrastructure

- **Daemon** (`~/.koad-io/daemon/`) — the desktop connects to the daemon via DDP. The daemon is the state backend; the desktop is the local UI.
- **Interface** (`~/.koad-io/interface/`) — the Meteor app that renders inside the Electron shell.
- **Entities** — the desktop manages and launches them. It is not one of them.

## What it is not

- Not an entity. No ENTITY.md, no trust bonds, no identity.
- Not invoked with an entity name. `koad-io start`, not `juno start`.
- Not the daemon. The daemon runs headless on any box. The desktop runs where a human sits.
