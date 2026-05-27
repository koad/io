---
type: primer
folder: ~/.koad-io/modules/node/
parents:
  - ~/.koad-io/modules/
children:
  - path: browser/
    blurb: Pre-built kbpgp browser bundle — kbpgp with ceremony internals for Ed25519 KeyManager construction in browsers
    status: documented
features:
  - name: koad-io-node-package
    blurb: The npm package itself — package.json, dual CJS+ESM exports map, Node >=18 constraint
    location: ~/.koad-io/modules/node/package.json
  - name: koad-object-factory
    blurb: Core koad object (index.js) — carries deps, identity shape, format helpers, seeders/emitters/trackers arrays
    location: ~/.koad-io/modules/node/index.js
  - name: crypto-deps-hub
    blurb: Centralised ESM-only dependency re-exports — dag-json, CID, sha256, base64, @noble/ed25519, pgp; the bridge from npm to koad.deps
    location: ~/.koad-io/modules/node/deps.js
  - name: pgp-sign-verify
    blurb: SPEC-148 RFC 4880 clearsign + verify over kbpgp — never throws on bad sig, sync signing_key resolution for Node 22 compatibility
    location: ~/.koad-io/modules/node/pgp.js
  - name: koad-identity-api
    blurb: SPEC-149 koad.identity factory — lifecycle (create/load/lockdown/importMnemonic), sign/verify, 11 read-only getters
    location: ~/.koad-io/modules/node/identity.js
  - name: bip39-ceremony-helpers
    blurb: SPEC-149 BIP39→Ed25519→kbpgp KeyManager derivation — entropy gen, mnemonic helpers, buildMasterKeyManager, buildLeafKeyManager, leaf at-rest encryption
    location: ~/.koad-io/modules/node/ceremony.js
  - name: sigchain-entry-layer
    blurb: SPEC-111 pure functional sigchain — constructors, canonical dag-json, CID computation, sign+finalize, verify, full-chain walker
    location: ~/.koad-io/modules/node/sigchain.js
  - name: identity-submission
    blurb: SPEC-150 sigchain head submission builder and verifier — dag-json pre-image, sign with leaf or master, replay protection
    location: ~/.koad-io/modules/node/identity-submission.js
  - name: identity-resolver
    blurb: SPEC-024 read-only identity resolver — reads ~/.vesta/entities/<handle>/sigchain/ in lite or full-walk mode
    location: ~/.koad-io/modules/node/identity-resolver.js
  - name: identity-writer
    blurb: SPEC-024 atomic sigchain registry writer — writeIdentityRegistry (full creation/update) + updateSigchainHead (lightweight tip update)
    location: ~/.koad-io/modules/node/identity-writer.js
  - name: identity-receiver
    blurb: SPEC-150 v1.1 receiver — verifies, conflict-resolves, and stores sigchain head submissions; also serves bulk-fetch endpoint
    location: ~/.koad-io/modules/node/identity-receiver.js
  - name: sovereign-auth-primitive
    blurb: Ed25519 challenge-response auth — challenge/respond/verify/pendingNonceCount/sweepExpiredNonces; no Meteor globals; pure Node
    location: ~/.koad-io/modules/node/auth.js
  - name: kbpgp-browser-bundle
    blurb: Browserify entry + pre-built bundles exposing kbpgp with ceremony internals (keywrapper, UserID, ECDH) for browser ceremony support
    location: ~/.koad-io/modules/node/browser/
  - name: koad-generate-namespace
    blurb: koad.generate.mnemonic(wordCount, firstWord, secondWord) — BIP39 with optional first-two-word pinning via bit-level entropy injection; koad.generate.cid(name) / koad.generate.cid.fromBytes(b) — 17-char EASILY_RECOGNIZABLE Content ID; koad.generate.handle(str) — normalize to lowercase alphanumeric
    location: ~/.koad-io/modules/node/index.js
relates-to:
  - ~/.koad-io/KOAD_IO.md
  - ~/.vesta/specs/VESTA-SPEC-149-identity-stack.md
  - ~/.vesta/specs/VESTA-SPEC-150-identity-submission.md
  - ~/.vesta/specs/VESTA-SPEC-111-sigchain.md
  - ~/.vesta/specs/VESTA-SPEC-148-pgp.md
  - ~/.vesta/specs/VESTA-SPEC-024-entity-registry.md
  - ~/.koad-io/packages/core/PRIMER.md
  - ~/.koad-io/packages/accounts/PRIMER.md
  - ~/.koad-io/packages/daemon-api/PRIMER.md
  - ~/.livy/features/INDEX.md
entities:
  - vulcan
  - koad
  - juno
  - livy
last-walked: 2026-05-27
as-of: HEAD
---

# ~/.koad-io/modules/node/ — @koad-io/node

> One npm package. Every layer of the identity stack. Importable from Meteor, daemon, CLI, and tests.

`@koad-io/node` is the shared Node.js identity and crypto module for the kingdom. It is the canonical, tested implementation of SPEC-149 (identity stack), SPEC-150 (head submission), SPEC-111 (sigchain), SPEC-148 (PGP sign/verify), and SPEC-024 (entity registry reader/writer).

## Quick start

```js
// ESM
import { koad }          from '@koad-io/node';          // koad object + deps
import { createKoadIdentity } from '@koad-io/node/identity'; // factory
import { clearsign, verify }  from '@koad-io/node/pgp';
import { signEntry, verifyEntry } from '@koad-io/node/sigchain';
import { challenge, respond, verify as authVerify } from '@koad-io/node/auth';

// CJS (most exports have a .cjs mirror)
const { koad } = require('@koad-io/node');
```

## Package shape

- **type:** `"module"` (ESM primary)
- **dual exports:** every entrypoint has `import:` (ESM) and `require:` (CJS) paths
- **engines:** `node >=18`
- **dependencies:** `@ipld/dag-json 10.2.7`, `@noble/ed25519 2.1.0`, `@scure/bip39 2.2.0`, `kbpgp 2.1.17`, `multiformats 13.4.2`

## Export map

| Export path | Module | Key exports |
|-------------|--------|-------------|
| `.` | `index.js` / `index.cjs` | `koad` object, re-exports from deps.js + pgp.js + identity.js |
| `./deps` | `deps.js` / `deps.cjs` | `dagJsonEncode`, `dagJsonDecode`, `CID`, `sha256`, `base64`, `ed`, `pgp` |
| `./pgp` | `pgp.js` / `pgp.cjs` (browser: `pgp.browser.js`) | `clearsign`, `verify` |
| `./ceremony` | `ceremony.js` | `generateEntropy`, `entropyToMnemonicString`, `mnemonicToSeed`, `mnemonicToSeedBip39`, `buildMasterKeyManager`, `buildLeafKeyManager`, `encryptLeafForStorage`, `decryptLeafFromStorage`, `generateDeviceKey`, `extractKMInfo` |
| `./ceremony-browser` | `ceremony-browser.js` | Browser-safe subset of ceremony helpers |
| `./sigchain` | `sigchain.js` / `sigchain.cjs` | `buildIdentityGenesis`, `buildLeafAuthorize`, `buildLeafRevoke`, `buildPruneAll`, `buildKeySuccession`, `buildEntityGenesis`, `buildEntityLeafAuthorize`, `buildEntityLeafRevoke`, `wrapEntry`, `canonicalDagJson`, `preImageBytes`, `computeCID`, `signEntry`, `verifyEntry`, `verifyChain` |
| `./identity` | `identity.js` / `identity.cjs` | `createKoadIdentity`, `createIdentityShape` (deprecated), `createIdentity` (deprecated) |
| `./identity-submission` | `identity-submission.js` / `.cjs` | `buildHeadSubmission`, `verifyHeadSubmission` |
| `./identity-resolver` | `identity-resolver.js` / `.cjs` | `resolveIdentity` |
| `./identity-writer` | `identity-writer.js` / `.cjs` | `writeIdentityRegistry`, `updateSigchainHead` |
| `./identity-receiver` | `identity-receiver.js` / `.cjs` | `receiveHeadSubmission`, `queryIdentityHeads` |
| `./auth` | `auth.js` / `auth.cjs` | `challenge`, `respond`, `verify`, `pendingNonceCount`, `sweepExpiredNonces` |

## Module-by-module summary

### index.js — core koad object

Creates and exports the canonical `koad` object. Carries `koad.deps.*` (crypto primitives), `koad.identity` (populated by createKoadIdentity on boot), `koad.format.timestamp()`, and array hooks (`seeders`, `emitters`, `trackers`). In Meteor apps, `koad` is a global; outside Meteor, `import { koad } from '@koad-io/node'`.

### deps.js — ESM dependency hub

Single place for importing the five ESM-only npm dependencies. Consumers import named symbols here rather than directly from npm packages — this is especially important for Meteor, which needs to shim ESM-only modules via a single known require path. The `pgp` export bundles `{ clearsign, verify }` per SPEC-148.

### pgp.js — PGP sign/verify (SPEC-148)

Two operations over kbpgp: `clearsign(body, km)` and `verify(clearsignArmored, publicKey)`. Critical invariants:
- `find_signing_pgp_key()` called **synchronously** — the async variant hangs on Node 22.
- `verify()` **never throws** on bad signature — returns `{ verified: false, error }`.
- Output of `verify()` normalizes CRLF → LF and strips BOM.

### identity.js — koad.identity factory (SPEC-149)

`createKoadIdentity()` returns an object with the full SPEC-149 API. Lifecycle: `create()` (genesis ceremony, returns mnemonic for display), `load()` (routine boot from persisted key), `lockdown()` (scrub master+mnemonic, transition to 'routine'), `importMnemonic()` (recovery). State getters: `isLoaded`, `isMasterLoaded`, `handle`, `fingerprint`, `masterFingerprint`, `sigchainHeadCID`, `publicKey`, `masterPublicKey`, `type`, `posture`. Backwards-compat: `setFromKeyManager()` for old identity-init.js callers.

### ceremony.js — BIP39 + Ed25519 key derivation (SPEC-149 §6-8)

Pure functions, no side effects. Two derivation paths:
- **Raw entropy path** (`mnemonicToSeed`): `entropy → mnemonic → entropy bytes → Ed25519 seed`. Used for genesis keys.
- **PBKDF2 path** (`mnemonicToSeedBip39`): BIP39-compliant PBKDF2-HMAC-SHA512 with optional passphrase. Used when `--bip39-passphrase` is provided. The two paths produce different keys from the same mnemonic — use consistently within one identity lifecycle.

Key construction: `buildMasterKeyManager(seed, userid)` → deterministic EDDSA+ECDH kbpgp KeyManager. `buildLeafKeyManager(userid)` → random ECC per-device key. At-rest: `encryptLeafForStorage(km, passphrase)` / `decryptLeafFromStorage(armored, passphrase)`.

### sigchain.js — sigchain entry layer (SPEC-111)

Pure functional library. No filesystem, no HTTP, no Meteor globals. Two entry-type families:
- `koad.identity.*` — genesis, leaf-authorize, leaf-revoke, prune-all, key-succession
- `koad.entity.*` — genesis, leaf-authorize, leaf-revoke (SPEC-175)

Canonical serialization: dag-json codec 0x0129, keys sorted lexicographically. CID: CIDv1 sha2-256 base32 ("bagu" prefix). Signing: `signEntry(unsignedEntry, identity)` → `Promise<{ entry, cid }>`. Chain walker: `verifyChain(entries)` validates each entry, reconstructs authorized leaf set.

### identity-submission.js — head submission (SPEC-150 v1.0)

Builds and verifies sigchain head submission messages. A submission announces a new sigchain tip CID signed by the entity's leaf (or master for ceremonies). `buildHeadSubmission()` produces the submission JSON + canonical bytes. `verifyHeadSubmission()` checks signature validity, timestamp window, and authorized signer. Design: pure functions, no filesystem, no HTTP.

### identity-resolver.js — registry reader (SPEC-024 v1.3)

Read-only. Reads `~/.vesta/entities/<handle>/sigchain/` from disk. Two modes:
- **Lite** (default): returns static metadata (masterFingerprint, masterPublicKey, sigchainHeadCID, status, created).
- **Full** (`walk: true`): also runs `verifyChain()` against caller-provided entries, returning `leafSet`.

Entities without a sigchain dir return `{ resolved: false, reason: 'no-sigchain' }`.

### identity-writer.js — registry writer (SPEC-024 v1.3 §12.5)

Atomic filesystem writes (temp-file → rename) to `~/.vesta/entities/<handle>/sigchain/`. Two entry points:
- `writeIdentityRegistry()` — full write on first creation or full update (metadata.json, master.pub.asc, entries/ dir).
- `updateSigchainHead()` — lightweight tip-only update after each append.

File modes: 0o700 for dirs, 0o600 for files.

### identity-receiver.js — submission receiver (SPEC-150 v1.1)

Server-side receiver. Handles the full SPEC-150 verification sequence: protocol check, handle lookup, IPFS chain walk (caller-provided `ipfsFetch`), conflict resolution, idempotency/replay checks, bootstrapping (first publication), storage effects. Returns `{ httpStatus, body }` per SPEC-150 §10 error codes. Also provides `queryIdentityHeads()` for bulk-fetch with pagination.

### auth.js — sovereign auth primitive

Ed25519 challenge-response authentication. No Meteor globals, no globalThis assumptions — pure Node. Protocol: `challenge()` issues a hex nonce stored in-memory with 5-minute TTL. `respond(nonce, privateKey)` signs `"koad-io:auth:v1:<nonce>"` with @noble/ed25519. `verify(nonce, sig, pubKey)` checks TTL, sig validity, then consumes the nonce (single-use). `sweepExpiredNonces()` called by the Meteor wrapper via setInterval.

### browser/ — kbpgp browser bundle

`kbpgp-with-internals.js` is the Browserify entry adding ceremony internals to the standard kbpgp bundle: `kbpgp.keywrapper`, `kbpgp.userid`, `kbpgp.ecc.ecdh`. Required by `ceremony-browser.js` for constructing deterministic Ed25519 KeyManagers in browser contexts. Build: `npm run build:browser` — output at `browser/kbpgp.bundle.js` and `.min.js`. Must be copied to the storefront's `public/` manually after build.

## Tests

Nine test files at package root. Each maps to its primary module:

| Test file | Module |
|-----------|--------|
| `test-auth.js` | auth.js |
| `test-bip39-passphrase.js` | ceremony.js (PBKDF2 path) |
| `test-identity-ceremony.js` | ceremony.js + identity.js |
| `test-identity-receiver.js` | identity-receiver.js |
| `test-identity-resolver.js` | identity-resolver.js |
| `test-identity-submission.js` | identity-submission.js |
| `test-identity-writer.js` | identity-writer.js |
| `test-leaf-storage.js` | ceremony.js at-rest encryption |
| `test-sigchain.js` | sigchain.js |
| `test-sigchain-walk.js` | sigchain.js verifyChain |

Tests are plain ESM scripts — no test runner framework. Run with `node test-<name>.js`.

## Who consumes this package

- `~/.koad-io/packages/accounts/server/auth.js` — imports `./auth` to wrap SovereignAuth
- `~/.koad-io/packages/daemon-api/server/api.js` — lazy-imports `./identity-receiver` via Npm.require
- `~/.forge/packages/sovereign-profiles/server/auth.js` — re-exports from `./auth` (bridge shim)
- `koad:io-core/both/identity-factory.js` — **parallel implementation** (not yet importing from here — migration planned)

## Meteor Runtime Resolution

This package is a local kingdom module — it lives at `~/.koad-io/modules/node/`, not on the npm registry. Meteor packages that `import ... from '@koad-io/node/...'` (like `koad:io-accounts/server/auth.js`) need the module to be resolvable at runtime via Node's `node_modules` resolution.

Meteor's reify compiler transforms ES module imports into `module.link()` calls that resolve from the **build directory**:
```
src/.meteor/local/build/programs/server/
```

Every Meteor project that consumes a package importing from `@koad-io/node` must have **two symlinks**:

### Source-level symlink (persists across rebuilds)
```bash
mkdir -p src/node_modules/@koad-io
ln -s /home/koad/.koad-io/modules/node src/node_modules/@koad-io/node
```

### Build-level symlink (wiped on `meteor reset`)
```bash
mkdir -p src/.meteor/local/build/programs/server/node_modules/@koad-io
ln -sf /home/koad/.koad-io/modules/node \
  src/.meteor/local/build/programs/server/node_modules/@koad-io/node
```

Use absolute paths for the build-level symlink — relative paths depend on build directory depth which can vary across Meteor versions.

If you see `Cannot find module '@koad-io/node/auth'` at runtime, the build-level symlink is missing. Re-create it and restart the Meteor process.

### Projects with these symlinks

| Project | Source | Build |
|---------|--------|-------|
| `~/.koad-io/daemon/` (framework) | ✓ | ✓ |
| `~/.forge/control-tower/` (business) | ✓ | ✓ |
| `~/.ecoincore/daemon/` (app) | ✓ | ✓ |

This is not automated — new Meteor projects that pull in `koad:io-accounts` need this set up manually. See `~/.koad-io/packages/accounts/PRIMER.md` for the consumer-side docs.

## Known drift

The KOAD_IO.md description reads "The Meteor package koad:io-core imports from here." This is the intended end state, not the current state. `koad:io-core` currently has its own `both/identity-factory.js` that mirrors `identity.js` for the `api.addFiles()` non-ESM context. The migration is planned but not landed. Vulcan should be aware: claims in KOAD_IO.md about koad:io-core importing from this package are aspirational.

---

*Livy walked this folder 2026-05-10. 11 discrete features documented. Drift flag filed.*
