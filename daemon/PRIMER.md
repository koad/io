---
type: primer
folder: ~/.koad-io/daemon/
parents:
  - ~/.koad-io/
children:
  - path: src/
    blurb: Live Meteor application source — the only thing that runs; edit here, hot-reload picks it up
    status: documented
  - path: src/server/
    blurb: App-level server files — effectors, workspace-entity mapping, kingdom signing keys, indexer loader
    status: documented
  - path: src/client/
    blurb: Operator dashboard UI — WidgetQuickLaunch, MerkleView, IndexersAdmin, KingdomOverview routing
    status: documented
  - path: src/server/indexers/
    blurb: App-level indexer loader (index.js only) — actual indexers now live in koad:io-daemon-indexers package
    status: documented
  - path: config/
    blurb: Per-device Meteor settings JSON — workspace-entity mapping, optional indexer overrides
    status: not-yet-walked
  - path: features/
    blurb: Older-format feature specs (pre-Arc 3 planning artifacts — not the current documentation layer)
    status: stub
  - path: archive/
    blurb: JSONL archive of closed emissions and flights — written by the daemon archiver
    status: not-yet-walked
  - path: builds/
    blurb: Obsolete — daemon is never built; this folder is a historical artifact
    status: stub
  - path: runtime/
    blurb: Runtime support files (patch scripts, ESM bridge)
    status: not-yet-walked
  - path: logs/
    blurb: One log file per daemon start — fresh file per invocation, hot-reload appends
    status: not-yet-walked
features:
  - name: daemon-emission-bus
    blurb: In-memory Emissions collection with DDP pub/sub, REST POST /emit, lifecycle (open/update/close), ancestry enrichment, trigger dispatch
    location: ~/.koad-io/packages/daemon-indexers/server/emissions.js
  - name: daemon-rest-api
    blurb: REST endpoints — /emit, /emit/update, /heartbeat, /flight, /health, /api/messages/counts, /api/indexers, /api/indexers/reload, /api/indexers/yaml, /api/identity-receiver
    location: ~/.koad-io/packages/daemon-api/server/api.js
  - name: daemon-entity-scanner
    blurb: Always-on background scanner — detects ~/.<name>/ entity dirs via .env + passenger.json; populates Entities collection; all other indexers depend on it
    location: ~/.koad-io/packages/daemon-indexers/server/indexers/entity-scanner.js
  - name: daemon-pluggable-indexers
    blurb: File-based indexer discovery via .koad-io-index.yaml in ~/.* and ~/.forge/* dirs; settings.json overrides; JSONL and post-folder projectors
    location: ~/.koad-io/packages/daemon-indexers/server/indexer-registry.js
  - name: daemon-merkle-tree
    blurb: On-demand kingdom merkle tree (VESTA-SPEC-173) — entity sigchain tips as leaves, sovereign sigchain as kingdom leaf, Ed25519-signed root
    location: ~/.koad-io/packages/daemon-indexers/server/merkle.js
  - name: daemon-kingdom-signing-key
    blurb: Ed25519 anchoring key loader/generator — persists to ~/.koad/kingdoms/<slug>/keys/anchoring-key.json; exposed as KingdomKeys globalThis
    location: ~/.koad-io/daemon/src/server/kingdom-keys.js
  - name: daemon-workspace-entity-mapping
    blurb: DDP methods workspace.setState / workspace.getActive — desktop app reports X11 workspace number; daemon marks matching Passenger as selected
    location: ~/.koad-io/daemon/src/server/workspace-entity.js
  - name: daemon-effectors
    blurb: Operator-triggered DDP methods — harness.launch, open.with.default.app, open.pwa, open.with.chrome, open.with.brave
    location: ~/.koad-io/daemon/src/server/effectors.js
  - name: daemon-operator-dashboard
    blurb: Blaze UI at / — route-dispatched to WidgetQuickLaunch (default), KingdomOverview (/overview), MerkleView (/merkle), IndexersAdmin (/indexers)
    location: ~/.koad-io/daemon/src/client/
relates-to:
  - ~/.koad-io/PRIMER.md
  - ~/.koad-io/packages/daemon-api/
  - ~/.koad-io/packages/daemon-indexers/
  - ~/.koad-io/packages/core/
  - ~/.koad-io/packages/workers/
  - ~/.livy/features/INDEX.md
entities:
  - vulcan
  - juno
last-walked: 2026-05-09
as-of: e96d9337de4b8ce946ad6be6c5cee441513e230f
---

# koad:io Daemon — Primer

> The kingdom's long-running backbone. The evolution space. Never built.

## What this is

The daemon is a Meteor 3.4 application that runs at the framework level. It provides entity state, process management, flight telemetry, emission streams, worker orchestration, and the operator dashboard. It is the central hub for viewing, managing, and orchestrating every entity in the kingdom.

**The daemon is not an entity.** It has no `ENTITY.md`, no trust bonds, no identity. It is framework infrastructure — invoked as `koad-io`, never as `<entity>`. The `.env` here pins `KOAD_IO_TYPE=daemon`.

## Posture — inside the walled garden

The daemon binds to the kingdom's private network interface — ZeroTier or Netbird — **never the public internet**. Default bind on wonderland is `10.10.10.10:28282` (the ZeroTier address). The only things that can reach it are:

- Other hosts on the same ZeroTier/Netbird network (fourty4, flowbie, zero.koad.sh, etc.)
- Services running on those hosts (kingofalldata.com Meteor app, entity harnesses, desktop widget)

There is **no authentication** on the daemon's HTTP surface. That is intentional — it runs inside the perimeter where the trust model is the network membership itself. Do not add public nginx routes to it. Do not bind it to `0.0.0.0`. If a service needs daemon data, put that service inside the perimeter too.

## The Evolution Space — never built

The daemon runs in **dev mode** (`koad-io start --local`, or via the `KOAD_IO_LOCAL=true` pin in `.env`) so meteor watches `src/`, hot-reloads on edit, and exposes `meteor shell` for live method calls. This is the one Meteor app in the kingdom that is never built — it is the place the kingdom evolves in real time. Every other Meteor app (websites, portals) gets bundled and shipped; the daemon stays fluid.

Corollary: if you're editing `~/.koad-io/daemon/src/**`, the running daemon picks up the change within seconds. No restart needed for most edits.

## Package architecture

The daemon's core logic now lives in two framework packages (not in `src/` directly):

| Package | What lives there |
|---------|-----------------|
| `koad:io-daemon-indexers` | 14 indexers (entity-scanner, alerts, bonds, keys, kingdoms, env, tickler, triggers, workers-scanner, documents, provisioner, founding-cohort-scanner, passengers, primers) + emissions bus + merkle tree + pluggable indexer registry |
| `koad:io-daemon-api` | REST API — /emit, /emit/update, /heartbeat, /flight, /health, /api/* endpoints + identity receiver |

App-level `src/server/` files handle things specific to one operator's daemon instance: workspace→entity mapping, kingdom signing key, end-effectors, and the indexer loader summary.

The 14 indexers in `daemon-indexers` are opt-in via `KOAD_IO_INDEX_<NAME>=true` in `.env` (except entity-scanner, alerts, entity-workers, and founding-cohort-scanner, which are always on).

## Guardrails that matter

### `MONGO_URL=false` — in-memory only

The daemon runs on **in-memory Mongo collections only**. No MongoDB process, no persistence across restarts — this is by design. Entity state of record lives on disk (`~/.<entity>/`) and the daemon reflects it; the daemon is not the source of truth, it is the live projection.

Every collection must be declared via the `koad.mongo` wrapper (see `~/.koad-io/packages/core`), which resolves `{ connection: null }` when `MONGO_URL=false`:

```js
// Right:
const Thing = new Mongo.Collection('Thing', koad.mongo);

// Also right (explicit form, used in the daemon's own src/):
const Thing = new Mongo.Collection('Thing', { connection: null });

// Wrong — will crash at boot with MongoParseError:
const Thing = new Mongo.Collection('Thing');
```

If the daemon crashes at boot with `MongoParseError: Invalid scheme, expected connection string to start with "mongodb://"` — some code declared a collection without going through the guardrail. Find the offender and add `koad.mongo` (or `{ connection: null }`). **Do not disable the guardrail.** Its whole point is to catch exactly that mistake.

### Load order in dev mode

Dev mode evaluates packages and app code in a different order than the built bundle. A file that references a global declared in another package (e.g. `Kingdoms`, `CrossKingdomBonds`) may fire before the declaring package evaluates, throwing `ReferenceError: X is not defined`.

The fix is always the same: declare a local ref to the collection in the consuming file. Meteor dedupes collections by name, so two `new Mongo.Collection('Name', { connection: null })` statements in different files resolve to the same in-memory store.

```js
// Top of an indexer that references Kingdoms from another file:
const Kingdoms = new Mongo.Collection('Kingdoms', { connection: null });
```

### Strict-mode globals

The daemon source is evaluated as ES modules (implicitly strict). Implicit global assignment does not work:

```js
// Wrong — ReferenceError under strict mode:
FlightsCollection = Flights;

// Right:
globalThis.FlightsCollection = Flights;
```

## How to run it

### First start (or after env changes)

```bash
cd ~/.koad-io/daemon
koad-io start --local
```

The `--local` flag forces dev mode. Even without it, `KOAD_IO_LOCAL=true` in `.env` will keep it in dev — but passing `--local` explicitly is the safest form when restarting from a fresh shell.

The command runs the env cascade (`~/.koad-io/.env` → `~/.koad-io/daemon/.env` → `config/<hostname>.json`), opens a screen named `koad-io-daemon`, and pipes output to `logs/<timestamp>.log`.

### Restart

```bash
# Kill the current screen
screen -S koad-io-daemon -X quit

# Wait for the port to release (meteor proxies and workers can linger briefly)
until ! ss -tlnp 2>/dev/null | grep -q 28282; do sleep 1; done

# Start again
cd ~/.koad-io/daemon && koad-io start --local
```

### Quick hot reload

You rarely need to restart. Meteor watches `src/` — editing any file under there triggers an automatic restart within seconds. Check the log to confirm:

```bash
tail -f ~/.koad-io/daemon/logs/$(ls -t ~/.koad-io/daemon/logs/*.log | head -1 | xargs basename)
```

Only restart manually when: you changed `.env`, you changed a package in `~/.koad-io/packages/`, or meteor got into a bad state.

## How to test

### Is it alive?

```bash
curl -sS -o /dev/null -w "HTTP %{http_code}\n" http://10.10.10.10:28282/
```

`HTTP 200` = healthy. Anything else = check the log.

### What's in memory?

Meteor shell lets you query collections and call methods directly against the live process:

```bash
cd ~/.koad-io/daemon/src && meteor shell
```

```js
// In the shell:
Passengers.find().count()                    // how many entities indexed
Flights.find({ status: 'flying' }).fetch()   // currently airborne
Emissions.find({}, { sort: { timestamp: -1 }, limit: 10 }).fetch()
```

### Send a test emission

```bash
curl -sS -X POST http://10.10.10.10:28282/emit \
  -H "Content-Type: application/json" \
  -d '{"entity":"juno","type":"notice","body":"test"}'
```

Check the log — you should see `[EMIT/REST] juno/notice: test`.

### Dashboard

Open the daemon URL in a browser (from inside the ZeroTier/Netbird network): `http://10.10.10.10:28282/`. The operator dashboard renders from `src/client/`. Routes: `/overview` (KingdomOverview), `/merkle` (MerkleView), `/indexers` (IndexersAdmin), `/` (WidgetQuickLaunch).

## What lives where

```
~/.koad-io/daemon/
├── .env                       # KOAD_IO_* + KOAD_IO_LOCAL=true + MONGO_URL=false
├── config/<hostname>.json     # Per-device Meteor settings
├── src/                       # THE LIVE SOURCE — edit here, hot reload picks it up
│   ├── .meteor/               # Meteor runtime (don't touch)
│   ├── server/
│   │   ├── effectors.js       # harness.launch, open.*, DDP methods
│   │   ├── kingdom-keys.js    # Ed25519 signing key loader/generator
│   │   ├── workspace-entity.js  # workspace→entity mapping (desktop widget)
│   │   └── indexers/
│   │       └── index.js       # Indexer loader summary (prints active/inactive)
│   └── client/                # Operator dashboard UI
│       ├── application-logic.js  # Template routing, WidgetQuickLaunch
│       ├── indexers.js/html/css  # IndexersAdmin — /indexers panel
│       ├── merkle.js/html/css    # MerkleView — /merkle panel
│       ├── templates.html        # Body router + WidgetQuickLaunch template
│       └── styles.css            # Global dashboard styles
├── builds/                    # Obsolete — daemon is never built anymore
├── logs/<timestamp>.log       # Every start writes a fresh log
└── features/                  # Older feature specs (planning artifacts, pre-Arc 3)
```

Packages consumed (from `~/.koad-io/packages/`):
- `koad:io-core` — koad.mongo wrapper, logger, identity, search, collections
- `koad:io-daemon-indexers` — 14 indexers + emissions bus + merkle + pluggable registry
- `koad:io-daemon-api` — REST API
- `koad:io-merkle-tree` — merkle tree builder (consumed by daemon-indexers)
- `koad:io-declarations` — declarations collection
- `koad:io-emission-types` — emission type registry
- `koad:io-session-history` — session persistence
- `kingofalldata:brand-components` — shared Blaze components (KingdomOverview)

## What it does

- **Entity state** — entity dirs scanned into `Entities` collection by entity-scanner; kept current by periodic re-scan
- **Emissions** — entities push notices/warnings/errors/requests via REST `/emit` or DDP `entity.emit`; stored as in-memory `Emissions` collection; consumed via DDP subscription by dashboard and bridge layers
- **Indexers** — 14 opt-in background indexers (bonds, keys, tickler, env, kingdoms, alerts, documents, passengers, primers, etc.) keep collections fresh on recurring schedules
- **Pluggable indexers** — external `.koad-io-index.yaml` files declare additional JSONL/post-folder indexers discovered at boot
- **Merkle tree** — on-demand VESTA-SPEC-173 kingdom merkle tree signed with the Ed25519 sovereign key
- **Worker orchestration** — `koad:io-workers` package manages periodic worker-process lifecycle
- **Dashboard** — operator view at `/` — the kingdom's single pane of glass

## Two-process kingdom shape — which port for what

The kingdom runs two Meteor processes. Send requests to the right one:

| Port | Process | What lives here |
|------|---------|-----------------|
| **28282** | `~/.koad-io/daemon/` — emitter + interrupter | Entity index, emissions bus, triggers, DDP pub, operator dashboard |
| **28283** | `~/.forge/control-tower/` — control-surface | Harness telemetry, flights, sessions, Postgres audit, Mercury posts, archive ingestion, forge enrichments |

`kingofalldata.com` points at **control-tower (28283)** — all public-facing consumers should too. The daemon (28282) is for low-level harness emission posts, mesh probes, and control-tower's own subscription.

**Flight telemetry goes to 28283, not 28282.** `POST /flight` calls methods only defined in control-tower's `flights.js` — it will fail or no-op on the daemon. Harnesses set `KOAD_IO_CONTROL_URL` (28283) for flight reporting and `KOAD_IO_DAEMON_URL` (28282) for emission posts.

Shared packages (`koad:io-daemon-indexers`, `koad:io-daemon-api`, etc.) run identically in both processes — the difference is what forge-layer packages control-tower adds on top.

## What it is not

- Not an entity. No ENTITY.md, no trust bonds, no identity.
- Not a source of truth. Entity state of record lives on disk; the daemon reflects it.
- Not public. Bound to ZeroTier/Netbird, no auth, trust is network membership.
- Not built. Always runs from `src/` with hot reload. Every other Meteor app in the kingdom gets built; the daemon stays fluid.
- Not the flight telemetry store. Flight logs live on disk in `~/.<entity>/control/flights/`; the daemon reflects the live projection only.
