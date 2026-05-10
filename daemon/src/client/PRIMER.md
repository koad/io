---
type: primer
folder: ~/.koad-io/daemon/src/client/
parents:
  - ~/.koad-io/daemon/
children: []
features:
  - name: daemon-operator-dashboard
    blurb: Route-dispatched Blaze UI — WidgetQuickLaunch (default), KingdomOverview (/overview), MerkleView (/merkle), IndexersAdmin (/indexers)
    location: ~/.koad-io/daemon/src/client/
relates-to:
  - ~/.koad-io/daemon/PRIMER.md
  - ~/.koad-io/daemon/src/server/PRIMER.md
entities:
  - vulcan
  - muse
  - juno
last-walked: 2026-05-09
as-of: e96d9337de4b8ce946ad6be6c5cee441513e230f
---

# daemon/src/client/ — Operator Dashboard UI

The client layer is a Blaze application that renders the daemon's operator-facing interfaces. It dispatches to four views based on `window.location.pathname`.

## Files

| File | Role |
|------|------|
| `templates.html` | Body router + `WidgetQuickLaunch` template definition |
| `application-logic.js` | Template helpers and events for `WidgetQuickLaunch`; route helper registration; Electron detection |
| `indexers.js` / `indexers.html` / `indexers.css` | `IndexersAdmin` — `/indexers` route; lists, expands, and reloads pluggable indexers via REST |
| `merkle.js` / `merkle.html` / `merkle.css` | `MerkleView` — `/merkle` route; on-demand merkle tree state via `merkle.buildState` DDP method |
| `overview.js` | `/overview` route — delegates to `brandKingdomOverview` from brand-components |
| `styles.css` | Global dashboard styles (diamond widget, notification stack, colors) |

## Route dispatch pattern

`templates.html` uses three global helpers registered in `application-logic.js`:

```js
Template.registerHelper('isOverview', () => window.location.pathname === '/overview');
Template.registerHelper('isMerkle',   () => window.location.pathname === '/merkle');
Template.registerHelper('isIndexers', () => window.location.pathname === '/indexers');
```

The body template uses `{{#if isOverview}}…{{else if isMerkle}}…{{else if isIndexers}}…{{else}}WidgetQuickLaunch{{/if}}`. No router package — just pathname checks.

## WidgetQuickLaunch

The default view. A diamond-shaped entity icon with retractable nav buttons. Reads from `Passengers` (selected entity) and `Alerts`. Nav buttons are driven by `passenger.json` `buttons` array — each button declares an `action` (DDP method name) and `target` (argument). Click calls `Meteor.call(this.action, this.target)`, which routes to effectors.js on the server.

## Alert overlay

When an entity has alerts (`Alerts` collection, populated by the alerts indexer), the diamond shows an overlay with the most recent alert body and reduces avatar opacity to 0.69. Notifications are distinguished from alerts: alerts take priority in display order.

## Electron vs browser detection

`application-logic.js` detects `process.type === 'renderer'` (Electron) and applies `--background-color: transparent` (for the transparent overlay widget) vs `#121212` (for browser viewing).
