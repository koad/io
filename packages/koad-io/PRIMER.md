# PRIMER: koad:io

**Meteor package name:** `koad:io`  
**Version:** 8.8.8  
**State:** Built, active — top-level meta-package

---

## What It Does

The all-in-one entry point for a koad:io Meteor application. Adding `koad:io` to your app pulls in the entire framework: core, routing, sessions, templating, head.js, and several Meteor standards. Most apps only need this single package declaration.

It also adds its own server/client files on top of `koad:io-core` functionality:

**Server:**
- `connection-tracker.js` — tracks DDP connections, updates `ApplicationSessions`, uses `geoip-lite` for country detection and `ua-parser-js` for device parsing
- `methods.js` — additional Meteor methods
- `secrets.js` — creates `Secrets` collection for secure key/value storage
- `manifest-middleware.js` — serves PWA `manifest.json` via Express middleware
- `404-middleware.js` — graceful 404 handling

**Client:**
- `globals.js` — exports `Login`/`Logout` functions, sets up `tick1s`/`tick1m` reactive deps
- `internals.js` — sets up `ApplicationInternals` subscription/tracker
- `initialize-dataport.js` — dataport initialization
- `route-dataport-updater.js` — updates dataport on route changes
- `power-management.js` — browser power/visibility API integration
- `vitals.js` — Web Vitals tracking
- `both/country-codes.js` — `CountryCodes` lookup table

## Dependencies

**Implied (pushed to app):** `koad:io-core`, `koad:io-templating`, `koad:io-router`, `koad:io-session`, `koad:io-plus-head-js`, `standard-minifier-css`, `standard-minifier-js`, `mobile-experience`, `mizzao:timesync`, `matb33:collection-hooks`, `templating`, `jquery`, `tracker`

**npm:** `ua-parser-js@1.0.35`, `geoip-lite@1.2.1`, `web-vitals@3.0.4`, `path-to-regexp@6.2.1`, `useragent@2.3.0`

## Key Exports

| Export | Scope | Description |
|--------|-------|-------------|
| `koad` | both | Global framework namespace (from core) |
| `Accounts` | both | Meteor Accounts |
| `UserStatus` | both | User online status |
| `CountryCodes` | both | ISO country code lookup |
| `ApplicationSessions` | both | Session collection |
| `ApplicationInternals` | both | Internal tracking collection |
| `Devices` | server | Connected devices collection |
| `Services` | server | External services collection |
| `Secrets` | server | Secure key-value storage |
| `Login` | client | `Login(token)` function |
| `Logout` | client | `Logout()` function |
| `tick1s` | client | Reactive dep, fires every second |
| `tick1m` | client | Reactive dep, fires every minute |

## Quickstart

```bash
meteor create --bare myapp
cd myapp
# Replace .meteor/packages content:
echo "koad:io" > .meteor/packages
meteor run
```

Then add more packages as needed:
```bash
meteor add koad:io-accounts
meteor add koad:io-theme-engine
meteor add koad:io-search
```

## Settings Structure

```json
{
  "public": {
    "ident": { "instance": "my-instance-id" },
    "application": {
      "name": "My App",
      "rootUrl": "https://example.com"
    }
  }
}
```

## File Map

```
both/
  country-codes.js        ← CountryCodes lookup table
server/
  connection-tracker.js   ← DDP connection → session tracking
  methods.js              ← server methods
  secrets.js              ← Secrets collection
  manifest-middleware.js  ← PWA manifest endpoint
  404-middleware.js       ← 404 handler
client/
  globals.js              ← Login/Logout/tick helpers
  internals.js            ← ApplicationInternals tracker
  initialize-dataport.js  ← dataport init
  route-dataport-updater.js ← route-aware dataport updates
  power-management.js     ← visibility/power API
  vitals.js               ← Web Vitals
  templates/              ← any included Blaze templates
  view-port.js            ← viewport management
```

## Known Issues / Notes

- Version `8.8.8` is higher than other packages at `3.6.9` — this package has a different versioning cadence
- `matb33:collection-hooks` is implied — all collections in the app get hooks available automatically
- `geoip-lite` adds a significant npm bundle (GeoIP database); connection tracking includes country detection
- `relativeTime` export is commented out
- `ApplicationInternals` publication/subscription auto-wiring is handled in `client/internals.js`
