# koad:io-sovereign-profiles

Sovereign profile management for koad:io Meteor apps. Create, publish, and display user profiles backed by SPEC-111 sigchains on IPFS. Profiles are self-certifying — any app can verify them without trusting a server.

## Installation

```shell
meteor add koad:io-sovereign-profiles
```

## What it is

A Meteor package with two sides:

| Side | Consumer | Requires keys? |
|------|----------|----------------|
| Builder/signer | Passenger (your sovereign PWA) | Yes — Ed25519 device key |
| Viewer/verifier | Any koad:io app | No — read-only |

The split is intentional. Signing always happens on the device holding the key (Passenger). Reading and verifying work anywhere with a CID and network access.

Profiles are stored as SPEC-111 `koad.state-update` entries on IPFS. The genesis entry anchors the chain and embeds the entity's public key. Every subsequent profile update links back to the previous entry. Walk the chain tip-to-genesis to reconstruct the full history; take the first `koad.state-update[scope="profile"]` entry for current state.

## Quick start

### Displaying a profile (no keys required)

```js
import { SovereignProfile } from 'meteor/koad:io-sovereign-profiles';

// Resolve current profile from the sigchain tip CID
const profileData = await SovereignProfile.resolve(tipCid);

// Verify the full chain while you're at it (optional, recommended)
const { valid, entries, errors } = await SovereignProfile.verifyChain(tipCid);

// Prepare for template rendering
const renderData = SovereignProfile.render(profileData, {
  verified: valid,
  entity: 'alice',
  chainEntries: entries,
});
```

```html
{{> profileCard profile=renderData}}
```

### Creating and publishing a profile (Passenger only)

Passenger has access to the local Ed25519 key. Other apps do not — do not call these methods outside Passenger.

```js
import { SovereignProfile } from 'meteor/koad:io-sovereign-profiles';

// Step 1: create the genesis entry (first time only)
const genesis = SovereignProfile.genesis({
  entity: 'alice',
  pubkeyBytes: pubKey,          // Uint8Array — Ed25519 public key
  description: 'alice sovereign profile chain — genesis',
});
const signedGenesis = await SovereignProfile.sign(genesis, privateKey);
const genesisCid = await SovereignProfile.publish(signedGenesis);

// Step 2: publish initial profile state
const entry = SovereignProfile.create({
  entity: 'alice',
  previousCid: genesisCid,
  profile: {
    name: 'Alice',
    bio: 'A koad:io entity',
    avatar: 'baguczsa...',      // CID of avatar image on IPFS
    socialProofs: [
      { platform: 'github', handle: 'alice', url: 'https://github.com/alice' },
    ],
  },
});
const signedEntry = await SovereignProfile.sign(entry, privateKey);
const tipCid = await SovereignProfile.publish(signedEntry);

// Step 3: update the profile later (same as create, referencing current tip)
const updateEntry = SovereignProfile.update(tipCid, {
  name: 'Alice',
  bio: 'Updated bio',
}, 'alice');
const signedUpdate = await SovereignProfile.sign(updateEntry, privateKey);
const newTipCid = await SovereignProfile.publish(signedUpdate);
```

## API reference

### Builder (Passenger only)

#### `SovereignProfile.genesis(opts)` → `object`

Creates an unsigned genesis entry — the first entry in a new sigchain. Does not embed profile data. The genesis anchors the chain identity and public key; the initial profile state is a separate `create()` call.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `opts.entity` | string | yes | Entity name, e.g. `"alice"` |
| `opts.pubkeyBytes` | Uint8Array | yes | Ed25519 public key (32 bytes) |
| `opts.description` | string | no | Human-readable chain description |

Returns an unsigned entry object. Call `.sign()` next.

#### `SovereignProfile.create(opts)` → `object`

Creates an unsigned `koad.state-update` entry carrying the full profile state. Per SPEC-111 §5.2, this is a full replacement within scope `"profile"`.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `opts.entity` | string | yes | Entity name |
| `opts.previousCid` | string | yes | CID of the entry this supersedes |
| `opts.profile.name` | string | yes | Display name |
| `opts.profile.bio` | string | no | Short bio |
| `opts.profile.avatar` | string | no | IPFS CID of avatar image |
| `opts.profile.socialProofs` | array | no | `[{ platform, handle, url }]` |

Returns an unsigned entry object. Call `.sign()` next.

#### `SovereignProfile.update(currentCid, changes, entity)` → `object`

Alias of `.create()`. Produces a new `koad.state-update` referencing `currentCid`. Semantically identical; named separately for call-site clarity.

> **Note:** SPEC-111 §5.2 defines `koad.state-update` as full state replacement, not a patch. Supply all fields you want to keep — omitted fields default to empty.

#### `SovereignProfile.sign(entry, privateKey)` → `Promise<object>`

Signs an entry with the given Ed25519 private key. Implements SPEC-111 §3.2–3.3.

| Param | Type | Description |
|-------|------|-------------|
| `entry` | object | Unsigned entry (no `signature` field) |
| `privateKey` | Uint8Array | 32-byte Ed25519 private key scalar |

Returns a promise resolving to the signed entry with `signature` populated (base64url, no padding).

#### `SovereignProfile.publish(signedEntry)` → `Promise<string>`

Encodes a signed entry as dag-json and stores it via `IPFSClient.put()`. Returns the CIDv1 string (dag-json codec `0x0129`, sha2-256, base32lower, `bagu...` prefix).

The returned CID is the `previousCid` for the next entry in the chain.

> **Current limitation:** `publish()` is wired to `IPFSClient.put()` but the ipfs-client package's `put()` API is not yet finalized. CIDs can be computed locally using the CLI commands (`koad profile create`) without a running IPFS daemon.

### Viewer (any app)

#### `SovereignProfile.resolve(cid)` → `Promise<object|null>`

Walks the sigchain from `cid` to genesis and returns the profile data from the most recent `koad.state-update[scope="profile"]` entry. Returns `null` if no profile entry is found.

Calls `verifyChain()` internally. If the chain is invalid, logs a warning and returns best-effort profile data — the caller decides whether to trust it.

#### `SovereignProfile.verifyChain(tipCid)` → `Promise<{ valid, entries, errors }>`

Full chain walk and verification, tip to genesis. Implements SPEC-111 §3.4, §6.1, §6.5.

Returns:

| Field | Type | Description |
|-------|------|-------------|
| `valid` | boolean | `true` if all entries verified |
| `entries` | array | `[{ cid, entry }]`, tip-first |
| `errors` | array | Error strings; empty if valid |

Checks performed: CID integrity, Ed25519 signatures, genesis termination, entity consistency, no cycles, no unknown fields (§2.2), device key authorization set (§6.5).

#### `SovereignProfile.render(profileData, opts)` → `object`

Prepares profile data for Blaze template helpers.

| Param | Type | Description |
|-------|------|-------------|
| `profileData` | object | Raw data from `resolve()` |
| `opts.verified` | boolean | Whether chain verification passed |
| `opts.entity` | string | Entity name |
| `opts.chainEntries` | array | Entries from `verifyChain()` (for bond count, chain depth) |

Returns a render-ready object with: `name`, `bio`, `avatar`, `socialProofs`, `verified`, `entity`, `bondCount`, `sigchainTip`, `chainDepth`, `lastUpdated`.

## Templates

Three Blaze templates are included.

| Template | When to use |
|----------|-------------|
| `{{> profileCard profile=renderData}}` | Compact card — inline anywhere, minimal footprint |
| `{{> profileFull profile=renderData tipCid=tipCid}}` | Full profile page with chain history |
| `{{> profileEditor}}` | Profile editor — Passenger only, requires key access |

Pass the output of `SovereignProfile.render()` as the `profile` argument.

## Relationship to the sigchain

Each published profile state is a `koad.state-update` entry in the entity's SPEC-111 sigchain. The entry is content-addressed: its CID is also its integrity proof.

Chain shape:

```
genesis  ←  state-update[profile]  ←  state-update[profile]  ←  …  ←  tip
```

The most recent `koad.state-update[scope="profile"]` entry (closest to the tip) is the current profile. Prior entries are history. Walking tip-to-genesis rebuilds the complete profile timeline.

For the full entry schema and verification rules, see [VESTA-SPEC-111](~/.vesta/specs/VESTA-SPEC-111-sovereign-sigchain-entry-format.md).

## Dependencies

- `koad:io-core` — koad global, Blaze, reactive system
- `koad:io-ipfs-client` — IPFS fetch/put (client: Helia+OPFS service worker; server: daemon node)
- `multiformats` `13.3.0` — CIDv1 computation (dag-json codec, sha2-256)
- `@noble/ed25519` `2.1.0` — Ed25519 signing and verification
- `@ipld/dag-json` `10.2.2` — canonical dag-json serialization per SPEC-111 §3.1

## Security model

- **Profiles are self-certifying.** The CID is the integrity proof. No server required.
- **Keys never leave the device.** The builder API runs in Passenger only. The viewer API requires no keys.
- **This package is a read/write interface, not a storage layer.** It does not hold private keys. Passenger manages key storage and passes keys to `.sign()` per operation.
- **Chain verification is conservative.** Unknown fields cause rejection (§2.2). Any break in the chain (bad signature, CID mismatch, unknown genesis) returns `valid: false`.
- **Social proof signatures are not yet verified.** The `socialProofs[].verified` field is always `false` pending the social proof format spec.

## What is not wired yet

| Gap | Status |
|-----|--------|
| `SovereignProfile.publish()` → `IPFSClient.put()` | Stub — ipfs-client `put()` API not finalized |
| `SovereignProfile.resolve()` / `verifyChain()` → `IPFSClient.get()` | Stub — same |
| Server `verify()` / `pin()` | Stub — Phase 2 |
| `profileEditor.js` → Passenger key storage | Not connected |
| Social proof signature verification | Awaiting social proof format spec |
| Avatar upload flow | Upload to IPFS → populate CID field |

Use the `koad profile` CLI commands for local work until IPFS wiring is complete.

## Related

- [VESTA-SPEC-111](~/.vesta/specs/VESTA-SPEC-111-sovereign-sigchain-entry-format.md) — canonical sigchain entry format
- [koad:io-ipfs-client](../ipfs-client/README.md) — IPFS client package
- [sigchain-witness-architecture](~/.juno/briefs/sigchain-witness-architecture.md) — architecture brief
- `koad profile` CLI commands — `~/.koad-io/commands/profile/README.md`
