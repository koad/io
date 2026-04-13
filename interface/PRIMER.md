# koad:io Interface — Primer

> The operator dashboard. Not an entity — framework infrastructure.

## What this is

The interface is the Meteor-based operator dashboard for the kingdom. Entity management, status views, administration. It renders inside the desktop Electron shell or standalone in a browser. Runs at the framework level.

## How to start it

```bash
cd ~/.koad-io/interface
koad-io start
```

**No entity.** The interface is invoked as `koad-io`, not `<entity>`. Any entity can start it on the user's behalf, but the cascade runs entity-free.

## Screen lifecycle

```bash
screen -list | grep interface
screen -r <screen-name>
screen -S <screen-name> -X quit
screen -S <screen-name> -X quit && koad-io start
```

## Logs

```bash
tail -f ~/.koad-io/interface/logs/*.log
```

## Configuration

| File | Purpose |
|------|---------|
| `.env` | Port (21220), app name, domain |
| `config/<hostname>.json` | Meteor settings (per-device) |

## Note

The `.env` currently has `KOAD_IO_INSTANCE=astro` hard-wired from before the entity model matured. This should be framework-derived, not entity-pinned. The interface serves the whole kingdom, not one entity.

## Structure

```
.env                    # Cascade config
config/<hostname>.json  # Meteor settings
src/                    # Meteor app
logs/                   # Runtime logs
```

## What it is not

- Not an entity. No identity, no bonds.
- Not the daemon. The daemon is the headless backend. The interface is the visual layer.
- Not the desktop. The desktop is the Electron shell. The interface is the Meteor app inside it.
