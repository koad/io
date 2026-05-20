---
type: primer
folder: ~/.koad-io/passenger/src/private/panes/options/
parents:
  - ~/.koad-io/passenger/src/private/
files:
  - name: index.html
    role: settings page UI — connection tiers, workspace URL, identity profile, MCP token surface
  - name: logic.js
    role: loads/saves chrome.storage.local for tier1/tier2/workspaceUrl; reads chrome.storage.session for the MCP token; invokes SW for reprobe and token rotation
  - name: styles.css
    role: settings page styling — dark theme, fieldset layout, tier indicator
specs:
  - "VESTA-SPEC-196 §3 — tier configuration"
  - "VESTA-SPEC-196 §4 — MCP token surface (read-only display + rotation trigger)"
  - "VESTA-SPEC-196 §5 — sovereign profile cache visualization"
relates-to:
  - ~/.koad-io/passenger/src/private/PRIMER.md
  - ~/.koad-io/passenger/src/private/background/PRIMER.md
entities:
  - muse
  - vulcan
last-walked: 2026-05-19
---

# panes/options/ — Settings Page

Declared in `manifest.json` as `options_page`. Opens in a tab via:
- Right-click extension icon → "Options"
- Popup "configure koad:io" button (calls `chrome.runtime.openOptionsPage()`)

## What it exposes

| Section | Controls |
|---------|----------|
| **Connection — Tier 1** | host, port, protocol (defaults: 10.10.10.10:28282 http) |
| **Connection — Tier 2** | host, port, protocol (lighthouse; blank disables Tier 2) |
| **Workspace URL override** | URL the side panel iframe loads (blank = derive from tier) |
| **Identity** | Cached sovereign profile (read-only); refreshes every Tier 1/2 connection |
| **Session token (MCP)** | Current token display + manual rotation button |

## Storage layout

Settings live in `chrome.storage.local` under these keys:

```js
{
  tier1: { host, port, proto },           // default tier1
  tier2: { host, port, proto } | null,    // null to disable
  workspaceUrl: 'https://...' | null,     // override or null to derive
  sovereignProfile: { ... }               // cached by sovereign-profile-cache.js
}
```

MCP token lives in `chrome.storage.session` under `mcpSessionToken` (managed by `session-token.js`; cleared on browser close).

## How it talks to the SW

| User action | SW message | Handler |
|-------------|------------|---------|
| Save settings | `chrome.runtime.sendMessage({ action: 'reprobeTier' })` after write | `probeNow()` |
| Re-probe button | `{ action: 'reprobeTier' }` | `probeNow()` |
| Rotate token | `{ action: 'rotateToken' }` | `rotateToken()` |
| Periodic state poll | `{ action: 'getPanelState' }` | aggregator in `background/index.js` |

## What's intentionally not here

- No DDP debugger / message log (would belong in a separate diagnostics pane if useful)
- No userscript registry view (SPEC-196 §9 — adds its own pane when that lands)
- No outbound queue inspector (Tier 3 message queue, coming next)
