<!-- SPDX-License-Identifier: CC0-1.0 -->

# PRIMER — `~/.koad-io/commands/init/`

> State-aware idempotent entity init — the unified entry point for cloning, migrating, and re-seeding entities.

## What this does

`init` is a **namespace**: `init sovereign` | `init entity <name>` | `init kingdom`.
The three are peers; none of them is the default reading of whatever word follows
`init`.

`koad-io init entity <name>` detects the current state of the entity directory and
takes the minimal necessary action to bring it to a fully initialized SPEC-175
shape. It replaces the legacy `migrate-entity` command.

`koad-io init sovereign` delegates to `init/sovereign/command.sh`.
`koad-io init kingdom` delegates to `init/kingdom/command.sh`.

## Invocation

```bash
koad-io init entity <name>              # Detect state, act accordingly
koad-io init entity <name> <url>        # Clone entity repo, then state-detect
koad-io init entity <name> --forceful   # Force re-run / key rotation
koad-io init entity <name> --adopt      # Adopt the on-disk entity key (explicit)
koad-io init entity <name> --re-seed    # Ignore the on-disk key; mint a fresh one
koad-io init sovereign                  # Kingdom genesis — see init/sovereign/
koad-io init kingdom                    # Garden bootstrap from a chain URI

koad-io init <name>                     # Compatibility: same path as `init entity`
```

A word that looks like a namespace (`init soverign`) is an error, not an entity.

## State machine

| State | Condition | Action |
|-------|-----------|--------|
| 1 | Dir missing + URL given | `git clone <url>` → state detect |
| 2 | Dir missing + no URL | Error: redirect to `gestate` or pass URL |
| 3 | Dir present + legacy keys | Migrate to SPEC-175 (archive legacy, generate entity keypair + leaf, sign sigchain) |
| 4/5 | Dir present + no keys / partial SPEC-175 | Re-seed: generate entity keypair + device leaf |
| 6 | Dir present + full SPEC-175 on this device | "All set" — optionally warn on missing sigchain entry |
| 7 | SPEC-175 entity key present + no leaf for THIS device **and paternity proven** | Secondary device adoption: generate leaf only |

### Paternity gate (state 7 only)

Presence of `id/entity.public.asc` proves nothing — a template can ship its author's
public key. State 7 is honoured only when this sovereign's sigchain holds a
`koad.entity.genesis` naming the handle **and** the entity key fingerprint.

| paternity | action |
|---|---|
| proven | `secondary-device` — mint this device's leaf |
| disproven (different key, or never gestated by this sovereign) | `re-seed`: fresh keypair; displaced material archived to `id/archive/foreign-key-<ts>/` |
| unverifiable (no sovereign, empty/unreadable chain) | **nothing generated**, prints state + reason, **exit 2**, requires `--adopt` or `init sovereign` |

"Unverifiable" is not "disproven": a chain that recorded nothing cannot testify that
a key is foreign, and absence must never license a key rotation.

After any state resolution, `init` always ensures:
- Launcher at `~/.koad-io/bin/<entity>`
- `.env` scaffolded from kingdom defaults if missing
- `AGENTS.md` regenerated from `KOAD_IO.md → ENTITY.md → PRIMER.md`

## Pre-conditions

- `~/.koad-io/me/` must exist — run `koad-io init sovereign` first. Without it the
  paternity gate cannot run, and `init` stops (exit 2) instead of guessing.
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
