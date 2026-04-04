# PRIMER: koad:io-event-logger

**Meteor package name:** `koad:io-event-logger`  
**Version:** 0.3.0  
**State:** Early / minimal — basic structure present, fixtures stub may be incomplete

---

## What It Does

Client-side error catching and event logging for koad:io apps. Provides:

- A client-side `log` object with `log.info(method, msg)` that calls a server method to persist events
- Global `window.onerror` and `window.onunhandledrejection` handlers that catch client errors and send them to the server via `Meteor.call('caughtError', data)`
- A `ClientErrors` collection (stored as `malfunctions` in MongoDB) for persisting client-side errors server-side
- A `logEvent` server function for recording events
- Publications to expose log data

## Dependencies

**Meteor:** `koad:io-core`, `ecmascript`, `mongo`, `koad:io-router` (weak)

**No npm dependencies.**

## Key Exports

| Export | Scope | Description |
|--------|-------|-------------|
| `log` | client | Client logging object |
| `ClientErrors` | server | `malfunctions` MongoDB collection |
| `logEvent` | server | Function to log a server-side event |

## Client API

```javascript
// Log an info event (calls server method 'logEvent')
log.info('MyComponent.doThing', 'Something happened');

// Client errors are caught automatically via window.onerror
// Sends: { method: origin, error, message } to server 'caughtError' method
```

## File Map

```
client/
  logic.js       ← log object, error handlers, getCurrentRoute helper
server/
  collection.js  ← ClientErrors = new Mongo.Collection('malfunctions')
  publications.js ← (present, content unknown)
  fixtures.js    ← (present, content unknown — likely stubs)
```

## Known Issues / Notes

- Version `0.3.0` vs. `3.6.9` for other packages — this is clearly earlier/less mature
- `package.js` has `documentation: null` — no README
- `fixtures.js` is referenced in the server files list but the file listing showed it missing from the server directory when checked — may be an empty stub or not yet created
- The `koad:io-router` dependency is weak — the logger can detect the current route if the router is present but doesn't require it
- `alert(data.message)` is called in the client error handler — this is intentional for dev but may be unwanted in production apps
- The `caughtError` server method (called by the client handler) is expected but its definition location needs verification — likely in `server/` methods
