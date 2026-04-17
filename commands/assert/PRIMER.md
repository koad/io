<!-- SPDX-License-Identifier: CC0-1.0 -->

# PRIMER — `~/.koad-io/commands/assert/`

> Assertion helpers — sourced by other commands to validate preconditions before proceeding.

## What this directory is

`assert/` contains sub-commands that act as guards. They are sourced (not exec'd) into calling commands to validate workspace state. A failed assertion prints a diagnostic and exits with an error code before the main command does any work.

## Sub-commands

| Sub-command | Purpose |
|-------------|---------|
| `datadir/command.sh` | Assert the current working context resolves to a valid koad:io workspace (`DATADIR`); sources `.env` and `.credentials` if found |

## How it's used

Commands that depend on a valid `DATADIR` source the assert directly:

```bash
source "$HOME/.koad-io/commands/assert/datadir/command.sh"
# After this line: $DATADIR, $KOAD_IO_TYPE, $LOCAL_BUILD are resolved
```

`assert/datadir` resolves `DATADIR` from positional args, entity dir structure, or the current working directory — in that order. It exits 64 if no valid workspace is found.

## Exit codes

- `64` — usage error / no valid workspace found

## Notes

- These are not invoked as `<entity> assert ...` — they are implementation details for other commands.
- `build`, `start`, `stop`, `restart`, and `deploy` all source `assert/datadir` before doing any work.
