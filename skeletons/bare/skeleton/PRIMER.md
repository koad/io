# Project Primer

> This workspace was spawned from the `bare` skeleton. It is a koad:io Meteor application.

## Structure

```
.env                    # Cascade config: port, app name, build type
config/
  <hostname>.json       # Meteor settings (per-device)
src/
  .meteor/              # Meteor runtime
  both/router.js        # Shared routes
  client/
    templates.html      # Blaze templates
    styles.css           # Styles
    logic.js             # Client-side application logic
  public/               # Static assets
builds/                 # Built bundles (created by build command)
logs/                   # Build and runtime logs
```

## How to start it

Always invoke through the entity launcher. Never run `meteor` directly — the cascade loads ports, bind addresses, database URLs, settings, and identity context that raw commands don't have.

```bash
# From this directory:

# Production (from built bundle):
<entity> start

# Local development (Meteor compiler, hot reload):
<entity> start --local

# Local dev, stay attached to screen (see output live):
<entity> start --local --attach
```

Replace `<entity>` with whoever is working here (e.g. `vulcan start --local`).

## Screen lifecycle

The `start` command runs inside a `screen` session. The screen name is derived from this directory path.

```bash
# Check if running:
screen -list

# Attach to watch output:
screen -r <screen-name>

# Stop the server:
screen -S <screen-name> -X quit

# Restart (kill + re-invoke through the launcher):
screen -S <screen-name> -X quit && <entity> start --local
```

## Logs

Runtime output is piped to `builds/latest/<timestamp>.log`:
```bash
tail -f builds/latest/*.log
```

## Configuration

- **Port, app name, build type:** `.env` in this directory (loaded by the cascade)
- **Meteor settings:** `config/<hostname>.json` (auto-selected by hostname)
- **Secrets:** `.credentials` (gitignored, loaded by the cascade if present)

## The cascade is load-bearing

The entity launcher runs an environment cascade before any command executes: framework `.env` -> entity `.env` -> project `.env` -> command `.env`. Every variable is resolved from this chain. Bypassing it (running `meteor` or `node main.js` directly) skips identity context, port bindings, database URLs, and settings. If something needs restarting, kill the managed process and re-invoke through the launcher.

## What's next

This is a bare skeleton. Add your templates, routes, styles, and logic. The `.env` has a random port assigned — adjust if needed. Create a `PRIMER.md` update as the project takes shape so the next entity (or future you) knows what this became.
