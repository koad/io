---
type: primer
folder: ~/.koad-io/passenger/src/private/panes/panel/
parents:
  - ~/.koad-io/passenger/src/private/
files:
  - name: styles.css
    role: side panel layout — header, tier dot, actionable section, workspace iframe slot, fallback view
  - name: logic.js
    role: queries SW for getPanelState, renders tier/actionable/workspace/fallback; handles iframe load detection (about:blank, X-Frame-Options refusal) with "Open in tab" fallback
related-files:
  - path: ../../panel.html
    role: side panel root HTML (must live at private/ root because the manifest path is bare "panel.html")
specs:
  - "VESTA-SPEC-196 §2 — side panel = workspace, popup = HUD role split"
relates-to:
  - ~/.koad-io/passenger/src/private/panes/popup/PRIMER.md
  - ~/.koad-io/passenger/src/private/background/PRIMER.md
entities:
  - muse
  - vulcan
last-walked: 2026-05-19
---

# panes/panel/ — Side Panel Workspace

The side panel is the **workspace** (SPEC-196 §2). When the daemon is reachable (Tier 1 or 2), the panel embeds the daemon-interface as the primary pane via an iframe. Userscripts, conversation, corpus interaction all happen in that pane. When offline (Tier 3), the panel shows the cached sovereign profile.

## Visual structure

```
┌──────────────────────────────────┐
│ koad:io           ● tier label   │  ← header (tier dot + label)
│ dark passenger                   │
├──────────────────────────────────┤
│ ACTIONABLE METHODS               │  ← when corpus has matches
│ • Mercury  PR thread             │
│ • Vulcan   tickle: HSV fix       │
├──────────────────────────────────┤
│                                  │
│  [ daemon-interface iframe ]     │  ← workspace OR
│                                  │
│                                  │
│      [ Open in tab ]             │  ← fallback button if framing blocked
└──────────────────────────────────┘
```

When tier == 3, the iframe is hidden and the fallback view renders the cached sovereign profile (handle, fingerprint, sigchain tip, etc.) with a "cached Xm ago" timestamp.

## State transitions

The panel listens for `chrome.runtime.onMessage` with `action: 'panelStateChanged'` and re-queries `getPanelState`. Plus a 15s periodic poll as backup.

| State | Trigger | Effect |
|-------|---------|--------|
| Tier 1/2, workspace loads | iframe load + readable content | Show iframe |
| Tier 1/2, workspace blocked | iframe never loads OR loads `about:blank` (X-Frame-Options / frame-ancestors) | Show "Open in tab" fallback |
| Tier 3 | Tier detection failure | Hide workspace, show sovereign profile fallback |
| Probing | SW startup | Show "connecting…" with neutral dot |

## Iframe load detection

X-Frame-Options-refused responses still fire the iframe `load` event in Chrome but with `about:blank` content. We detect via:
1. `frame.load` event listener — checks `contentDocument` and `contentWindow.location.href === 'about:blank'`
2. 4-second timeout — if `load` never fires at all (network unreachable from extension context)

Either case → show the "Open in tab" fallback with the workspace URL.

## What this primer does NOT cover

- Tier detection logic — that's `background/tier-detection.js`
- Corpus query — that's `background/index.js` `getPanelState` aggregator + `daemon-proxy.js`
- The popup HUD — see `../popup/PRIMER.md`

This pane is purely the rendering layer. State comes from the SW.
