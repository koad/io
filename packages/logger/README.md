# koad:io-event-logger

**Meteor package name:** `koad:io-event-logger`  
**Version:** 0.3.0

Client-side error capture and event logging for koad:io applications. Catches uncaught JavaScript errors and unhandled promise rejections on the client and persists them to MongoDB server-side.

## Installation

```bash
meteor add koad:io-event-logger
```

## Dependencies

- `koad:io-core` (implied)
- `ecmascript`
- `mongo`
- `koad:io-router` (weak — used if present, not required)

## What It Does

1. **Global error capture** — installs `window.onerror` and `window.onunhandledrejection` handlers that intercept all uncaught client errors
2. **Server persistence** — errors are sent to the server via `Meteor.call('caughtError', data)` and stored in MongoDB
3. **Manual logging** — `log.info(method, message)` provides a simple API for intentional event logging
4. **Route context** — if `koad:io-router` is present, error records include the current route

## Client API

```javascript
// Log a manual event (calls server method 'logEvent')
log.info('MyComponent.doThing', 'Something happened');

// Errors thrown anywhere in client code are captured automatically:
// throw new Error('oops') → sent to server as 'caughtError'
// Promise.reject('oops') → sent to server as 'caughtError'
```

## Server API

```javascript
// Log a server-side event
logEvent(method, message, data);
```

## Server Collections

### `ClientErrors`
Stored in MongoDB as the `malfunctions` collection.

```javascript
ClientErrors.find({}) // query all captured client errors
```

## Exports

| Symbol | Scope | Description |
|--------|-------|-------------|
| `log` | client | Client logging object with `log.info()` |
| `ClientErrors` | server | MongoDB collection for client errors |
| `logEvent` | server | Function for server-side event logging |

## File Structure

```
logger/
├── package.js
├── PRIMER.md
├── client/
│   └── logic.js       ← log object, window.onerror, window.onunhandledrejection
└── server/
    ├── collection.js  ← ClientErrors = new Mongo.Collection('malfunctions')
    ├── publications.js
    └── fixtures.js
```

## Notes

- Version `0.3.0` is behind the `3.6.9` standard — this package is early-stage
- `alert(data.message)` is called by the default error handler in development — intentional for visibility, may be unwanted in production
- The `koad:io-router` weak dependency means route information is included in error records when the router is present, but the package works fine without it
