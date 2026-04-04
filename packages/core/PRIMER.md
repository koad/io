# PRIMER: koad:io-core

**Meteor package name:** `koad:io-core`  
**Version:** 3.6.9  
**State:** Built, active — foundation of the entire stack

---

## What It Does

Initializes the global `koad` object and sets up the framework foundation that every other koad:io package extends. Without this package, nothing else runs. It:

- Creates `koad` (the shared global namespace) in `both/initial.js`
- Bootstraps server identity, system info, and process metadata
- Registers MongoDB collections for events, errors, devices, sessions, processes, statistics, services, and consumables
- Sets up server-side logging via `signale`
- Provides time constants (`SECONDS`, `MINUTES`, `HOURS`, etc.) and utility functions
- Registers a cron scheduler
- Provides entity/identity discovery (machine ID, IPFS, SSH, PGP via `kbpgp`)
- Runs a client-side search stub and router stub
- Exposes `GlobalSearch` (server) and `SearchHistory` (client)

## Dependencies

**npm:** `signale`, `ua-parser`, `os`, `pidusage`, `simpl-schema`, `node-machine-id`, `cron`, `systeminformation`, `@scure/bip39`, `ssh2`, `kbpgp`, `ipfs-core`, `ipfs-http-client`

**Meteor implied (pushed to consuming apps):** `meteor-base`, `mongo`, `blaze-html-templates`, `jquery`, `reactive-var`, `reactive-dict`, `tracker`, `standard-minifier-css`, `standard-minifier-js`, `es5-shim`, `ecmascript`, `typescript`, `shell-server`, `ddp-rate-limiter`

## Key Exports

| Export | Scope | Description |
|--------|-------|-------------|
| `koad` | both | Global namespace object |
| `log` | server | Signale logger instance |
| `Counters` | server | MongoDB counters collection |
| `ApplicationEvents` | server | App event log |
| `ApplicationErrors` | server | Error log |
| `ApplicationDevices` | server | Connected devices |
| `ApplicationProcesses` | server | Process tracking |
| `ApplicationStatistics` | server | Stats collection |
| `ApplicationServices` | server | External services |
| `ApplicationSessions` | server | Session tracking |
| `ApplicationConsumables` | server | One-time use tokens |
| `ApplicationSupporters` | server | Supporter records |
| `GlobalSearch` | server | Search registry |
| `SearchHistory` | client | Client search history |
| `SECONDS`, `MINUTES`, `HOURS`, `DAYS`, `WEEKS`, `MONTHS`, `YEARS` | both | Time constants |
| `allow`/`ALLOW`, `deny`/`DENY` | both | Permission helpers |
| `debug`/`DEBUG` | both | Debug flags |

## The `koad` Global

Set in `both/initial.js`, then extended in `server/upstart.js`:

```javascript
koad = {
  maintenance: true,
  instance: null,
  entity: process.env.ENTITY,
  environment: process.env.NODE_ENV,
  identity: {},
  storage: {},
  library: {},
  format: { timestamp: fn },
  seeders: [],
  emitters: [],
  trackers: [],
  error: async fn,   // logs to ApplicationErrors
  // ...extended by other packages
}
```

## Environment Variables

- `ENTITY` — identifies the entity (e.g. `sibyl`, `juno`). Without it, no DB is connected.
- `NODE_ENV` — standard environment flag
- `KOAD_IO_SOURCE` — tags errors with source identifier
- `HOSTNAME` — asset identifier for error logs

## File Map

```
both/
  initial.js        ← creates koad global (loads first)
  utils.js          ← utility functions
  time-constants.js ← SECONDS, MINUTES, etc.
  global-helpers.js ← shared Blaze/template helpers
  router.js         ← router stub/bootstrap
server/
  logger.js         ← signale setup, exports `log`
  upstart.js        ← extends koad with server metadata
  collections.js    ← all MongoDB collections
  discovery.js      ← machine/entity discovery
  identity.js       ← identity management
  identity-init.js  ← identity bootstrap
  sysinfo.js        ← system information polling
  counters.js       ← counter utilities
  search.js         ← GlobalSearch registry
  cron.js           ← cron job scheduler
client/
  upstart.js        ← client-side bootstrap
  search.js         ← SearchHistory
  identity.js       ← client identity stub
test/
  utils_test.js
```

## Known Issues / Notes

- `ipfs-core` and `ipfs-http-client` are heavy npm deps — IPFS integration may be experimental
- Some npm deps are commented out in package.js (`bitcoinjs-lib`, `@scure/bip32`, `ethereum-cryptography`) — partially disabled features
- `hot-module-replacement` and `blaze-hot` are commented out
- `koad.maintenance` starts as `true` — consuming apps must set it to `false` after ready
