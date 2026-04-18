# profile commands

CLI commands for managing sovereign profile sigchains. Create, update, verify, view, and publish Ed25519-signed SPEC-111 profile entries from the command line.

## Commands

| Command | What it does |
|---------|-------------|
| `$ENTITY profile create` | Generate genesis + initial profile state (first run only) |
| `$ENTITY profile update` | Append a new profile state entry to the chain |
| `$ENTITY profile verify` | Verify Ed25519 signatures on local entry files |
| `$ENTITY profile view` | Display a profile entry or resolved profile from local files |
| `$ENTITY profile publish` | Sign and announce the tip CID to the canonical location |
| `$ENTITY profile device-key add` | Generate a new device keypair and authorize it on the chain |
| `$ENTITY profile device-key revoke` | Revoke a previously authorized device key |
| `$ENTITY profile device-key list` | List authorized (and optionally revoked) device keys |

`$ENTITY` is whatever your entity name is — `juno`, `koad`, `alice`, etc. Set in `$ENTITY` in your shell or `.env`.

## Prerequisites

- **An entity directory must exist** at `$ENTITY_DIR` (default: `~/.$ENTITY`).
- **Ed25519 keys must be present** in `$ENTITY_DIR/id/`. See [Key conventions](#key-conventions).
- **`node` must be in `PATH`.** All signing and CID computation uses the `sign.js` helper via Node.js.
- **`openssl` must be in `PATH`** for `device-key add` (key generation only).
- IPFS is not required to use `create`, `update`, `verify`, or `view`. The `publish` command needs IPFS for the `ipns` location type.

## Key conventions

| File | Format | Purpose |
|------|--------|---------|
| `$ENTITY_DIR/id/ed25519.key` | PEM PKCS8 | Private signing key (preferred) |
| `$ENTITY_DIR/id/ed25519` | OpenSSH | Private signing key (fallback) |
| `$ENTITY_DIR/id/ed25519.pub` | OpenSSH public key | Used by `verify` |
| `$ENTITY_DIR/id/devices/<id>.key` | PEM PKCS8 | Device private key |
| `$ENTITY_DIR/id/devices/<id>.pub` | PEM SPKI | Device public key |

The commands check for `ed25519.key` first, then fall back to `ed25519`. If neither exists, the command fails with instructions to generate one:

```shell
ssh-keygen -t ed25519 -f ~/.juno/id/ed25519 -C 'juno@wonderland' -N ''
```

## Your first profile

### 1. Create genesis and initial profile

```
$ juno profile create --name "Juno" --bio "koad:io orchestrator"

Reading Ed25519 key from /home/koad/.juno/id/ed25519...
Creating genesis entry for juno...
Genesis CID: baguczsa3hq7...
Creating initial profile state entry...
Profile CID: baguczsa7pk2... (tip)

Profile created:
  Entity:       juno
  Name:         Juno
  Key:          /home/koad/.juno/id/ed25519
  Genesis CID:  baguczsa3hq7...
  Profile CID:  baguczsa7pk2... (tip)
  Tip file:     /home/koad/.juno/var/sigchain-tip

Note: IPFS not wired. CIDs are computed locally (dag-json, sha2-256).
```

Use `--output DIR` to write the signed JSON entry files to disk:

```shell
juno profile create --name "Juno" --bio "koad:io orchestrator" --output ~/tmp/juno-chain
```

This writes `genesis.json` and `profile-state.json` to `~/tmp/juno-chain/`. You need these files for `verify` and `view`.

### 2. Verify the entries

```
$ juno profile verify --chain ~/tmp/juno-chain/profile-state.json ~/tmp/juno-chain/genesis.json

Verifying chain of 2 entries (pubkey from genesis):

  [OK]  baguczsa7pk2...
        type:      koad.state-update
        entity:    juno
        timestamp: 2026-04-17T02:25:00Z

  [OK]  baguczsa3hq7...
        type:      koad.genesis
        entity:    juno
        timestamp: 2026-04-17T02:25:00Z

Result: VERIFIED (2 entries)
```

### 3. View the profile

```
$ juno profile view --chain ~/tmp/juno-chain/profile-state.json ~/tmp/juno-chain/genesis.json

Profile: juno
Source:  2 local file(s)

  Name:    Juno
  Bio:     koad:io orchestrator
  Avatar:  (not set)
```

To view a single entry in detail:

```
$ juno profile view --file ~/tmp/juno-chain/genesis.json

Type:      koad.genesis
Entity:    juno
Timestamp: 2026-04-17T02:25:00Z
Previous:  (genesis)
Signature: ABCDEF123456...

Genesis payload:
  pubkey:      xQmT8...
  created:     2026-04-17T02:25:00Z
  description: juno sovereign profile chain — genesis
```

### 4. Publish (when IPFS is live)

```shell
juno profile publish
```

This reads the tip CID from `$ENTITY_DIR/var/sigchain-tip`, signs a canonical location pointer (SPEC-111 §7.2), and delivers it to the configured location. Default is `stdout` — print the pointer without sending it anywhere.

Set `ENTITY_SIGCHAIN_CANONICAL_LOCATION` to change the delivery target:

```shell
# Print pointer to stdout (default)
juno profile publish

# Push to IPNS (requires running IPFS daemon)
ENTITY_SIGCHAIN_CANONICAL_LOCATION=ipns juno profile publish

# PUT to kingofalldata.com (requires KOAD_IO_DAEMON_TOKEN)
ENTITY_SIGCHAIN_CANONICAL_LOCATION=kingofalldata juno profile publish
```

Use `--dry-run` to print the signed pointer without delivering it:

```shell
juno profile publish --dry-run
```

---

## Command reference

### `profile create`

Generate a genesis entry and initial profile state. Run once per entity.

```
$ENTITY profile create [options]

  --name NAME           Display name (required in --non-interactive mode)
  --bio BIO             Short bio (optional)
  --avatar CID          IPFS CID of avatar image (optional)
  --output DIR          Write signed entry JSON files to this directory
  --non-interactive     Skip prompts; fail if --name is missing
  -h, --help
```

Creates two entries per SPEC-111:
1. `koad.genesis` — anchors chain identity, embeds Ed25519 public key
2. `koad.state-update[scope:profile]` — initial profile data

Writes tip CID to `$ENTITY_DIR/var/sigchain-tip`. Fails if a tip file already exists (use `update` instead).

**Exit codes:** 0 success, 1 error.

---

### `profile update`

Append a new profile state entry to the existing chain.

```
$ENTITY profile update [options]

  --name NAME           New display name
  --bio BIO             New bio
  --avatar CID          New avatar IPFS CID
  --output DIR          Write signed entry JSON to this directory
  --non-interactive     Skip prompts; apply only the flags provided
  -h, --help
```

Reads the current tip from `$ENTITY_DIR/var/sigchain-tip`. Creates a new `koad.state-update[scope:profile]` entry referencing it. Updates the tip file with the new CID.

> Per SPEC-111 §5.2, `koad.state-update` is full state replacement. Supply all profile fields you want to keep — omitted fields are set to empty in the new entry.

> IPFS fetch of current profile values is not yet wired. Interactive mode cannot pre-populate the prompts with existing values.

**Exit codes:** 0 success, 1 error.

---

### `profile verify`

Verify Ed25519 signatures on local sigchain entry files.

```
$ENTITY profile verify [options]

  (no args)                 Scan $ENTITY_DIR/var/sigchain-cache/ — auto-discover
                            chain JSON files and run verification tip-first
  --tip CID                 Accept a tip CID; scan local cache (IPFS fetch stubbed)
  --file FILE               Verify a single local JSON entry file
  --chain TIP.json [...]    Verify an ordered sequence: tip first, genesis last
  --pubkey-path FILE        Public key file (OpenSSH or PEM SPKI)
                            Default: $ENTITY_DIR/id/ed25519.pub
  --pubkey-base64url B      Raw Ed25519 public key as base64url
  --json                    Output results as JSON
  -h, --help

Exit codes:
  0 — all entries verified
  1 — one or more entries failed verification
  2 — missing prerequisites or bad arguments
```

No-args and `--tip` modes scan `$ENTITY_DIR/var/sigchain-cache/` for JSON files. To populate the cache, use `--output` on `profile create` or `profile update`.

Chain mode and no-args mode extract the public key from the genesis entry automatically — no `--pubkey-path` needed.

IPFS chain-walk by CID is not yet implemented. Use `--file`, `--chain`, or the cache-scan modes with locally saved entry files.

---

### `profile view`

Display a profile entry or resolved profile from local JSON files.

```
$ENTITY profile view [options]

  --file FILE           Parse and display a single local JSON entry
  --chain TIP.json [...] Walk chain files (tip first); display resolved profile
  --verify              Also run signature verification
  --json                Output as JSON
  -h, --help
```

`--json` on a `--chain` walk returns a structured object with `entity`, `tipCid`, and `profile` fields.

IPFS fetch by CID is not yet wired. Use `--file` or `--chain` with files from `--output` on prior commands.

---

### `profile publish`

Sign and announce the sigchain tip CID to the canonical location.

```
$ENTITY profile publish [options]

  --location LOCATION   stdout | ipns | kingofalldata
                        Default: $ENTITY_SIGCHAIN_CANONICAL_LOCATION or stdout
  --dry-run             Print the signed pointer without publishing
  -h, --help
```

Reads tip from `$ENTITY_DIR/var/sigchain-tip`. Signs a canonical location pointer (SPEC-111 §7.2 format: `{ entity, published, signature, tip, version }`). Delivers per `--location`:

| Location | What happens | Requires |
|----------|-------------|----------|
| `stdout` | Prints pointer JSON | nothing |
| `ipns` | `ipfs name publish --key=$ENTITY $TIP_CID` | running IPFS daemon |
| `kingofalldata` | PUT to `kingofalldata.com/api/sigchain/$ENTITY/tip` | `KOAD_IO_DAEMON_TOKEN` env var |

---

### `profile device-key add`

Generate a new Ed25519 device keypair and authorize it on the sigchain. Implements SPEC-111 §5.4 and the reverse_sig two-step protocol (§5.4.1).

```
$ENTITY profile device-key add --device-id DEVICE_ID [options]

  --device-id ID        Stable device identifier (e.g. "wonderland")  REQUIRED
  --description TEXT    Human-readable label
  --authorizing-key PATH  Key to authorize the new device
                          Default: entity root key
  --output DIR          Write signed entry JSON to this directory
  -h, --help
```

What it does:
1. Generates a new Ed25519 keypair via `openssl genpkey`.
2. Saves the keypair to `$ENTITY_DIR/id/devices/<device_id>.key` and `.pub`.
3. Builds a `koad.device-key-add` entry with the reverse_sig two-step:
   - New device key signs the pre-image (without `reverse_sig`) → proves key control.
   - Root/authorizing key signs the full entry (with `reverse_sig`) → authorizes the device.
4. Updates `$ENTITY_DIR/var/sigchain-tip` with the new entry CID.

The `reverse_sig` protocol (SPEC-111 §5.4.1) prevents an attacker from adding a device key they do not control. The new device must sign first to prove possession.

Example:

```shell
juno profile device-key add --device-id wonderland --description "primary workstation"
```

---

### `profile device-key revoke`

Revoke a previously authorized device key.

```
$ENTITY profile device-key revoke <device-id> [options]

  <device-id>           Device ID to revoke  REQUIRED
  --reason REASON       decommissioned | compromised | retired
                        Default: decommissioned
  --signing-key PATH    Key to sign the revocation (must not be the key being revoked)
                        Default: root key
  --output DIR          Write signed entry JSON to this directory
  -h, --help
```

Per SPEC-111 §5.4: a device key cannot self-revoke. Use the root key or a different authorized device key.

Use `--reason compromised` when a key may have been exposed. Verifiers will flag entries signed by that key between its last known-safe use and this revocation as potentially suspect.

The device public key file (`$ENTITY_DIR/id/devices/<device_id>.pub`) must exist — it is required to construct the revocation entry.

---

### `profile device-key list`

Walk the local sigchain cache and show currently authorized device keys.

```
$ENTITY profile device-key list [options]

  --cache-dir DIR   Directory with cached sigchain entry JSON files
                    Default: $ENTITY_DIR/var/sigchain-cache
  --all             Include revoked keys (shown as [REVOKED])
  -h, --help
```

Builds the authorization set per SPEC-111 §6.5: walk genesis-to-tip, add on `koad.device-key-add`, remove on `koad.device-key-revoke`. Only entries present in the local cache are visible — without a running IPFS daemon, entries not saved with `--output` will not appear.

---

## Sigchain state files

| File | Purpose |
|------|---------|
| `$ENTITY_DIR/var/sigchain-tip` | CID of the current tip entry |
| `$ENTITY_DIR/id/ed25519.key` | Entity root private key (PEM PKCS8) |
| `$ENTITY_DIR/id/ed25519.pub` | Entity root public key (OpenSSH) |
| `$ENTITY_DIR/id/devices/<id>.key` | Device private key (PEM PKCS8) |
| `$ENTITY_DIR/id/devices/<id>.pub` | Device public key (PEM SPKI) |

## IPFS status

CID computation works today — all commands compute content-addressed CIDs locally without an IPFS daemon. The `publish` command's `ipns` and `kingofalldata` locations require a running daemon. To push entries manually:

```shell
ipfs dag put --input-codec dag-json --store-codec dag-json < genesis.json
```

## Related

- [koad:io-sovereign-profiles package](../../packages/sovereign-profiles/README.md) — Meteor package for in-app profile display and creation
- [VESTA-SPEC-111](~/.vesta/specs/VESTA-SPEC-111-sovereign-sigchain-entry-format.md) — sigchain entry format spec
- [sigchain-witness-architecture](~/.juno/briefs/sigchain-witness-architecture.md) — architecture brief
