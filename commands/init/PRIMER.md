<!-- SPDX-License-Identifier: CC0-1.0 -->

# PRIMER — `~/.koad-io/commands/init/`

> State-aware idempotent entity init — the unified entry point for cloning, migrating, and creating or succeeding an entity's key.

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
koad-io init entity <name> --forceful   # Rotate what is mine: succession (new key + leaf)
koad-io init entity <name> --adopt      # Adopt the on-disk key — only when paternity is not disproven
koad-io init entity <name> --re-seed    # Replace a key that is NOT this handle's key
koad-io init sovereign                  # Kingdom genesis — see init/sovereign/
koad-io init kingdom                    # Garden bootstrap from a chain URI

koad-io init <name>                     # Compatibility: same path as `init entity`
```

A word that looks like a namespace (`init soverign`) is an error, not an entity.

None of the three flags means "mint a second genesis." See
[`--re-seed` is not a second genesis](#--re-seed-is-not-a-second-genesis).

## State machine

Four states, detected from the filesystem alone — a flag never chooses the state. (A
missing directory is not a matrix state: with a URL it is cloned first, and without one
it is an error pointing at `gestate` or at a URL.)

| State | Condition (filesystem) | Baseline action |
|-------|------------------------|-----------------|
| **3 — migrate** | `id/` holds legacy keys, no `id/entity.public.asc` | Migrate to SPEC-175: archive legacy material, mint entity key + device leaf, file the key event |
| **4/5 — create** | no entity key, no leaf for this host | Mint entity key + device leaf |
| **6 — all-set** | `id/entity.public.asc` present **and** a leaf for this host | Report; audit paternity and leaf epoch; no mutation |
| **7 — secondary-device** | `id/entity.public.asc` present, no leaf for this host | Paternity gate, then adopt the key or replace it |

### The matrix — four states × three flags (SPEC-240 §13)

Every cell emits one leading line,

```
[init] <state>/<flag>: <verb> — <what happened>
```

with `<verb>` one of `did` (the intent was carried out, and the line says what changed),
`no-op` (nothing needed doing, and the line names the flag), `warned` (done, with a
condition the operator must know), or `refused` (exit 2, nothing written, names the reason
and the command that would work). No cell is silent, and no flag is accepted and discarded.

| | `--forceful` | `--adopt` | `--re-seed` |
|---|---|---|---|
| **3 — migrate** | `did` — migration proceeds; there is no SPEC-175 key to rotate and the line says so. Key event: genesis, or **succession** if the chain already resolves a key for the handle. | `refused` — there is no `entity.public.asc` to adopt. Legacy keys are migrated, not adopted. | `did` — migration proceeds; there is no SPEC-175 key to ignore and the line says so. Same key-event rule as `--forceful`. |
| **4/5 — create** | `did` — there is nothing on disk to rotate; creation proceeds. Key event: genesis, or **succession** if the chain already resolves a key for the handle. | `refused` — there is nothing on disk to adopt, and minting fresh material would silently contradict the flag. | `did` — creation proceeds; there is nothing to ignore. |
| **6 — all-set** | `did` — **rotation is succession**: archive the live key, mint a new key + device leaf, file `koad.entity.key-succession`, then `leaf-authorize` for the new leaf and `leaf-revoke` for the replaced one. Files **no genesis**. | `no-op` — a leaf already exists for this device. `warned` instead when paternity is `disproven` or `unverifiable`, and nothing changes either way. | `proven` → `refused`, naming `--forceful`: the chain says this key *is* the handle's, so "not mine" contradicts it. `disproven` → `did`: succession from the chain's effective key to a fresh one; the on-disk key is archived as foreign. `unverifiable` → `refused`: absence is not disproof. |
| **7 — secondary-device** | `did` — rotation and onboarding in one act: succession, archive, mint this device's leaf, `leaf-authorize`. Files **no genesis**. | `proven` → `did`: the key event is already in the chain, so none is filed; the remaining work (this device's leaf + `leaf-authorize`) is done. `unverifiable` → `warned`: a leaf is minted under a key the chain cannot trace, and nothing is filed for it. `disproven` → `refused`. | `proven` → `refused`, naming `--forceful`. `disproven` → `did`: succession. `unverifiable` → `did`: **genesis, not succession** — the chain holds no key-affecting entry for this handle, so this is creation on a directory that inherited a face, and the inherited key is archived as foreign. |

Two or more of the three flags in one invocation are `refused`, exit 2, with every flag
named. The three are distinct intents — *rotate what is mine*, *adopt what is not*,
*replace what is not* — and no precedence order exists between them.

Exit codes: `0` for `did` / `no-op` / `warned`, `2` for a protocol refusal, `1` reserved
for tooling failure (missing `node`, unreadable disk) and never used for a refusal.

### `--re-seed` is not a second genesis

SPEC-240 §4, in its own words:

> `--re-seed` on an entity that is already genesis'd in the chain is not a re-seed at
> all. It is either a succession (the entity continues) or a refusal (the evidence does
> not support the operator's belief). It is never a second genesis.

`koad.entity.genesis` records creation, once per handle per sovereign chain; a later key
change is `koad.entity.key-succession`. `--forceful` never files a second genesis either.
Whether a given `--re-seed` is creation, succession, or a refusal is decided by what the
chain can say about the handle — not by the flag.

### Rotation and replacement are sovereign acts

Creation may be provisional. With no sovereign, states 4/5 and state 7 `--re-seed` under
`unverifiable` mint the entity key and this device's leaf, write `id/provisional.json`,
and defer the genesis and its `leaf-authorize` to countersignature.

Everything else — a succession, a replacement, a `leaf-authorize` for a handle the chain
already owns — is signed by the sovereign's device leaf. Without a sovereign that cell is
`refused`: exit 2, **nothing written**, and the line names `init sovereign` and the exact
command that would work instead. A single-box kingdom with no sovereign can create an
entity and can never change one; that is the model, not a limitation to work around.

The discriminator is resolution, not the state and not the flag: a chain that already
resolves an effective key for the handle makes the next key event a succession, whatever
the cell.

### Paternity (states 6 and 7)

Paternity is a chain fact about the **effective** key, not a disk fact. The presence of
`id/entity.public.asc` proves nothing on its own — a template can ship its author's
public key.

| paternity | meaning | what it licenses |
|---|---|---|
| `proven` | the disk key **is** the chain's effective key for this handle | adopt the key: mint this device's leaf, file `leaf-authorize` |
| `disproven` | the chain resolves a **different** key | replace it — a succession from the effective key, with the on-disk key archived to `id/archive/foreign-key-<ts>/` |
| `unverifiable` | no sovereign, absent/unreadable/empty chain, no key-affecting entry for this handle, or an unreadable disk key | nothing is guessed: the state-7 baseline is `refused` (exit 2), naming `--adopt`, `--re-seed`, and `init sovereign` |

"Unverifiable" is not "disproven": a chain that recorded nothing cannot testify that a
key is foreign, and absence must never license a key rotation.

After any state resolution, `init` always ensures:
- Launcher at `~/.koad-io/bin/<entity>`
- `.env` scaffolded from kingdom defaults if missing
- `AGENTS.md` regenerated from `KOAD_IO.md → ENTITY.md → PRIMER.md`

## Pre-conditions

- `~/.koad-io/me/` and a device leaf for this host are what let `init` **sign**. Without
them, creation (states 4/5, and state 7 `--re-seed` under `unverifiable`) proceeds
provisionally and nothing is filed in the chain; succession, replacement and
`leaf-authorize` are refused (exit 2, nothing written).
- Without the sovereign chain there is no paternity to establish, so states 6 and 7 report
`unverifiable` and never guess.

## Files in this directory

| File | Purpose |
|------|---------|
| `command.sh` | Router — `init sovereign` / `init entity` / `init kingdom` |
| `entity/command.sh` | `init entity` — state detection, the §13 cells, ceremonies |
| `entity/ceremony.mjs` | SPEC-175 entity key ceremonies (generate-entity, verify-leaf, sign-entity-entries, get-leaf-fingerprint) |
| `entity/test-leaf-signing.mjs` | Tests for ceremony.mjs leaf signing |
| `sovereign/` | Sovereign genesis subcommand — untouched |

## Ref

- VESTA-SPEC-240 — the 4×3 matrix (§13), the `--re-seed` corollary (§4), effective-key
  resolution (§7), paternity (§8), the sovereign requirement (§13.7), archive labelling (§13.5)
- VESTA-SPEC-175 §6 — entity key shape and migration steps
- VESTA-SPEC-149 — master/leaf split; master is paper-only after genesis
- `~/.koad-io/test/spec-240.test.mjs` — the matrix suite; `node test/spec-240.test.mjs matrix`
