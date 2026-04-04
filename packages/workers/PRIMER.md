# PRIMER: koad:io-worker-processes

**Meteor package name:** `koad:io-worker-processes`  
**Version:** 0.0.1  
**State:** Early / functional — server-only, no README documentation in package.js

---

## What It Does

Server-side background worker management for Meteor apps. Runs scheduled async tasks at configured intervals with error handling, exponential backoff retry, hot-reload detection, and MongoDB persistence for worker state.

Use when you need recurring background jobs (data sync, cleanup, polling external APIs) that survive Meteor hot reloads without creating zombie processes.

## Dependencies

**Meteor:** `mongo`, `random`, `koad:io-core`

**npm:** `os` (Node built-in)

**Server only** — no client component.

## Key Exports

| Export | Scope | Description |
|--------|-------|-------------|
| `koad` | server | Extended with `koad.workers` API |
| `WorkerProcesses` | server | MongoDB collection for worker state |

## API

### Start a worker

```javascript
Meteor.startup(async () => {
  const worker = await koad.workers.start({
    service: 'my-sync',       // unique name
    interval: 60,             // run every 60 minutes
    delay: 1,                 // start 1 min after interval boundary
    runImmediately: false,    // skip the first run
    task: async () => {
      // your async work here
    }
  });

  // Stop later
  await worker.stop();
});
```

### Get diagnostics

```javascript
const diagnostics = await koad.workers.getDiagnostics();
// { currentPid, currentInstanceId, activeWorkers, staleWorkers, intervalHandles }
```

## Configuration Constants

| Constant | Default | Description |
|----------|---------|-------------|
| `MIN_INTERVAL_MINUTES` | 1 | Min interval (1 min) |
| `MAX_INTERVAL_MINUTES` | 1440 | Max interval (24 hrs) |
| `MAX_RETRY_ATTEMPTS` | 3 | Retries before marking `insane` |
| `RETRY_BACKOFF_BASE_MS` | 1000 | Initial backoff (doubles each retry) |
| `HEALTH_CHECK_INTERVAL_MS` | 60000 | Health check frequency |
| `STALE_WORKER_THRESHOLD_MS` | 300000 | Stale threshold (5 min) |

## WorkerProcesses Collection Schema

```javascript
{
  service,         // service name
  host,            // server hostname
  pid,             // process ID
  instanceId,      // unique per hot reload (changes on each reload)
  state,           // 'starting' | 'running' | 'stopped' | 'error'
  interval,        // minutes
  enabled,         // boolean
  insane,          // true after MAX_RETRY_ATTEMPTS failures
  lastHeartbeat,   // last heartbeat date
  asof,            // alias for lastHeartbeat
  errors           // array of error objects
}
```

## Hot Reload Handling

`instanceId` is generated via `Random.id()` on module load — changes every time Meteor hot-reloads. Workers check `instanceId` to detect stale processes and clean up `insane` or orphaned workers from prior instances.

## File Map

```
server/
  collections.js  ← WorkerProcesses collection
  logic.js        ← koad.workers.start/stop/getDiagnostics
```

## Known Issues / Notes

- Version `0.0.1` — early, no semver stability guarantee
- `package.js` has `summary: ''` and `documentation: null` — not yet ready for public distribution
- Originally built for the "koad exchange rates" system (comment in `logic.js` header)
- No client-side monitoring UI — diagnostics are server-only
- `insane` flag must be manually cleared or worker must be restarted after max retries
