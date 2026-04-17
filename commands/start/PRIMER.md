<!-- SPDX-License-Identifier: CC0-1.0 -->

# PRIMER — `~/.koad-io/commands/start/`

> Start a koad:io application — production bundle or Meteor dev server — inside a named screen session.

## What this does

`start` launches a koad:io application in a detached `screen` session. It detects whether a built bundle (`builds/latest/bundle/main.js`) or a Meteor source tree (`src/.meteor/release`) is present and uses the appropriate launch method. Checks for MongoDB availability before starting if `DB_HOST`/`DB_PORT` are set.

## Invocation

```bash
<entity> start              # Start in production mode (requires built bundle)
<entity> start local        # Start Meteor dev server
<entity> start --local      # Same as above
<entity> start --attach     # Start and attach to the screen session (foreground)
```

## What it expects

- `KOAD_IO_BIND_IP`, `KOAD_IO_PORT`, `KOAD_IO_APP_NAME`, `KOAD_IO_TYPE` — from workspace `.env`
- `KOAD_IO_DOMAIN` — required for production mode (sets `ROOT_URL`)
- `MONGO_URL` — required for production mode
- `config/$HOSTNAME.json` — settings file must exist
- `screen` — available on PATH

## What it produces

- A detached screen session named from the `DATADIR` path
- Log file at `builds/latest/<datetime>.log` (production) or `logs/<datetime>.log` (local)

## Notes

- Screen session name is derived from `DATADIR`: `~/.alice/daemon` becomes `alice-daemon`.
- Already-running check: looks for existing screen session and active port before starting.
- Always use `restart` or this command to start — don't kill the process manually and skip the launcher (causes 502s across the kingdom).
- Attach to a running session: `screen -r <session-name>`
