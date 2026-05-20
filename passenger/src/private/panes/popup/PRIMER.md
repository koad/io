---
type: primer
folder: ~/.koad-io/passenger/src/private/panes/popup/
parents:
  - ~/.koad-io/passenger/src/private/
files:
  - name: index.html
    role: popup root HTML (action.default_popup in manifest); tier indicator + HUD counts + utility buttons
  - name: logic.js
    role: queries SW for getPanelState, populates tier dot/label, corpus + scripts counts, active tab hostname; wires utility buttons (copy tab, copy tabs, discard tabs, configure)
  - name: styles.css
    role: popup card styling, gradient button styling, tier indicator visual
specs:
  - "VESTA-SPEC-196 §2 — popup is read-only HUD; side panel is the workspace"
relates-to:
  - ~/.koad-io/passenger/src/private/panes/panel/PRIMER.md
  - ~/.koad-io/passenger/src/private/background/PRIMER.md
entities:
  - muse
  - vulcan
last-walked: 2026-05-19
---

# panes/popup/ — Action Popup (HUD)

The popup is **read-only** (SPEC-196 §2). It is a heads-up display showing the current connection state and per-page kingdom signals. It is **not** the workspace — the side panel owns that.

## Visual structure

```
┌─────────────────────────────────┐
│   koad:io                       │  ← title
│   Dark Passenger                │  ← animated subtitle
│                                 │
│   ● connected — zerotier        │  ← tier dot + label
│                                 │
│   3 actionable · 2 scripts      │  ← live HUD counts
│                                 │
│   ────                          │
│   github.com/koad/io            │  ← active tab hostname/path
│                                 │
│   [copy tab] [discard] ...      │  ← utility buttons
└─────────────────────────────────┘
```

## What's shown

| Element | Source | Refresh |
|---------|--------|---------|
| Tier dot | `currentTier()` via `getPanelState` | onTierChange + 15s poll |
| Corpus count | `state.actionable.length` | onTabChange + onTierChange |
| Scripts count | TBD — SPEC-196 §9 registry wiring | onTabChange |
| Active tab | `state.activeTab.url` | onTabChange |

## Why no interactions for kingdom data

Per SPEC-196 §2, the popup is **glance-only**. Any action a user wants to take based on what they see in the popup happens in the side panel workspace. This keeps the popup fast to open, easy to scan, and never the place where work happens.

## Utility buttons (kept)

The four utility buttons (`copy tab`, `discard tabs`, `copy tabs`, `configure koad:io`) are pre-SPEC-196 functionality and remain useful. They aren't kingdom-protocol concerns — they're browser-UX helpers. Kept.
