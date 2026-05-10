---
type: primer
folder: ~/.koad-io/daemon/src/server/
parents:
  - ~/.koad-io/daemon/
children:
  - path: indexers/
    blurb: App-level indexer loader summary only — actual indexer logic lives in koad:io-daemon-indexers package
    status: documented
features:
  - name: daemon-effectors
    blurb: DDP methods — harness.launch, open.with.default.app, open.pwa, open.with.chrome/brave
    location: ~/.koad-io/daemon/src/server/effectors.js
  - name: daemon-kingdom-signing-key
    blurb: Ed25519 kingdom signing key loader/generator; KingdomKeys globalThis; VESTA-SPEC-115 §14.2
    location: ~/.koad-io/daemon/src/server/kingdom-keys.js
  - name: daemon-workspace-entity-mapping
    blurb: workspace.setState / workspace.getActive DDP methods; X11 workspace → entity handle → Passenger.selected
    location: ~/.koad-io/daemon/src/server/workspace-entity.js
relates-to:
  - ~/.koad-io/daemon/PRIMER.md
  - ~/.koad-io/packages/daemon-indexers/
  - ~/.koad-io/packages/daemon-api/
entities:
  - vulcan
  - juno
last-walked: 2026-05-09
as-of: e96d9337de4b8ce946ad6be6c5cee441513e230f
---

# daemon/src/server/ — App-Level Server Files

The `src/server/` directory holds the files that are specific to one operator's daemon instance. The bulk of the daemon's business logic (indexers, REST API, emission bus) graduated into framework packages; what remains here is the operator-specific layer.

## Files

| File | Feature | Purpose |
|------|---------|---------|
| `effectors.js` | daemon-effectors | DDP methods for operator-triggered actions (harness launch, browser open) |
| `kingdom-keys.js` | daemon-kingdom-signing-key | Ed25519 kingdom signing key — loads or generates at boot |
| `workspace-entity.js` | daemon-workspace-entity-mapping | X11 workspace → entity mapping for the desktop widget |
| `indexers/index.js` | (indexer loader) | Prints active/inactive indexer summary at Meteor.startup() |

## The indexers/ subdirectory

`src/server/indexers/index.js` is the only file in `indexers/` now. It is a startup logger that reads the `KOAD_IO_INDEX_*` env vars and prints which of the 14 package-level indexers are active. The actual indexer implementations live in `~/.koad-io/packages/daemon-indexers/server/indexers/`.

## What graduated to packages

Before the package extraction arc (commits `d754e0f` through `a76e2c1`), this directory also contained:
- `api.js` → now `~/.koad-io/packages/daemon-api/server/api.js`
- `emissions.js` → now `~/.koad-io/packages/daemon-indexers/server/emissions.js`
- `flights.js` → removed (graduation to daemon-indexers)
- `sessions.js` → removed (graduation)
- Several forge-layer files (bonds, keys, tickler, etc.) → now in daemon-indexers package

This history is load-bearing for anyone reading old git blame on these paths.
