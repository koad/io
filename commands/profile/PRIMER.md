<!-- SPDX-License-Identifier: CC0-1.0 -->

# PRIMER — `~/.koad-io/commands/profile/`

> Sigchain profile management — create, update, verify, and publish entity identity profiles.

## What this does

`profile` manages an entity's on-chain identity state. It creates sigchain genesis entries, updates profile state, verifies chain integrity, and publishes the profile to the network. Implements VESTA-SPEC-111.

## Sub-commands

| Sub-command | Purpose |
|-------------|---------|
| `create/command.sh` | Generate genesis sigchain entry + initial profile state (name, bio) |
| `update/command.sh` | Create a `koad.state-update` entry to update profile fields |
| `verify/command.sh` | Verify sigchain integrity |
| `view/command.sh` | Print current profile state |
| `publish/command.sh` | Publish profile to the network |
| `key/command.sh` | Manage profile keys |
| `device-key/command.sh` | Manage device keys |

## Invocation

```bash
<entity> profile create                       # Interactive — prompts for name, bio
<entity> profile create --name "Alice" --bio "A koad:io entity" --non-interactive
<entity> profile update --bio "Updated bio"
<entity> profile view
<entity> profile verify
<entity> profile publish
```

## What it expects

- `$ENTITY_DIR/id/ed25519.key` (PEM PKCS8, preferred) or `$ENTITY_DIR/id/ed25519` (OpenSSH fallback) — for signing
- `$ENTITY_DIR/var/sigchain-tip` — written/updated by `create` and `update`

## Notes

- CIDs are computed locally — no IPFS daemon required for `create` or `update`.
- IPFS `dag put` is stubbed; entries are signed and CID-computed offline per VESTA-SPEC-111 §11.4.
- `profile create` must be run before `profile update`.
