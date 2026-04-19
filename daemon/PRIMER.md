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

Open the daemon URL in a browser (from inside the ZeroTier/Netbird network): `http://10.10.10.10:28282/`. The operator dashboard renders from `src/client/`.

## What lives where

```
~/.koad-io/daemon/
├── .env                       # KOAD_IO_* + KOAD_IO_LOCAL=true + MONGO_URL=false
├── config/<hostname>.json     # Per-device Meteor settings
├── src/                       # THE LIVE SOURCE — edit here, hot reload picks it up
│   ├── .meteor/               # Meteor runtime (don't touch)
│   ├── server/
│   │   ├── api.js             # HTTP endpoints (POST /emit, POST /flight)
│   │   ├── flights.js         # Flight telemetry collection + methods
│   │   ├── emissions.js       # Emission bus collection + methods
│   │   ├── effectors.js       # harness.launch, process spawning
│   │   ├── workspace-entity.js  # Workspace → entity mapping (desktop widget)
│   │   └── indexers/          # Background workers (bonds, keys, tickler, env,
│   │                          #   entity-scanner, kingdoms, passengers, alerts)
│   └── client/                # Operator dashboard UI
├── builds/                    # Obsolete — daemon is never built anymore
├── logs/<timestamp>.log       # Every start writes a fresh log
└── features/                  # Feature specs (planning artifacts)
```

Packages consumed (from `~/.koad-io/packages/`):
- `core` — koad.mongo wrapper, logger, identity, search, collections
- `workers` — periodic worker-process framework (WorkerProcesses collection)
- `harness` — harness integration (not always active in daemon)

## What it does

- **Entity state** — 22 entities indexed into `Passengers` collection on startup; kept current by the `entity-scanner` indexer
- **Flight telemetry** — entities POST to `/flight` on dispatch and landing; the `Flights` collection is the live projection (full logs stay on disk in `~/.<entity>/control/flights/`)
- **Emissions** — entities push notices/warnings/errors/requests via `/emit`; consumed via DDP by the dashboard for a live stream
- **Worker orchestration** — periodic indexers (bonds every 2 min, keys, tickler, env, entity-scanner, kingdoms, alerts) keep the collections fresh
- **Dashboard** — operator view at `/` — the kingdom's single pane of glass

## What it is not

- Not an entity. No ENTITY.md, no trust bonds, no identity.
- Not a source of truth. Entity state of record lives on disk; the daemon reflects it.
- Not public. Bound to ZeroTier/Netbird, no auth, trust is network membership.
- Not built. Always runs from `src/` with hot reload. Every other Meteor app in the kingdom gets built; the daemon stays fluid.
