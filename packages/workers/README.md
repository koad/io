# koad:io-worker-processes

A Meteor package for managing background worker processes with scheduling, error handling, and retry logic.

## Installation

```bash
meteor add koad:io-worker-processes
```

## Features

- **Scheduled Task Execution** - Run tasks at configurable intervals (1 minute to 24 hours)
- **Hot Reload Detection** - Automatically handles Meteor hot reloads without zombie processes
- **Error Handling** - Automatic retry with exponential backoff (max 3 attempts)
- **Health Monitoring** - Track worker state, heartbeat, and diagnostic information
- **MongoDB Persistence** - Worker state persisted in `workers` collection

## API

### `koad.workers.start(config)`

Start a new worker with the given configuration.

```javascript
Meteor.startup(async () => {
  await koad.workers.start({
    service: 'my-service',    // Unique service name
    interval: 60,             // Run every 60 minutes
    delay: 1,                 // Start 1 minute after interval boundary
    runImmediately: false,   // Skip initial run
    task: async () => {
      // Your worker logic here
      const data = await fetchData();
      await processData(data);
    }
  });
});
```

**Configuration Options:**

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `service` | string | Yes | Unique identifier for the worker |
| `interval` | number | Yes | Interval in minutes (1-1440) |
| `delay` | number | No | Delay in minutes after interval boundary |
| `task` | function | Yes | Async function to execute |
| `runImmediately` | boolean | No | Run task immediately on start |
| `type` | string | No | Worker type |

**Returns:** Object with `workerId`, `service`, `interval`, and `stop()` function.

### `koad.workers.stop()`

Stop a running worker:

```javascript
const worker = await koad.workers.start({ /* config */ });

// Later...
await worker.stop();
```

### `koad.workers.getDiagnostics()`

Get diagnostic information about workers:

```javascript
const diagnostics = await koad.workers.getDiagnostics();
// Returns: { currentPid, currentInstanceId, activeWorkers, staleWorkers, intervalHandles }
```

## Worker Collection

Workers are stored in the `workers` MongoDB collection with these fields:

- `service` - Service name
- `host` - Server hostname
- `pid` - Process ID
- `instanceId` - Unique instance ID (changes on hot reload)
- `state` - Worker state (`starting`, `running`, `stopped`, `error`)
- `interval` - Execution interval in minutes
- `enabled` - Whether worker is enabled
- `insane` - Marked as failed after max retries
- `lastHeartbeat` / `asof` - Last heartbeat timestamp
- `errors` - Array of error objects

## Configuration Constants

| Constant | Default | Description |
|----------|---------|-------------|
| `MIN_INTERVAL_MINUTES` | 1 | Minimum interval |
| `MAX_INTERVAL_MINUTES` | 1440 | Maximum interval (24 hours) |
| `MAX_RETRY_ATTEMPTS` | 3 | Max retry attempts before marking insane |
| `RETRY_BACKOFF_BASE_MS` | 1000 | Initial backoff delay (1 second) |
| `HEALTH_CHECK_INTERVAL_MS` | 60000 | Health check interval |
| `STALE_WORKER_THRESHOLD_MS` | 300000 | Stale worker threshold (5 minutes) |

## Error Handling

- Workers automatically retry failed tasks with exponential backoff
- After 3 failed attempts, worker is marked as `insane`
- All errors are logged and stored in the worker document

## License

MIT
