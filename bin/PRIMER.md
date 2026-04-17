# PRIMER: bin/

## What is this directory?

The executable launchers for koad:io entities. Each file in this directory is a thin wrapper script that sets the `ENTITY` environment variable and delegates to the `koad-io` CLI. Adding `~/.koad-io/bin` to your `PATH` gives you per-entity commands.

## What does it contain?

One script per entity, plus:

- `koad-io` — The main framework CLI. Central entry point for all framework operations.
- `entity` — Template script. Copied and renamed during entity gestation to produce a new per-entity launcher.
- One file per known entity (`juno`, `alice`, `vulcan`, `livy`, `salus`, etc.) — each sets `ENTITY=<name>` and calls `koad-io "$@"`.
- `README.md` — Overview of the bin pattern.

## Who works here?

Salus adds a new launcher here whenever a new entity is gestated. Vulcan maintains the `koad-io` and `entity` scripts. Entities themselves do not modify this directory.

## What to know before touching anything?

These scripts are intentionally minimal — all logic lives in `koad-io` itself. Do not add business logic here. Adding `~/.koad-io/bin` to `PATH` is the standard install step; the entity launchers only work after this. When gestating a new entity, the `entity` template script is copied to the entity's name — that copy-rename step is what Salus automates. Do not modify individual entity launchers by hand; re-gestating is cleaner.
