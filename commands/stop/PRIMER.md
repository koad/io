<!-- SPDX-License-Identifier: CC0-1.0 -->

# PRIMER — `~/.koad-io/commands/stop/`

> Stop the running application by quitting its screen session.

## What this does

`stop` finds the screen session for the current workspace (named from the `DATADIR` path, matching the naming convention in `start`) and sends a `quit` command. If the session is not running, it exits 0 cleanly. Confirms the session is gone after quitting.

## Invocation

```bash
<entity> stop              # Stop the application
```

## What it expects

- A valid `DATADIR` (from `assert/datadir`) with `.env` sourced
- `screen` — available on PATH
- The application must have been started with `<entity> start` for session name to match

## Notes

- "Not running" is not an error — exit 0 means clean state.
- Exit 1 if the screen session is still listed after the quit attempt.
- Session name is derived from `DATADIR` path: `~/.alice/daemon` → `alice-daemon`. Must match what `start` creates.
- Do not kill Meteor or Node processes directly with `kill`/`pkill`. Use `stop` to avoid 502s across the kingdom surface.
