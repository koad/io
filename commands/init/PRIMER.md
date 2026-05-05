<!-- SPDX-License-Identifier: CC0-1.0 -->

# PRIMER — `~/.koad-io/commands/init/`

> State-aware idempotent entity init — the unified entry point for cloning, migrating, and re-seeding entities.

## What this does

`koad-io init <entity>` detects the current state of the entity directory and takes the minimal necessary action to bring it to a fully initialized SPEC-175 shape. It replaces the legacy `migrate-entity` command.

`koad-io init sovereign` delegates to `init/sovereign/command.sh` — unchanged.

## Invocation

```bash
koad-io init <name>                     # Detect state, act accordingly
koad-io init <name> <url>               # Clone entity repo, then state-detect
koad-io init <name> --forceful          # Force re-run / key rotation
koad-io init sovereign                  # Kingdom genesis — see init/sovereign/
```

## State machine

| State | Condition | Action |
|-------|-----------|--------|
| 1 | Dir missing + URL given | `git clone <url>` → state detect |
| 2 | Dir missing + no URL | Error: redirect to `gestate` or pass URL |
| 3 | Dir present + legacy keys | Migrate to SPEC-175 (archive legacy, generate entity keypair + leaf, sign sigchain) |
| 4/5 | Dir present + no keys / partial SPEC-175 | Re-seed: generate entity keypair + device leaf |
| 6 | Dir present + full SPEC-175 on this device | "All set" — optionally warn on missing sigchain entry |
| 7 | SPEC-175 entity key present + no leaf for THIS device | Secondary device adoption: generate leaf only |

After any state resolution, `init` always ensures:
- Launcher at `~/.koad-io/bin/<entity>`
- `.env` scaffolded from kingdom defaults if missing
- `AGENTS.md` regenerated from `KOAD_IO.md → ENTITY.md → PRIMER.md`

## Pre-conditions

- `~/.koad-io/me/` must exist — run `koad-io init sovereign` first
- `~/.koad-io/me/id/devices/$HOSTNAME/leaf.private.asc` must exist — run `koad-io init sovereign` on this device first

## Files in this directory

| File | Purpose |
|------|---------|
| `command.sh` | Main entry point — routing + state machine |
| `ceremony.mjs` | SPEC-175 entity key ceremonies (generate-entity, verify-leaf, sign-entity-entries, get-leaf-fingerprint) |
| `test-leaf-signing.mjs` | Tests for ceremony.mjs leaf signing |
| `sovereign/` | Sovereign genesis subcommand — untouched |

## Ref

- VESTA-SPEC-175 §6 — entity key shape and migration steps
- VESTA-SPEC-149 — master/leaf split; master is paper-only after genesis
