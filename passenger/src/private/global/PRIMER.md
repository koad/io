---
type: primer
folder: ~/.koad-io/passenger/src/private/global/
parents:
  - ~/.koad-io/passenger/src/private/
modules:
  - name: koad-io-api.js
    world: MAIN
    role: page-world `window.__koad_io__` API surface, exposed to userscripts and page scripts on every URL
  - name: koad-io-bridge.js
    world: ISOLATED
    role: relay that forwards page-world postMessage to chrome.runtime.sendMessage (since MAIN world has no chrome.runtime access)
  - name: logic.js
    world: ISOLATED
    role: legacy content script (contextmenu listener interception + debug logging); pre-SPEC-196, kept for compatibility
  - name: styles.css
    world: n/a
    role: global CSS injected into every page (currently mostly empty)
specs:
  - "VESTA-SPEC-196 §6 — tab context injection"
  - "VESTA-SPEC-196 §9 — sovereign userscript platform"
relates-to:
  - ~/.koad-io/passenger/src/private/background/PRIMER.md
  - ~/.koad-io/passenger/src/private/shims/
entities:
  - vulcan
last-walked: 2026-05-19
---

# global/ — Universal Content Scripts

Content scripts that run on **every** URL the user visits. Two concerns:

1. **Expose `window.__koad_io__`** to page scripts and userscripts (SPEC-196 §6, §9)
2. **Relay** between page world and the service worker (since page world has no `chrome.runtime`)

## The two-world dance

Chrome content scripts run in either **MAIN** world (page world — sees and mutates `window`, but no `chrome.runtime`) or **ISOLATED** world (extension world — has `chrome.runtime`, but its `window` is invisible to the page).

We need both:
- Page scripts to see `window.__koad_io__` → MAIN world script sets it
- That API to reach the service worker → ISOLATED world bridge forwards via `chrome.runtime.sendMessage`

```
                     page world                 isolated world             service worker
                ┌──────────────────┐         ┌──────────────────┐       ┌──────────────────┐
   page script  │ window.__koad_   │         │                  │       │                  │
   calls API ──►│ io__.method()    │         │                  │       │                  │
                │                  │         │                  │       │                  │
                │ window.post-     │ ──────► │ window.addEvent- │ ────► │ chrome.runtime   │
                │ Message()        │         │ Listener('msg')  │       │ .onMessage       │
                │                  │ ◄────── │ chrome.runtime   │ ◄──── │ handler          │
                │                  │         │ .sendMessage()   │       │                  │
                │                  │         │                  │       │                  │
                │ promise resolves │         │ postMessage back │       │                  │
                │ in caller        │         │                  │       │                  │
                └──────────────────┘         └──────────────────┘       └──────────────────┘
                   koad-io-api.js              koad-io-bridge.js          background/index.js
```

Both run at `document_start` so the API is available before any page script. Idempotent across reinjections.

## The API surface

`window.__koad_io__` exposes:

| Method | Purpose | SPEC ref |
|--------|---------|----------|
| `injectContext(payload)` | Push structured context (page state, video state, form contents, etc.) to the entity's active session | §6 |
| `corpusByUrl(url?)` | Lookup corpus items that reference this URL — used to populate the "actionable methods" panel | §8 |
| `notify(reason)` | Tell the popup/panel to refresh (script changed state that affects HUD) | — |
| `state()` | Returns current panel state (tier, active tab, etc.) | — |
| `version` | API version string for compatibility checks | — |

## Userscripts use this surface

The sovereign userscript platform (SPEC-196 §9) injects entity-authored scripts into matching pages. Those scripts call `window.__koad_io__.injectContext()` to feed page context to the entity, or call `corpusByUrl()` to react to kingdom-relevant signals.

The loader (Vulcan's pass) will:
1. Fetch the script package via daemon
2. Verify the signature against the authoring entity's public key
3. Inject the script into the matching tab with the API surface already in place

## What `logic.js` is (and isn't)

`logic.js` is older. It listens for contextmenu listener registrations and logs them — pre-SPEC-196 instrumentation. It's not load-bearing; safe to remove when nothing depends on it. Kept for now to avoid surprises.
