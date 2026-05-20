---
type: primer
folder: ~/.koad-io/passenger/
parents:
  - ~/.koad-io/
children:
  - path: src/private/
    blurb: The actual browser extension — manifest, service worker, content scripts, side panel, popup. This is what Chrome loads.
    status: documented
  - path: src/client/
    blurb: Meteor client templates — the Passenger entity's in-browser UI when served as a Meteor app (separate from the extension).
    status: stub
  - path: src/both/
    blurb: Shared Meteor router/collection definitions used by client + server.
    status: stub
  - path: src/server/
    blurb: Meteor server (only relevant if the passenger is served as a standalone Meteor app).
    status: stub
  - path: commands/
    blurb: Entity commands available from within the extension context.
    status: stub
  - path: features/
    blurb: Feature spec READMEs (older planning artifacts — current direction is SPEC-196).
    status: stub
  - path: config/
    blurb: Extension runtime configuration JSON.
    status: stub
  - path: theme/
    blurb: Visual theme definitions for the extension UI.
    status: stub
specs:
  - "VESTA-SPEC-018 — Dark Passenger Augmentation Protocol (foundational; extended by SPEC-196)"
  - "VESTA-SPEC-196 — Dark Passenger Remote Harness Protocol (three-tier connectivity, auth, userscript platform, corpus-url surface)"
relates-to:
  - ~/.koad-io/daemon/
  - ~/.forge/control-tower/
  - ~/.forge/websites/kingofalldata.com/
entities:
  - vulcan
  - juno
  - koad
last-walked: 2026-05-19
---

# passenger/ — koad:io Dark Passenger

> "So you can sit with me, and I can sit with you."

The Dark Passenger is the browser-side substrate of the kingdom. It is a Chrome MV3 extension that rides with koad in every browser tab, providing ambient entity co-presence: the entity sees what page koad is on, the panel surfaces corpus items that reference the URL, userscripts authored by entities can push tab context into the entity's active session.

## Architecture (SPEC-196)

The extension is a **thin client**. It holds no sovereign keys. The daemon is the trust anchor. The extension connects across three tiers and degrades gracefully:

```
Tier 1: ZeroTier local daemon  (http://10.10.10.10:28282)
Tier 2: Public lighthouse      (operator-configured, e.g. wonderland.koad.sh)
Tier 3: Offline fallback       (localStorage sovereign profile)
```

Three runtime components:

| Component | Role |
|-----------|------|
| Service worker | Proxy + auth layer. Probes tiers, holds MCP session token, routes all daemon requests, broadcasts state changes. |
| Content scripts | Universal `window.__koad_io__` API on every URL (MAIN world) + isolated-world bridge to SW. Site-specific shims for known platforms. |
| Side panel + popup | Side panel = workspace (loads daemon-interface in iframe when connected). Popup = read-only heads-up display (tier dot, active tab, counts). |

## Who works here?

- **Vulcan** builds and maintains the extension. Real auth handshake, userscript loader, daemon endpoint contract.
- **Vesta** owns the protocol layer — SPEC-196 governs everything new the extension does.
- **Muse** owns the side panel and popup visual surfaces (not the architecture).
- **Juno** dispatches and synthesizes; doesn't ship code here directly.

## What to know before touching anything

The extension is loaded in Chrome via `chrome://extensions` → Developer Mode → "Load unpacked" → point at `src/private/`. The manifest is at `src/private/manifest.json`.

Changes to the proxy auth model, tier detection protocol, or content script API surface need Vesta's spec review first — these are SPEC-196 concerns, not free-form code changes.

The extension **never** holds private keys. If you find yourself adding key material to extension code, stop — that's a SPEC-196 §7 violation. Signing and identity always delegate to the daemon (Tier 1 or 2) or are unavailable (Tier 3).

`dist/` is a generated build artifact and is gitignored. Do not commit it. Source of truth is `src/private/`.
