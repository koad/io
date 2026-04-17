<!-- SPDX-License-Identifier: CC0-1.0 -->

# PRIMER — `~/.koad-io/commands/build/`

> Compile a Meteor application from source into a deployable bundle.

## What this does

`build` runs `meteor build` against the source in `$DATADIR/src/`, producing a timestamped output under `$DATADIR/builds/<timestamp>/`. A `builds/latest` symlink is updated to point at the new build. Requires a running Meteor installation.

## Invocation

```bash
<entity> build              # Build tarball (production — src.tar.gz)
<entity> build local        # Build local directory bundle (dev/staging)
```

Or from within the workspace directory:

```bash
cd ~/.koad/daemon && koad build
```

## What it expects

- `KOAD_IO_BIND_IP`, `KOAD_IO_PORT`, `KOAD_IO_APP_NAME`, `KOAD_IO_TYPE` — set in workspace `.env`
- `$DATADIR/src/` — Meteor application source
- `meteor` — available on PATH

## What it produces

- `$DATADIR/builds/<datetime>/src.tar.gz` (default tarball mode)
- `$DATADIR/builds/<datetime>/bundle/` (with `--local`/`local` flag)
- `$DATADIR/builds/latest` — symlink updated to point at the newest build

## Notes

- `LOCAL_BUILD=true` triggers `meteor build --directory` instead of tarball; npm deps are compiled in place.
- Exit 64 if required env vars are missing.
- Build time is printed on completion.
