# koad:io-sovereign-profiles

Sovereign profile management for koad:io entities and users. Implements
VESTA-SPEC-111 (sigchain entry format) for profile create/update/publish on IPFS.

## Architecture

This package exports **two sides**:

| Side | Consumer | Requires keys? |
|------|----------|---------------|
| Editor/signer | Passenger (sovereign local PWA) | Yes — Ed25519 device key |
| Viewer/verifier | Any koad:io app | No — read-only |

The distinction is intentional. Profile data is self-certifying IPFS content.
Signing happens on the device that holds the key (Passenger). Reading/verifying
happens anywhere.

## API

### Builder (Passenger only)

```js
import { SovereignProfile } from 'meteor/koad:io-sovereign-profiles';

// 1. Create a genesis entry (first entry in a new chain)
const genesis = SovereignProfile.genesis({
  entity: 'alice',
  pubkeyBytes: pubKey,               // Uint8Array — Ed25519 public key
  description: 'alice sovereign profile chain — genesis',
});
const signedGenesis = await SovereignProfile.sign(genesis, privateKey);
const genesisCid = await SovereignProfile.publish(signedGenesis);

// 2. Create or update the profile state
const entry = SovereignProfile.create({
  entity: 'alice',
  previousCid: genesisCid,           // or current tip CID for updates
  profile: {
    name: 'Alice',
    bio: 'A koad:io entity',
    avatar: 'bafyrei...',            // CID of avatar image on IPFS
    socialProofs: [
      { platform: 'github', handle: 'alice', url: 'https://github.com/alice' },
    ],
  },
});
const signedEntry = await SovereignProfile.sign(entry, privateKey);
const newTipCid = await SovereignProfile.publish(signedEntry);

// 3. Update: same as create, referencing new tip
const updateEntry = SovereignProfile.update(newTipCid, { bio: 'Updated bio' }, 'alice');
```

### Viewer (any app)

```js
import { SovereignProfile } from 'meteor/koad:io-sovereign-profiles';

// Resolve current profile from tip CID
const profileData = await SovereignProfile.resolve(tipCid);

// Full chain verification (tip → genesis)
const { valid, entries, errors } = await SovereignProfile.verifyChain(tipCid);

// Prepare for template rendering
const renderData = SovereignProfile.render(profileData, {
  verified: valid,
  entity: 'alice',
});
```

### Blaze Templates

```html
<!-- Compact card: usable anywhere -->
{{> profileCard profile=renderData}}

<!-- Full profile with chain history -->
{{> profileFull profile=renderData tipCid=tipCid}}

<!-- Editor: Passenger only, requires key access -->
{{> profileEditor}}
```

## Sigchain entry types used

| Type | Purpose |
|------|---------|
| `koad.genesis` | First entry — anchors chain identity, embeds public key |
| `koad.state-update` (scope: "profile") | Profile state publication/update |

Per SPEC-111 §5.2: `koad.state-update` with the same `scope` overwrites the
prior entry for that scope. Walk the chain tip → genesis, take the first
`koad.state-update[scope="profile"]` entry — that is the current profile.

## Dependencies

- `koad:io-core` — koad global, Blaze, reactive system
- `koad:io-ipfs-client` — IPFS fetch/put (client: Helia+OPFS; server: daemon node)
- `multiformats` — CIDv1 computation (dag-json 0x0129, sha2-256)
- `@noble/ed25519` — Ed25519 signing and verification
- `@ipld/dag-json` — canonical dag-json serialization per SPEC-111 §3.1

## Spec compliance

Implements VESTA-SPEC-111 v1.1. Key requirements met:
- Canonical dag-json pre-image for signing (§3.2): fields sorted, `signature` absent
- CIDv1 dag-json + sha2-256 (§3.1): codec 0x0129, hash 0x12
- Ed25519 signing with raw message — `-rawin` equivalent (§3.3)
- Device key authorization set (§6.5): built by walker in `verifyChain()`
- `reverse_sig` verification for `koad.device-key-add` entries (§5.4.1)
- Unknown fields cause rejection (§2.2)
- Chain validity rules: genesis check, entity consistency, no cycles (§6.1)

## TODO (before production)

- Wire `SovereignProfile.publish()` to `IPFSClient.put()` once ipfs-client API is finalized
- Wire `SovereignProfile.resolve()` / `verifyChain()` to `IPFSClient.get()`
- Wire server `SovereignProfile.verify()` / `pin()` to `IPFSServer.*`
- Connect profile-editor.js to Passenger key storage (`koad.passenger.signingContext()`)
- Social proof signature verification (awaiting social proof format spec)
- Avatar upload flow (upload to IPFS → populate CID field)

## Related specs

- [VESTA-SPEC-111](~/.vesta/specs/VESTA-SPEC-111-sovereign-sigchain-entry-format.md) — canonical sigchain entry format
- [sigchain-witness-architecture](~/.juno/briefs/sigchain-witness-architecture.md) — architecture brief
