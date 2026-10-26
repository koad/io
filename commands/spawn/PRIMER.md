<!-- SPDX-License-Identifier: CC0-1.0 -->

# PRIMER — `~/.koad-io/commands/spawn/`

> Deploy a skeleton into the current directory.

## What this does

`spawn` deploys a skeleton into the current directory:

- **`spawn <skeleton>`**: copies a skeleton from `~/.koad-io/skeletons/<skeleton>/` into the current directory, running pre-install, install, and post-install control scripts if present.

## Invocation

```bash
<entity> spawn <skeleton>                  # Deploy a skeleton to the current directory
```

## What it expects

- `~/.koad-io/skeletons/<name>/` must exist (or one in `${CWD}/skeletons`, an entity's `skeletons/`, or `~/.forge/skeletons` — first match wins)

## Notes

- Skeletons run `control/pre-install`, `control/install`, `control/post-install` if present — check the skeleton for side effects before deploying.
