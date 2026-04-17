# koad:io-ipfs-client

In-browser IPFS node for koad:io PWAs.

Gives every koad:io app the ability to resolve, verify, and cache sigchain CIDs locally — directly in the user's browser. No server required for verification. The browser IS the verifying node.

## Installation

```shell
meteor add koad:io-ipfs-client
```

## Architecture

| Layer | Choice | Why |
|-------|--------|-----|
| Runtime | `@helia/http` | No DHT — HTTP delegated routing only. Helia 4.x explicitly removed DHT from browser defaults (issue #420). |
| Storage | `blockstore-opfs` | OPFS — persistent, binary-native, survives tab close, no size limit. |
| Fallback | `blockstore-idb` | IndexedDB for Firefox service worker contexts where OPFS is unavailable. |
| Routing | delegated-ipfs.dev | Delegated HTTP routing — no DHT peer discovery needed. |
| Verification | `@helia/verified-fetch` | CIDs are self-certifying. Hash checked locally, trust nothing. |

Reference implementation: [inbrowser.link v3.1.7](https://github.com/ipfs/service-worker-gateway) (production, April 2026).

## Client API

```javascript
// Lazy init — first call triggers node creation
await IPFSClient.ready();

// Resolve and verify a CID — returns raw bytes
const bytes = await IPFSClient.resolve('bafybeigdyrzt...');

// Check local cache without a network request
const cached = await IPFSClient.has('bafybeigdyrzt...');

// Pin locally (protects from OPFS GC, not network persistence)
await IPFSClient.pin('bafybeigdyrzt...');
await IPFSClient.unpin('bafybeigdyrzt...');

// Status snapshot (synchronous)
const { initialized, backend, error } = IPFSClient.status();
// backend: 'opfs' | 'idb' | null
```

All methods are also available on the `koad` global:

```javascript
koad.ipfs.client.resolve(cid)
koad.ipfs.client.status()
```

## Service Worker

The package includes a service worker registration helper that intercepts `/ipfs/<cid>` and `/ipns/<name>` requests and serves them from local cache first.

The service worker file (`ipfs-sw.js`) must be placed in your app's `/public/` directory. This package provides the registration helper — the host app controls when to register.

```javascript
// In your app's client startup:
await koad.ipfs.registerServiceWorker();

// Check SW status:
const { registered, state } = koad.ipfs.swStatus();
```

## Server API (Phase 2 — stub)

The server module exports `IPFSServer` with the pinning service shape. All methods currently return stub responses. Phase 2 will implement the full daemon pinning service with sponsor-tier gating.

See `server/ipfs-server.js` for the Phase 2 specification comments.

## What This Is Not

- This is NOT a DHT peer. Browser nodes cannot serve content to other IPFS peers.
- This is NOT a full IPFS node. It is a verifying cache with IPFS semantics.
- Pinning here is LOCAL only — it does not pin to the IPFS network.
- Server-side pinning (daemon) is Phase 2.

## Related

- Architecture brief: `~/.juno/briefs/sigchain-witness-architecture.md`
- Sibyl research: `~/.sibyl/research/2026-04-16-helia-browser-ipfs-pwa.md`
- VESTA-SPEC-109: Witness Protocol and Canonical Source Standard
