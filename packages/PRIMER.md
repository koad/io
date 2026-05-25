---
type: primer
folder: ~/.koad-io/packages/
parents:
  - ~/.koad-io/
children:
  - path: core/
    blurb: koad:io-core (v3.6.9) — global koad object, server collections, identity, crypto, cron, sysinfo
    status: documented
  - path: koad-io/
    blurb: koad:io (v8.8.8) — umbrella meta-package; implies core + router + session + templating + head-js
    status: documented
  - path: koad-io-core/
    blurb: Empty placeholder directory — not a functional package; do not confuse with core/
    status: stub
  - path: harness/
    blurb: harness tools/ directory — not a Meteor package (no package.js). Former harness package moved to ~/.koad-io/harness/bridge-server.js
    status: stub
  - path: accounts/
    blurb: koad:io-accounts (v3.6.9) — RBAC, invitations, OAuth, sovereign auth, session management
    status: documented
  - path: router/
    blurb: koad:io-router (v3.6.9) — Iron Router for koad:io; client + server routing + middleware
    status: documented
  - path: session/
    blurb: koad:io-session (v3.6.9) — localStorage-persistent client Session via amplifyjs
    status: documented
  - path: search/
    blurb: koad:io-search (v3.6.9) — koadSearchBox/koadSearchResults templates with local + server search
    status: documented
  - path: head-js/
    blurb: koad:io-plus-head-js (v3.6.9) — Head.js integration for browser feature detection
    status: stub
  - path: logger/
    blurb: koad:io-event-logger (v0.3.0) — client window.onerror capture → ClientErrors collection
    status: documented
  - path: workers/
    blurb: koad:io-worker-processes (v0.0.1) — koad.workers.start() scheduled background workers with hot-reload safety
    status: documented
  - path: daemon-indexers/
    blurb: koad:io-daemon-indexers (v0.0.1) — 14 kingdom indexers + registry + JSONL projectors + merkle; backbone of the daemon
    status: documented
  - path: daemon-api/
    blurb: koad:io-daemon-api (v0.0.1) — 12+ daemon REST endpoints (/emit, /flight, /health, /declarations, etc.)
    status: documented
  - path: declarations/
    blurb: koad:io-declarations (v0.0.1) — VESTA-SPEC-147 sovereign declarations indexer + DeclarationsIndex
    status: documented
  - path: emission-types/
    blurb: koad:io-emission-types (v0.0.1) — per-entity types.yaml registry + /api/emissions/types REST
    status: documented
  - path: session-history/
    blurb: koad:io-session-history (v0.0.1) — session JSONL archive indexer → Sessions + SessionFiles + sidecar projector
    status: documented
features:
  - name: framework-packages-layer
    blurb: Local Meteor packages loaded via KOAD_IO_PACKAGE_DIRS — not published to Atmosphere, loaded directly by any koad:io Meteor app
    location: ~/.koad-io/packages/
  - name: framework-graduation-path
    blurb: Daemon-extracted packages (daemon-indexers, daemon-api, declarations, emission-types, session-history, harness) graduate from inline daemon code into installable packages for any koad:io app
    location: ~/.koad-io/packages/
relates-to:
  - ~/.koad-io/PRIMER.md
  - ~/.koad-io/daemon/PRIMER.md
  - ~/.livy/features/INDEX.md
entities:
  - vulcan
  - juno
  - livy
last-walked: 2026-05-10
as-of: a60d06f3bfc30afa2a006bfdc8e09adb0e4dac9b
---

# ~/.koad-io/packages/ — Framework Meteor Packages

The shared Meteor package layer of the koad:io framework. These are local Meteor packages — not published to Atmosphere, not installed via npm — loaded directly by any Meteor application that sets:

```bash
KOAD_IO_PACKAGE_DIRS="$HOME/.koad-io/packages"
METEOR_PACKAGE_DIRS=$KOAD_IO_PACKAGE_DIRS  # Meteor compat shim
```

## Package inventory (2026-05-10)

16 directories; 15 functional packages (1 placeholder: `koad-io-core/`).

### Foundation (add these to every new app)

| Directory | Meteor name | Version | Purpose |
|-----------|-------------|---------|---------|
| `core/` | `koad:io-core` | 3.6.9 | Global `koad` object, server collections, identity, crypto, cron |
| `koad-io/` | `koad:io` | 8.8.8 | Umbrella — implies core + router + session + templating + head-js |

### UI and Routing

| Directory | Meteor name | Version | Purpose |
|-----------|-------------|---------|---------|
| `router/` | `koad:io-router` | 3.6.9 | Iron Router (client + server routes, middleware) |
| `session/` | `koad:io-session` | 3.6.9 | localStorage-persistent client Session |
| `search/` | `koad:io-search` | 3.6.9 | Search box + results templates |
| `head-js/` | `koad:io-plus-head-js` | 3.6.9 | Head.js browser feature detection |

### Accounts

| Directory | Meteor name | Version | Purpose |
|-----------|-------------|---------|---------|
| `accounts/` | `koad:io-accounts` | 3.6.9 | RBAC, invitations, OAuth, sovereign auth |

### Infrastructure

| Directory | Meteor name | Version | Purpose |
|-----------|-------------|---------|---------|
| `logger/` | `koad:io-event-logger` | 0.3.0 | Client error capture → ClientErrors collection |
| `workers/` | `koad:io-worker-processes` | 0.0.1 | `koad.workers.start()` background workers |
| `harness/` | _(not a package)_ | — | Tools directory only. Bridge protocol → `~/.koad-io/harness/bridge-server.js`. Conversation harness → `~/.forge/packages/harness/`. |

### Daemon packages (extracted from kindergarten daemon)

These graduate from inline daemon code into installable packages. The daemon uses all five:

| Directory | Meteor name | Version | Purpose |
|-----------|-------------|---------|---------|
| `daemon-indexers/` | `koad:io-daemon-indexers` | 0.0.1 | 14 indexers + JSONL projectors + merkle builder |
| `daemon-api/` | `koad:io-daemon-api` | 0.0.1 | 12+ REST endpoints + admin API |
| `declarations/` | `koad:io-declarations` | 0.0.1 | Sovereign declarations indexer (VESTA-SPEC-147) |
| `emission-types/` | `koad:io-emission-types` | 0.0.1 | Per-entity emission type registry |
| `session-history/` | `koad:io-session-history` | 0.0.1 | Session JSONL archive indexer |

### Placeholder (not functional)

| Directory | Note |
|-----------|------|
| `koad-io-core/` | Empty — no `package.js`. Not the same as `core/`. |

## Drift findings (2026-05-10)

**STRUCTURE.md is significantly stale.** It claims 19 packages including `accounts-ui`, `activity-stream`, `awesome-qr`, `ipfs-client`, `navigation`, `sovereign-profiles`, `templating`, `theme-engine` — none of which exist on disk. It also omits the 6 daemon extraction packages (`daemon-api`, `daemon-indexers`, `declarations`, `emission-types`, `harness`, `session-history`) that are the most active work in this directory.

**Action required (Vulcan):** Update `STRUCTURE.md` to match the disk reality. The file's package inventory, dependency tree, and "how to find things" sections are all out of date. Route this as a Vulcan task — the PRIMER (this file) now serves as the accurate inventory.

## Dependency tree (current)

```
koad:io                      ← start here for new apps
├── koad:io-core             ← always required
├── koad:io-router           ← routing
├── koad:io-session          ← persistent session
├── koad:io-templating       ← Blaze helpers + layout (lives in ~/.forge/)
├── koad:io-plus-head-js     ← browser detection
└── accounts-base            ← Meteor accounts

Optional, add on top:
koad:io-accounts             ← full auth system
koad:io-event-logger         ← client error capture
koad:io-search               ← search UI
koad:io-worker-processes     ← background workers

Daemon stack (add all five together):
koad:io-daemon-indexers      ← kingdom indexers
koad:io-daemon-api           ← REST endpoints
koad:io-declarations         ← declaration indexer (SPEC-147)
koad:io-emission-types       ← type registry
koad:io-session-history      ← session archive indexer
```

## Package format reference

Every `package.js` follows this structure:

```javascript
Package.describe({
  name: 'koad:io-example',   // meteor add koad:io-example
  version: '3.6.9',
  summary: 'One-line description',
  documentation: 'README.md'
});

Package.onUse(function(api) {
  api.versionsFrom(['3.0']);
  api.use('koad:io-core');    // dependencies
  api.imply('koad:io-core');  // re-export to consumers
  api.addFiles([...], 'client' | 'server' | /* both */);
  api.export('GlobalSymbol');
});
```

`api.imply()` re-exports a dependency to every consuming app. This is how `koad:io` bundles everything with one `meteor add`.

---

*Livy walked this folder 2026-05-10. STRUCTURE.md is confirmed stale — see drift findings above. This PRIMER is now the authoritative package inventory.*
