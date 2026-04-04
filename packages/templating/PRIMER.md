# PRIMER: koad:io-templating

**Meteor package name:** `koad:io-templating`  
**Version:** 3.6.9  
**State:** Built, active — Blaze helpers and layout engine

---

## What It Does

Provides the Blaze helper library and layout management system for koad:io apps. Two main pieces:

1. **Template helpers** — a comprehensive set of global Blaze helpers registered for use in any template (formatting, user info, roles, status, dates, strings, arrays, etc.)
2. **Layout engine** — `ApplicationLayout`, a reactive window/panel manager for Blaze that handles multi-panel layouts, gestures, and view history

## Dependencies

**Meteor:** `ecmascript`, `underscore`, `meteor-base`, `blaze-html-templates`, `reactive-var`, `mizzao:timesync`, `momentjs:moment`, `koad:io-session`

All deps are implied — they propagate to consuming apps.

## Key Exports

| Export | Scope | Description |
|--------|-------|-------------|
| `ApplicationLayout` | client | Layout manager instance |

## Helper Categories

Registered as global Blaze helpers available in all templates:

| File | Helpers |
|------|---------|
| `helpers/application.js` | App name, version, environment, settings |
| `helpers/user.js` | Current user info, username, avatar |
| `helpers/roles.js` | Role checks (`isAdmin`, `hasRole`, etc.) |
| `helpers/status.js` | Online/offline status, maintenance mode |
| `helpers/numbers.js` | Number formatting, currency |
| `helpers/dates.js` | Date formatting via moment.js |
| `helpers/strings.js` | String manipulation helpers |
| `helpers/arrays.js` | Array iteration helpers |
| `helpers/cursors.js` | Mongo cursor utilities |
| `helpers/misc.js` | Miscellaneous utilities |
| `helpers/events.js` | Event helpers |
| `helpers/constants.js` | App constants |

## Layout Engine

`ApplicationLayout` in `client/layout/` is a reactive layout manager:

```javascript
// Switch active panel
ApplicationLayout.set('panelName');

// Navigate with history
ApplicationLayout.go('panelName');

// Go back
ApplicationLayout.back();
```

The layout supports gesture-based navigation (`gestures.js`) and maintains view history (`history.js`).

## File Map

```
client/
  helpers/
    templates.html   ← helper template definitions
    constants.js
    application.js
    user.js
    roles.js
    status.js
    numbers.js
    dates.js
    strings.js
    arrays.js
    cursors.js
    misc.js
    events.js
  layout/
    templates.html   ← layout template markup
    logic.js         ← layout controller
    styles.css       ← layout styles
    engine.js        ← ApplicationLayout core
    gestures.js      ← swipe/gesture support
    history.js       ← navigation history
```

## Known Issues / Notes

- No README exists — docs are inline in the package files
- `mizzao:timesync` dependency means it needs server-side time sync
- Implies `koad:io-session` — persistent session is always available in apps using this package
- The `templating` keyword conflict (Meteor core package vs. this package's name): this package is `koad:io-templating`, not to be confused with the Meteor `templating` package
