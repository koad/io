<!-- SPDX-License-Identifier: CC0-1.0 -->

# PRIMER — `~/.koad-io/commands/init/`

> Register an entity wrapper command — the final step of entity setup.

## What this does

`init` creates the thin wrapper script at `~/.koad-io/bin/<entity>` that sets `ENTITY=<name>` and delegates to `koad-io`. After `init`, typing `<entity> <cmd>` works as a first-class shell command.

## Invocation

```bash
koad-io init <entityname>              # Register wrapper for entity at ~/.<entityname>/
koad-io init <entityname> --forceful   # Overwrite existing wrapper without error
koad-io init                           # Use current directory name as entity name
```

## What it expects

- `~/.<entityname>/` directory must exist
- `~/.<entityname>/.env` file must exist
- The directory must pass the entity folder check (score ≥ 2 known dirs: `.local`, `commands`, `skeletons`, `desktop`, `extension`, `daemon`) — unless `--forceful` is used

## What it produces

- `~/.koad-io/bin/<entityname>` — executable wrapper script

## Notes

- `gestate` calls `init` automatically at the end of entity creation. You only need to run `init` manually if you're registering an entity that was cloned or restored rather than gestated.
- Use `--forceful` if the entity wrapper already exists and you want to overwrite it.
- Exit 64 on missing directory, missing `.env`, or existing wrapper (without `--forceful`).
