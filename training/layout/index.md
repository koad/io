# Layout

> How a koad:io app is laid out in the browser.

A koad:io app composes its visual presence from independent packages, each contributing to the DOM in its own lane. Nothing is hardcoded into the app's HTML — everything is a loaded-or-not-loaded choice.

## The four compositional cells

| Nav loaded? | ApplicationLayout loaded? | Result |
|---|---|---|
| No | No | DIY — app author owns everything; plain `<body>` with `{{> yield}}` |
| **Yes** | No | Regular-flow app with nav chrome; content flows normally below the nav |
| No | **Yes** | Workspace app with no nav; pure center yield + dynamic left/right panels |
| **Yes** | **Yes** | Full chrome + workspace — `kingofalldata.com`, `daemon-interface`, anything cockpit-style |

Each cell is a valid choice. The app picks by including (or not) two packages:
- `koad:io-navigation` — chrome (left sidebar + top bar)
- `koad:io-templating` — workspace (`ApplicationLayout` with yield + panels)

## Lessons in this topic

- **[body-merge.md](./body-merge.md)** — How packages inject themselves into the app's `<body>` without the app author doing anything
- **[space-reservation.md](./space-reservation.md)** — The three mechanisms by which contributors claim viewport space (static markup, CSS injection, imperative JS)
- **[application-layout.md](./application-layout.md)** — The three-zone workspace: yield + dynamic left/right panel stacks with per-panel history
- **[panels.md](./panels.md)** — Pushing dynamic panels into the layout at runtime

## Related topics

- `training/navigation/` — the two nav surfaces (left sidebar tree, top bar context nav) in depth
- `training/session/` — Session is the reactive state driving navbar items, panel arrays, and more
- `training/router/` — Iron Router's named yields and how they relate to the layout's zones

## Key files

Navigation package (`~/.forge/packages/navigation/`):
- `client/body.html` — the body injection
- `client/top-bar/templates.html` — top-bar assembly + space-reservation div + style injection
- `client/top-bar/logic.js` — reactive nav items (Session-driven)
- `client/left-accordion/templates.html` — left sidebar tree
- `client/left-accordion/logic.js` — accordion behavior

Templating package (`~/.forge/packages/templating/`):
- `client/layout/templates.html` — `ApplicationLayout` template
- `client/layout/logic.js` — reactive helpers, panel events
- `client/layout/engine.js` — `ApplicationLayout.open/close/toggle/back/forward` API
- `client/layout/history.js` — per-panel history stack
- `client/layout/gestures.js` — touch/swipe gestures for panels
- `client/layout/styles.css` — the CSS rules that respond to contentState classes
