<!-- SPDX-License-Identifier: CC0-1.0 -->

# PRIMER — `~/.koad-io/commands/restart/`

> Stop the running application and start it again — a graceful stop+start in one command.

## What this does

`restart` calls `stop` then `start` in sequence. If the application is not currently running, `stop` exits 0 and `start` proceeds normally. Flags are passed through to `start`.

## Invocation

```bash
<entity> restart              # Stop (if running) then start
<entity> restart --local      # Restart in local/dev mode
<entity> restart --attach     # Restart and attach to the screen session
```

## What it expects

Same as `start` — requires a valid `DATADIR` with `.env` containing `KOAD_IO_BIND_IP`, `KOAD_IO_PORT`, `KOAD_IO_APP_NAME`, `KOAD_IO_TYPE`.

## Notes

- If `stop` fails with a non-zero exit (not "not running"), restart aborts rather than starting with a potentially broken state.
- "Not running" from `stop` is treated as success — `restart` is safe to call on a cold application.
- Do not kill Meteor processes manually and skip `restart` — this causes 502s across the subdomain surface. Always use `restart` or the entity launcher.
- Uses `screen` sessions named from the `DATADIR` path.
