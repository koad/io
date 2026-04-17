<!-- SPDX-License-Identifier: CC0-1.0 -->

# PRIMER — `~/.koad-io/commands/shell/`

> Open an interactive shell inside the entity's daemon environment — or a Meteor shell if a Meteor app is present.

## What this does

`shell` changes into the entity's daemon directory (or the directory specified by `KOAD_IO_SHELL_DIRECTORY`) and launches an interactive shell. If the target contains a Meteor application (`src/.meteor/release`), it opens a Meteor shell instead of a plain bash/zsh, unless `--terminal` is passed.

## Invocation

```bash
<entity> shell                    # Open Meteor shell if Meteor app found, else bash
<entity> shell --terminal         # Force a plain terminal shell, skip Meteor detection
```

Also available: `shell/mongo.sh` for a MongoDB shell (run directly, not via dispatcher).

## What it expects

- `$ENTITY_DIR/daemon/` — default shell directory (override with `KOAD_IO_SHELL_DIRECTORY` env var)
- `meteor` — if launching a Meteor shell
- `ENTITY_SHELL` — shell binary override (defaults to `$SHELL` or `/bin/bash`)

## Notes

- Set `KOAD_IO_SHELL_DIRECTORY` in the entity `.env` to change the target directory (relative to `$ENTITY_DIR`).
- Exit 1 if the target shell directory does not exist.
- `mongo.sh` is a convenience script for opening a MongoDB shell; call it directly: `bash ~/.koad-io/commands/shell/mongo.sh`.
