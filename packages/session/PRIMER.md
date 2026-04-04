# PRIMER: koad:io-session

**Meteor package name:** `koad:io-session`  
**Version:** 3.6.9  
**State:** Built, stable — fork of cultofcoders:persistent-session

---

## What It Does

Extends Meteor's built-in `Session` object to persist values across page refreshes using `localStorage` (via amplify.js with fallback storage adapters). Without this package, Meteor's `Session` values are lost on every page reload.

Three storage types:
- **Temporary** — default Meteor behavior, lost on reload
- **Persistent** — saved to localStorage until explicitly cleared
- **Authenticated** — saved to localStorage, auto-cleared on user logout

## Dependencies

**Meteor:** `jquery`, `tracker`, `reactive-dict`, `session`, `underscore`, `ejson`, `accounts-base` (weak)

**No npm dependencies.**

## Key Exports

| Export | Scope | Description |
|--------|-------|-------------|
| `Session` | client | Extended Session with persistence methods |
| `PersistentSession` | client | Direct access to persistent session API |

## API

```javascript
// Setting values
Session.set(key, value)           // stores per default_method (default: temporary)
Session.setTemp(key, value)       // always temporary
Session.setPersistent(key, value) // always persisted to localStorage
Session.setAuth(key, value)       // persisted, cleared on logout

// Bulk set (works with all set* methods as of 3.3)
Session.setPersistent({ foo: 'foo', bar: 'bar' });

// Set if not exists
Session.setDefault(key, value)
Session.setDefaultPersistent(key, value)
Session.setDefaultAuth(key, value)

// Update value without changing type
Session.update(key, value)

// Change type of existing variable
Session.makeTemp(key)
Session.makePersistent(key)
Session.makeAuth(key)

// Clear
Session.clear()             // all types
Session.clear(key)          // single key
Session.clearTemp()
Session.clearPersistent()
Session.clearAuth()

// Standard Meteor methods (unchanged)
Session.get(key)
Session.equals(key, value)
```

## Configuration

Set `default_method` in `settings.json` to change default storage type:

```json
{
  "public": {
    "persistent_session": {
      "default_method": "persistent"
    }
  }
}
```

Valid values: `"persistent"`, `"authenticated"`. Anything else falls back to `"temporary"`.

**Note:** As of 3.3+, default changed from `persistent` → `temporary`. Existing apps that relied on persistence must now set `default_method: "persistent"` explicitly.

## File Map

```
lib/
  amplify.js           ← storage abstraction (localStorage + fallbacks)
  persistent_session.js ← Session extension logic
tests/
  client/
    persistent_session.js ← test suite
versions.json
CHANGELOG.md
```

## Known Issues / Notes

- Requires `session` package to be installed separately (`meteor add session`)
- For Meteor 1.3+ with imports syntax, import Session normally: `import { Session } from 'meteor/session'`
- Fork lineage: okgrow → cultofcoders → koad:io
- The `accounts-base` weak dependency handles auth-type clearing on logout
