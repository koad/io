# koad:io-core

Foundation package for the koad:io framework. Initializes the global `koad` object that every other koad:io package extends. Without this package, nothing else runs.

## What It Does

- Creates the `koad` global namespace (both client and server)
- Bootstraps server identity via kbpgp (sign, verify, encrypt, decrypt)
- Registers core MongoDB collections (errors, events, devices, sessions, processes, statistics, services, consumables, supporters)
- Sets up server-side logging via signale
- Runs system telemetry — device heartbeat, process tracking, orphan detection
- Provides time constants (`SECONDS`, `MINUTES`, `HOURS`, `DAYS`, `WEEKS`, `MONTHS`, `YEARS`)
- Provides utility functions (`koad.generate.cid`, `koad.generate.mnemonic`, `koad.generate.checksum`, `koad.collection()`)
- Registers a cron scheduler (`koad.cron.create`)
- Provides global search (server registry + client local/remote search)
- Exposes shared crypto deps on the client (`koad.deps` — dag-json, multiformats, noble/ed25519)
- Exposes instance discovery at `/.well-known/koad-io.json`

## Quick Start

Create a new app:

```
meteor create --bare src
```

Replace the contents of `.meteor/packages` with:

```
koad:io-core
```

That gives you the full foundation — `koad` global, logging, collections, identity, telemetry. Add more koad:io packages on top as needed.

## Environment

- `ENTITY` — identifies the running entity (e.g. `juno`). Without it, no database is connected and identity initialization is skipped.
- `MONGO_URL` — set to `false` for in-memory-only mode (no persistence).
- `KOAD_IO_PORTABLE` — when `true`, forces all collections to local (no MongoDB writes).

## The `koad` Global

Initialized in `both/initial.js`, extended by server and client upstart:

```javascript
koad.maintenance    // true until the consuming app says otherwise
koad.entity         // from ENTITY env var
koad.identity       // kbpgp sign/verify/encrypt/decrypt (server), stub (client)
koad.generate       // cid, uuid, nonce, mnemonic, checksum, device
koad.collection()   // collection factory (persistent / local / portable)
koad.search         // search registry (server: register collections, client: local + remote)
koad.cron           // cron job creation and validation
koad.crontab        // raw cron module access
koad.counters       // in-memory counter helpers
koad.deps           // shared crypto/IPFS deps (client)
```

## Documentation

Full documentation: https://book.koad.sh/
