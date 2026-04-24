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

## Lessons (in the packages that own them)

**`koad:io-navigation`** — `~/.forge/packages/navigation/training/`:
- [body-merge.md](../../../.forge/packages/navigation/training/body-merge.md) — how packages inject themselves into the app's `<body>`
- space-reservation.md *(pending)* — the three mechanisms for claiming viewport space
- top-bar.md *(pending)* — the top bar context nav, Session-driven NavItems
- left-accordion.md *(pending)* — the sidebar tree for logged-in users

**`koad:io-templating`** — `~/.forge/packages/templating/training/`:
- application-layout.md *(pending)* — the three-zone workspace: yield + left/right panel stacks
- panels.md *(pending)* — pushing dynamic panels with per-panel history
- content-state.md *(pending)* — reactive CSS-class space reservation

## Cross-package open questions

- **Named yields vs reactive panels** — Iron Router supports named yields; `ApplicationLayout` uses reactive panel arrays. Two mental models not yet unified.
- **Canonical space-reservation API** — navigation uses navPadding div + CSS injection + imperative JS (accordion). Could unify into one API.
- **Zone visibility** — how does a route declare "I don't want the left zone"? Currently via CSS positioning (hide the nav assembly). Could be more explicit.

## Related topics

- `training/navigation/` *(pending)* — the two nav surfaces in depth
- `training/session/` *(pending)* — Session is the reactive state driving navbar items, panel arrays
- `training/router/` *(pending)* — Iron Router's named yields and how they relate to the layout's zones

## Key files (canonical examples)

Navigation (`~/.forge/packages/navigation/`):
- `client/body.html` — the body injection (4 lines; has inline PRIMER)
- `client/top-bar/templates.html` — top-bar assembly + dual space-reservation
- `client/top-bar/logic.js` — reactive nav items from Session
- `client/left-accordion/templates.html` + `logic.js` — sidebar tree
- `training/` — package's own lessons

Templating (`~/.forge/packages/templating/`):
- `client/layout/templates.html` — `ApplicationLayout` three-zone template
- `client/layout/logic.js` — reactive helpers, panel events
- `client/layout/engine.js` — `ApplicationLayout.open/close/toggle/back/forward` API
- `client/layout/history.js` — per-panel history stack
- `client/layout/styles.css` — CSS rules responding to contentState classes
- `training/` *(pending)* — package's own lessons
