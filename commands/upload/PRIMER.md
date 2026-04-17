<!-- SPDX-License-Identifier: CC0-1.0 -->

# PRIMER — `~/.koad-io/commands/upload/`

> Transfer a file or folder to a remote host using the entity's SSH key.

## What this does

`upload` uses `scp` with the entity's SSH key (`id/ed25519` or `id/rsa`) to transfer a file or directory to a remote host. Optionally creates the destination directory on the remote if it doesn't exist.

## Invocation

```bash
<entity> upload <file> <remote>:<path>
<entity> upload --mkdir <file> <remote>:/path/to/new/dir/filename.ext
```

## Examples

```bash
juno upload ./bundle.tar.gz wonderland:/home/juno/deploys/bundle.tar.gz
juno upload --mkdir ./assets/ prod-server:/var/www/html/assets/
```

## What it expects

- `scp` and `stat` — available on PATH
- `$ENTITY_DIR/id/ed25519` or `$ENTITY_DIR/id/rsa` — entity SSH key must exist
- The remote host must accept connections from the entity's SSH key

## Sub-commands

`upload/` also contains sub-commands for uploading specific components:

| Sub-command | Purpose |
|-------------|---------|
| `interface/command.sh` | Upload the interface component |
| `service/command.sh` | Upload as a managed service |
| `site/command.sh` | Upload site files |
| `lighthouse.sh` / `worker.sh` | Lighthouse worker upload |

## Notes

- Remote user is set to `$KOAD_IO_INSTANCE` (lowercase `$ENTITY`).
- `--mkdir` checks if the remote directory exists before creating it.
- Exit 1 if no SSH key is found; exit 1 on transfer failure.
