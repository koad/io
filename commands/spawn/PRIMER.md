<!-- SPDX-License-Identifier: CC0-1.0 -->

# PRIMER — `~/.koad-io/commands/spawn/`

> Deploy a skeleton into a declared target directory.

## What this does

- **`spawn <skeleton>`**: copies a skeleton into `$PWD`, running pre-install, install, and post-install control scripts if present.
- **`spawn <skeleton> --into <path>`**: the same, into a named directory (created if absent).

The write root is `--into` or `$PWD` — never an inherited `DATADIR`, never `CWD`
(VESTA-SPEC-243 §2.6). The target must be empty or declare itself in `./.env` with
`KOAD_IO_TYPE` / `KOAD_IO_APP_NAME`; anything else is refused with exit 64.

## Invocation

```bash
<entity> spawn <skeleton>                       # Deploy into the current directory
<entity> spawn <skeleton> --into ~/dev/app      # Deploy into a named directory
<entity> spawn <skeleton> --force               # Override the declaration rule only
<entity> spawn list                             # Show skeleton roots
```

## What it expects

- `~/.koad-io/skeletons/<name>/` must exist (or one in `${CWD}/skeletons`, an entity's `skeletons/`, or `~/.forge/skeletons` — first match wins)

## Notes

- Skeletons run `control/pre-install`, `control/install`, `control/post-install` if present — check the skeleton for side effects before deploying.
- Every merge is announced before it happens (`will overwrite N existing paths`), and a target's `.env` is written as `.env.skeleton` instead of being replaced (§2.8).
