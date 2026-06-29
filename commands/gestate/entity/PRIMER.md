<!-- SPDX-License-Identifier: CC0-1.0 -->

# PRIMER — `~/.koad-io/commands/gestate/`

> Create a new koad:io entity — directory structure, cryptographic keys, `.env`, and wrapper command.

## What this does

`gestate` builds a new entity from scratch: creates `~/.<entity>/` with all standard subdirectories, generates SSH keys (ed25519, ecdsa, rsa, dsa), a GPG identity key, SSL elliptic curve keys, and writes a minimum `.env`. Optionally copies genes (skeletons, packages, commands) from a "mother" entity. Registers the entity wrapper command via `init` at the end.

## Invocation

```bash
<entity> gestate <name>           # Gestate a new entity (skip dhparam generation)
<entity> gestate <name> --full    # Full mode — also generates 2048- and 4096-bit dhparams (slow)
```

When run from an existing entity, that entity becomes the "mother" and its genes are cloned into the new entity.

## What it expects

- `<name>` — the new entity's name (required)
- `KOAD_IO_DOMAIN` — domain for the entity's email and identity (prompted if not set)
- `KOAD_IO_HOME_MACHINE` — hostname for the entity (defaults to current `$HOSTNAME`)
- `ssh-keygen`, `gpg`, `openssl` — available on PATH

## What it produces

- `~/.<name>/` — full entity directory tree
- `~/.<name>/id/` — SSH and GPG public/private keys
- `~/.<name>/ssl/` — elliptic curve and session keys
- `~/.<name>/.env` — minimum entity configuration
- `~/.<name>/.gitignore` — protects private keys from accidental commits
- `~/.koad-io/bin/<name>` — wrapper command that runs `koad-io` with `ENTITY=<name>`

## Notes

- Private keys are gitignored by the generated `.gitignore` — back up `~/.<name>/` offline.
- `--full` mode takes 10+ minutes for the 4096-bit dhparam. Skip it unless you need TLS with custom DH params.
- If gestating without a mother entity, no genes are cloned.
