---
type: primer
folder: ~/.koad-io/passenger/src/private/background/
parents:
  - ~/.koad-io/passenger/src/private/
modules:
  - name: index.js
    role: wiring layer — imports the rest, registers chrome.runtime message handlers, getPanelState aggregator
  - name: tier-detection.js
    role: SPEC-196 §3 sequential HTTP probe (Tier 1 → Tier 2 → Tier 3), 90s heartbeat, onTierChange callbacks
  - name: active-tab.js
    role: tracks active tab URL/title/id in chrome.storage.session, broadcasts panelStateChanged on every change
  - name: session-token.js
    role: SPEC-196 §4 MCP session token lifecycle (crypto.randomUUID, storage.session, 401 rotation)
  - name: daemon-proxy.js
    role: SPEC-196 §2 central fetch helper — base URL from tier, Bearer auth injection, structured status returns
  - name: sovereign-profile-cache.js
    role: SPEC-196 §5 caches public sovereign profile while online, populates Tier 3 fallback view
  - name: outbound-queue.js
    role: SPEC-196 §5.3-5.4 FIFO buffer for offline writes; persists in chrome.storage.local; flushes on Tier 1/2 transition; dead-letters after MAX_ATTEMPTS
  - name: panel.js
    role: enables the side panel on every tab; sets path to panel.html
  - name: ddp-connection.js
    role: legacy DDP connection (kept for the lighthouse-domain Meteor app bridge); SPEC-196 auth flow lands here when Vulcan implements §4
  - name: external-messages.js
    role: handles externally_connectable + content-script type-based messages (Meteor app RPC envelope, distinct from action-based handlers in index.js)
  - name: settings-daemon.js
    role: daemon-driven settings (older pattern; may consolidate with SPEC-196 storage conventions)
  - name: settings-subscription.js
    role: subscription to daemon settings publications (older pattern)
  - name: session-tab-state.js
    role: helpers wrapping chrome.storage.session per-tab namespace
specs:
  - "VESTA-SPEC-196 §2, §3, §4, §5, §6, §8 — implementation lives here"
relates-to:
  - ~/.koad-io/passenger/src/private/global/PRIMER.md
  - ~/.koad-io/passenger/src/private/PRIMER.md
entities:
  - vulcan
last-walked: 2026-05-19
---

# background/ — Service Worker Modules

The MV3 service worker. Composed of small files, one concern each. `index.js` wires them together.

## The big picture

```
                  ┌─────────────────────┐
                  │  tier-detection.js  │ ◄── 90s heartbeat HTTP probe
                  └──────────┬──────────┘
                             │ onTierChange
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
   ┌──────────────────┐  ┌────────┐  ┌─────────────────────┐
   │ daemon-proxy.js  │  │ index  │  │ sovereign-profile-  │
   │ (Bearer + URL)   │  │ .js    │  │ cache.js            │
   └──────────────────┘  └────┬───┘  └─────────────────────┘
              ▲                │
              │                ▼
   ┌──────────────────┐  ┌────────────────┐
   │ session-token.js │  │ active-tab.js  │
   │ (MCP UUID)       │  │ (URL tracking) │
   └──────────────────┘  └────────────────┘
```

## Composition rule

Each module:
- Owns one concern
- Exports a small API
- Imports from sibling modules only what it needs
- Side-effects (timers, listeners) start on module load via top-level `start()` calls
- `index.js` is the only place that wires `chrome.runtime.onMessage` handlers

## How requests flow

```
page __koad_io__.injectContext(...)
     ↓ window.postMessage
global/koad-io-bridge.js (isolated world)
     ↓ chrome.runtime.sendMessage
background/index.js (action='injectContext' handler)
     ↓ daemon-proxy.daemonPost('/api/context/inject', {...})
     ↓ injects Bearer <session-token>
     ↓ fetch to current tier's base URL
daemon
```

If the daemon is unreachable, `daemonRequest` returns `{ status: 'offline' }`. The handler echoes that back; the page-world API resolves with `{ ok: false, ... }`. Nothing throws.

## Adding a new SW concern

1. Create a new file in this directory
2. Export a small API (single function, named exports)
3. Import in `index.js` (side-effect import for self-starting modules; named imports for explicit usage)
4. Add a message handler in `index.js` if the panel/popup/content scripts need to invoke it
5. Document the file in this PRIMER's `modules:` block

## What lives in the older pattern

`settings-daemon.js` / `settings-subscription.js` / `ddp-connection.js` predate the SPEC-196 architecture. They're functional and kept for the Meteor-app bridge (lighthouse domains), but new work should compose into the proxy + tier model. When the SPEC-196 §4 auth handshake lands, `ddp-connection.js` gets pruned to just the DDP transport without the placeholder passenger.* check-in calls (already removed in commit ac0025d).
