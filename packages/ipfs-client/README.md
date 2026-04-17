# koad:io-ipfs-client

In-browser IPFS node for koad:io PWAs. Gives every koad:io app the ability to resolve, verify, store, and cache content-addressed data directly in the user's browser — no server required for verification. The browser IS the verifying node.

## Installation

```shell
meteor add koad:io-ipfs-client
```

## What it does

`IPFSClient` wraps a [Helia HTTP](https://github.com/ipfs/helia) node with OPFS blockstore and delegated routing. It is the storage and retrieval layer that sigchain-aware packages (`koad:io-sovereign-profiles`, `koad:io-activity-stream`) sit on top of.

| Layer | Choice | Why |
|-------|--------|-----|
| Runtime | `@helia/http` | No DHT — HTTP delegated routing only. Helia 4.x removed DHT from browser by default. |
| Storage | `blockstore-opfs` | OPFS — persistent, binary-native, survives tab close, no size limit. |
| Fallback | `blockstore-idb` | IndexedDB for Firefox service worker contexts where OPFS is unavailable. |
| Routing | delegated-ipfs.dev | Delegated HTTP routing. Browser node does not need peers. |
| Verification | `@helia/verified-fetch` | CIDs are self-certifying. Hash checked locally — trust nothing. |

Singleton per browser tab. Lazy-initializes on first use; does not block app startup.

Reference implementation: [inbrowser.link v3.1.7](https://github.com/ipfs/service-worker-gateway) (April 2026).

## Quick start

```js
import { IPFSClient } from 'meteor/koad:io-ipfs-client';

// Optional: warm the node proactively at app startup
await IPFSClient.ready();

// Write a JS object as dag-json → get back the CIDv1 string
const cid = await IPFSClient.put({ hello: 'world', timestamp: new Date().toISOString() });
// → "baguczsa..."

// Read it back — checks local cache first, then IPFS network
const obj = await IPFSClient.get(cid);
// → { hello: 'world', timestamp: '...' }

// Resolve to raw bytes (for manual dag-json decoding)
const bytes = await IPFSClient.resolve(cid);

// Check local cache without a network request
const cached = await IPFSClient.has(cid);
// → true

// Pin locally — protects from OPFS GC
await IPFSClient.pin(cid);

// Synchronous status snapshot (does not trigger init)
const { initialized, backend, error } = IPFSClient.status();
// backend: 'opfs' | 'idb' | null
```

All methods are also available on the `koad` global:

```js
koad.ipfs.client.put(data)
koad.ipfs.client.get(cid)
koad.ipfs.client.resolve(cid)
koad.ipfs.client.status()
```

## API reference

### `IPFSClient.ready()` → `Promise<void>`

Resolves when the Helia node is fully initialized. Triggers initialization on first call. Safe to call concurrently — subsequent calls return the same promise.

Call on app startup to warm the node before the first content request. Otherwise, the first `resolve()`, `put()`, or `has()` call triggers lazy init.

---

### `IPFSClient.put(data)` → `Promise<string>`

Encodes `data` as dag-json (SPEC-111 §3.1 codec `0x0129`, sha2-256), stores in local blockstore, returns the CIDv1 string (`bagu...` prefix, base32upper).

| Param | Type | Description |
|-------|------|-------------|
| `data` | object \| Uint8Array | JS object (dag-json encoded) or pre-encoded bytes |

Returns the CID string. This is the `previousCid` for the next sigchain entry.

---

### `IPFSClient.get(cid)` → `Promise<object>`

Fetches and verifies dag-json bytes (local cache first, then IPFS network via verified-fetch), then decodes and returns the JS object.

Use this when you want the parsed object. Use `resolve()` when you want raw bytes.

| Param | Type | Description |
|-------|------|-------------|
| `cid` | string | CIDv1 string |

---

### `IPFSClient.resolve(cid)` → `Promise<Uint8Array>`

Fetches and verifies a CID. Checks local OPFS blockstore first. If not cached, fetches from the IPFS network via verified-fetch, verifies the hash locally, and stores in the blockstore for future calls.

| Param | Type | Description |
|-------|------|-------------|
| `cid` | string | CID string (`Qm...` or `bafy...`) |

Returns raw bytes. Throws if the fetch fails or the CID cannot be verified.

---

### `IPFSClient.pin(cid)` → `Promise<void>`

Adds `cid` to the local pinset. Pinned CIDs are not garbage-collected from the OPFS blockstore.

> **Local only.** This does not pin to the IPFS network. Server-side network pinning is Phase 2 (`IPFSServer`).

---

### `IPFSClient.unpin(cid)` → `Promise<void>`

Removes `cid` from the local pinset. The blocks remain cached until GC runs; they are no longer protected from eviction.

---

### `IPFSClient.has(cid)` → `Promise<boolean>`

Returns `true` if the root block for `cid` is in the local blockstore. Does not make a network request.

---

### `IPFSClient.status()` → `object`

Synchronous snapshot. Does not trigger initialization.

```js
{
  initialized: boolean,  // true after ready() resolves
  backend: 'opfs' | 'idb' | null,  // storage backend in use
  error: Error | null    // set if init failed
}
```

## Service worker

The package includes a helper that registers an IPFS service worker. The service worker intercepts `/ipfs/<cid>` and `/ipns/<name>` requests, serving them from local OPFS cache first and falling back to the IPFS network.

**The service worker file (`ipfs-sw.js`) must be placed in your app's `/public/` directory.** This package provides the registration helper — the host app controls when to register. Auto-registration is intentionally avoided: a package claiming the root SW scope without the app's consent would be overreaching.

```js
// In your app's client startup (after the app is ready):
await koad.ipfs.registerServiceWorker();

// With options:
await koad.ipfs.registerServiceWorker({ path: '/my-ipfs-sw.js', scope: '/ipfs/' });

// Check SW status:
const { registered, state } = koad.ipfs.swStatus();
// state: 'installing' | 'installed' | 'activating' | 'activated' | null
```

The helper deduplicates concurrent registration calls and logs SW update events. Returns `null` if service workers are not supported in the current context.

## Server API (Phase 2 — stub)

`IPFSServer` is exported on the server side. All methods currently return stub responses and log a warning. Phase 2 will implement a full Helia daemon node with sponsor-tier pinning and DHT participation.

```js
// Server-side — these are stubs until Phase 2
const result = await IPFSServer.pin(cid, userId);
// → { pinned: false, reason: 'Phase 2 not implemented' }

const s = await IPFSServer.status();
// → { running: false, peerId: null, peers: 0, phase: 2, note: '...' }
```

Phase 2 notes (from `server/ipfs-server.js`):
- Full Helia node — DHT enabled (server CAN serve content to peers)
- Filesystem blockstore (`blockstore-fs` or `blockstore-level`)
- Sponsor-tier gating via GitHub Sponsors API
- Pin ledger for per-user pin tracking
- Alignment with VESTA-SPEC-109 (Witness Protocol)

## What is not wired yet

| Gap | Status |
|-----|--------|
| `IPFSClient.put()` → IPFS network publish | Local blockstore only — content is NOT broadcast to the network yet |
| `IPFSClient.resolve()` → gateway fallback | Pending koad's IPFS gateway work; verified-fetch handles fallback to public IPFS HTTP gateways |
| `IPFSServer` pinning service | Phase 2 — stub only |
| Service worker `ipfs-sw.js` source file | Not included in this package — host app must provide it (see inbrowser.link reference) |

> **Note on `put()` and network visibility.** `put()` stores content in the local blockstore and returns a valid CID. The CID is a content-address — it is the integrity proof. But until the block is announced to the IPFS network (Phase 2 server pinning), only local storage holds it. Use `koad:io-sovereign-profiles` CLI commands for local chain work while the network layer is being built.

## Relationship to other packages

| Package | Relationship |
|---------|-------------|
| `koad:io-sovereign-profiles` | Consumer — calls `put()` to publish signed sigchain entries; calls `get()` to walk the chain for verification |
| `koad:io-activity-stream` | Consumer — calls `get()` to walk sigchain entries for stream display |

## Dependencies

- `koad:io-core` — koad global, Blaze, reactive system
- `@helia/http` `1.0.2` — browser IPFS node (HTTP delegated routing)
- `@helia/verified-fetch` `2.1.0` — CID-verifying fetch
- `blockstore-opfs` `2.0.1` — OPFS persistent blockstore
- `blockstore-idb` `1.1.3` — IndexedDB blockstore fallback
- `multiformats` `13.3.0` — CIDv1, codec constants, sha2-256
- `@ipld/dag-json` `10.2.2` — dag-json encode/decode (SPEC-111 §3.1)

## Related

- [VESTA-SPEC-111](~/.vesta/specs/VESTA-SPEC-111-sovereign-sigchain-entry-format.md) — sigchain entry format and CID encoding rules
- [VESTA-SPEC-109](~/.vesta/specs/) — Witness Protocol (Phase 2 server target)
- [sigchain-witness-architecture](~/.juno/briefs/sigchain-witness-architecture.md) — architecture brief
- [Sibyl research — Helia browser IPFS PWA](~/.sibyl/research/2026-04-16-helia-browser-ipfs-pwa.md) — research behind the `@helia/http` choice
- [inbrowser.link v3.1.7](https://github.com/ipfs/service-worker-gateway) — reference implementation
