<!-- SPDX-License-Identifier: CC0-1.0 -->

# PRIMER — `~/.koad-io/commands/deploy/`

> Deploy a built koad:io application — locally, to a service, site, or lighthouse worker.

## What this does

`deploy` extracts and links a built tarball from `builds/latest/src.tar.gz`, compiles npm dependencies, and rotates the `builds/latest` symlink to the new bundle. Sub-commands handle different deployment targets.

## Invocation

```bash
<entity> deploy              # Deploy using locally.sh (default path)
<entity> deploy interface    # Deploy the interface component
<entity> deploy service      # Deploy as a background service
<entity> deploy site         # Deploy the site
```

## Sub-commands

| Sub-command | Purpose |
|-------------|---------|
| `locally.sh` | Extract tarball, compile npm deps, link `builds/latest` |
| `interface/command.sh` | Deploy the interface component |
| `service/command.sh` | Deploy as a managed service |
| `site/command.sh` | Deploy the site |
| `lighthouse.sh` / `worker.sh` | Lighthouse worker deployment |

## What it expects

- `$DATADIR/builds/latest/src.tar.gz` — a built tarball from `<entity> build`
- `npm`, `node` — available on PATH
- Workspace `.env` sourced (calls `assert/datadir`)

## Notes

- Deploy archives the previous tarball to `$DATADIR/archive/` before rotating.
- Must run `<entity> build` first — deploy does not build from source.
- After deploy, use `<entity> start` to launch the application.
