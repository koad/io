---
type: primer
folder: ~/.koad-io/passenger/src/private/
parents:
  - ~/.koad-io/passenger/
children:
  - path: background/
    blurb: Service worker modules — tier detection, MCP session token, daemon proxy, active tab tracking, sovereign profile cache, panel state, settings.
    status: documented
  - path: global/
    blurb: Universal content scripts that run on every URL — the page-world `window.__koad_io__` API and its isolated-world bridge.
    status: documented
  - path: panes/popup/
    blurb: Extension action popup — read-only HUD (tier dot, active tab, counts).
    status: documented
  - path: panes/panel/
    blurb: Side panel scaffold — workspace iframe, actionable methods list, offline sovereign-profile fallback.
    status: documented
  - path: shims/
    blurb: Site-specific content scripts (ChatGPT clipboard, YouTube preview, Dacentec, lighthouse-domain Meteor bridge).
    status: documented
  - path: workers/
    blurb: Older site-specific worker pattern (predates the unified content script model). Kept for the YouTube preview-button stack which still uses it.
    status: stub
  - path: panes/bookmarks/
    blurb: Stub for a bookmarks page override (manifest entry commented out).
    status: stub
  - path: panes/history/
    blurb: Stub for a history page override (manifest entry commented out).
    status: stub
  - path: panes/newtab/
    blurb: New-tab override page (manifest active — chrome_url_overrides.newtab).
    status: stub
files:
  - name: manifest.json
    blurb: MV3 manifest. Side panel default path, action popup, content script registry, permissions, host_permissions, omnibox keyword.
  - name: panel.html
    blurb: Side panel root HTML (declared in manifest side_panel.default_path).
  - name: index.html
    blurb: Options page entry (declared in manifest options_page) — loads the Meteor app.
  - name: overrides.css
    blurb: Global style overrides applied via head links across extension pages.
specs:
  - "VESTA-SPEC-196 — Dark Passenger Remote Harness Protocol"
relates-to:
  - ~/.koad-io/passenger/PRIMER.md
entities:
  - vulcan
last-walked: 2026-05-19
---

# src/private/ — Browser Extension Source

This is what Chrome loads when you "Load unpacked" the extension. The manifest at `manifest.json` is the entry point. Everything else hangs off three roles:

## Role layout

```
background/   →  service worker (proxy + auth + state)
global/       →  content scripts on every URL (window.__koad_io__ API)
shims/        →  content scripts on specific sites (page-shape-specific)
panes/        →  extension UI pages (popup, panel, etc.)
panel.html    →  side panel root
```

## The mental model

The service worker (`background/index.js`) is the proxy layer. Side panel and popup query it via `chrome.runtime.sendMessage({ action: 'getPanelState' })`. Content scripts on pages relay through the isolated-world bridge (`global/koad-io-bridge.js`) to the SW.

The MCP session token never leaves the SW context. The page never sees it. Page → bridge → SW → daemon, with auth injected at the SW hop.

## Module composition (background/)

The SW is composed of small files in `background/`, each owning one concern. `index.js` is the wiring layer — it imports and orchestrates the others. See `background/PRIMER.md` for the module-by-module breakdown.

## Loading the extension

```bash
# In Chrome:
chrome://extensions → Developer Mode → Load unpacked → ~/.koad-io/passenger/src/private/
```

Reload the extension after manifest or background changes. Content script changes apply on next page navigation. Side panel and popup pick up changes on next open.
