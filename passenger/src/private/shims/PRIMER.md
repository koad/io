---
type: primer
folder: ~/.koad-io/passenger/src/private/shims/
parents:
  - ~/.koad-io/passenger/src/private/
shims:
  - path: passenger-bridge.js
    matches: ["http://10.10.10.10:58008/*", "https://wonderland.koad.sh/*", "https://koad.sh/*"]
    role: "Meteor app ↔ service worker bridge for kingdom lighthouse domains (page postMessage relay with Meteor RPC envelope; distinct from global/koad-io-bridge.js which is the universal SPEC-196 API bridge)"
  - path: chat.openai.com/copy-conversation-to-clipboard.js
    matches: ["*://chat.openai.com/*"]
    role: copy ChatGPT conversation to clipboard
  - path: youtube.com/preview-button.js
    matches: ["https://youtu.be/*", "https://*.youtube.com/*", "https://*.youtube-nocookie.com/*"]
    role: YouTube preview button — augments video pages
  - path: luminocity3d.org/invert-colors.js
    matches: ["https://luminocity3d.org/WorldPopDen/*"]
    role: inverts colors on the WorldPopDen page (too bright)
  - path: dacentec.com/cpu-dater.js
    matches: ["https://billing.dacentec.com/hostbill/index.php?/cart/dedicated-servers/*"]
    role: appends CPU launch dates to product listings
relates-to:
  - ~/.koad-io/passenger/src/private/global/PRIMER.md
entities:
  - vulcan
  - koad
last-walked: 2026-05-19
---

# shims/ — Site-Specific Content Scripts

Shims are content scripts that run only on specific sites. They augment particular pages with kingdom-aware features — copy hooks, visual tweaks, page-shape-specific affordances.

## Two kinds of shims

**Bridge shims** like `passenger-bridge.js` are protocol relays for known kingdom domains. They let kingdom-hosted Meteor apps communicate with the extension service worker. Distinct from `global/koad-io-bridge.js` which is the universal SPEC-196 API bridge that runs on **every** URL — bridge shims here are scoped to specific domains and use a different message protocol.

**Page-shape shims** are augmentations specific to a third-party site's page structure (the YouTube preview button, ChatGPT clipboard, Dacentec CPU dates, luminocity3d color inversion). These are koad's personal page-augmentation collection.

## How this differs from the userscript platform

Once SPEC-196 §9 lands, page augmentations should be authored as **userscripts** — packaged with manifest, signed by an authoring entity, distributed via daemon. The current `shims/` collection is the pre-SPEC-196 model: hard-coded in the extension manifest, no entity ownership, no permissions model.

The userscript loader (Vulcan's pass) supersedes the manifest-registered shim model for new augmentations. Existing shims here stay until ported, or get cleaned out if abandoned.

## Adding a new shim

1. Drop the JS file under `shims/<domain>/<name>.js`
2. Add a `content_scripts` entry to `manifest.json` with the matches pattern
3. Reload the extension

For anything beyond a one-off page tweak: consider whether it should be a userscript instead (entity-authored, signed, dispatched via daemon).
