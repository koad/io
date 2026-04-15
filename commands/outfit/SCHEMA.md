# Outfit Schema — LOD Identity Capsules

Consumer reference for the outfit system. Canonical authority lives in VESTA-SPEC-063 and VESTA-SPEC-099.

## What an Outfit Is

Outfit is the entity's identity expressed as structured data, stored under `outfit` in `passenger.json`. Every downstream interface reads the same outfit and renders at whatever depth it supports. Not a theme — a portable identity contract.

## LOD Stack

| Level | Name | Key(s) | Description |
|-------|------|---------|-------------|
| 0 | Palette | `h`, `s` | Hue + saturation. Minimum viable identity. Always present. |
| 1 | Typography + Greeting | `typography`, `greeting` | Font families, welcome text. |
| 2 | Personality | `personality` | Tone, voice, mood, tags — AI-facing contexts. |
| 3 (motion) | Motion | `motion` | CSS transitions and animations. |
| 3 (visual) | Visual | `visual` | 2D asset references (avatar, icon, banner). |
| 4 | Spatial | `spatial` | 3D mesh reference + sovereign pipeline metadata. |

Level 3 motion and visual are independent keys in the same tier — neither requires the other.

## Commands

```bash
<entity> outfit show              # show current outfit
<entity> outfit extract [image]   # extract h/s from image, write to passenger.json
<entity> outfit set hue <0-360>   # set hue directly
<entity> outfit set saturation <0-100>  # set saturation directly
```

## Serving via /entities

The pi harness serves outfit via `GET /entities` with LOD ceiling via `?level=N`:

```
GET /entities                    # all entities, full depth
GET /entities?level=0            # palette only (h, s)
GET /entities/:handle            # one entity, full depth
GET /entities/:handle?level=2    # one entity, up to personality
```

## CSS Variable Emission

When the templating package injects outfit to the page:

```css
:root {
  --entity-hue: <h>;
  --entity-saturation: <s>%;
  --entity-font-heading: <typography.heading>;   /* when present */
  --entity-font-body: <typography.body>;         /* when present */
  --entity-font-mono: <typography.mono>;         /* when present */
  --entity-easing: <motion.easing>;              /* when present */
  --entity-duration: <motion.durationMs>ms;      /* when present */
}
```

## Blaze Helpers (koad:io-templating)

```handlebars
{{outfitCssVars outfit}}        {{! emit :root { --entity-* } block }}
{{outfitHex outfit}}            {{! hsl(h, s%, 50%) — medium lightness hex }}
{{outfitL0 outfit}}             {{! "h=29 s=54" palette string }}
{{outfitChip outfit name}}      {{! <span class="entity-chip"> with inline color }}
{{outfitCard outfit name role}} {{! <div class="entity-card"> L2 capsule }}
```

## HTML Fragment Fallbacks

For non-Meteor contexts: `outfit.html` and `outfit.css` live in
`~/.koad-io/packages/templating/client/helpers/outfit/`. Import the CSS, use the
data attributes to stamp the markup via `data-outfit-h` and `data-outfit-s`.

## Auto-Generation

If an entity has no outfit, consumers generate L0 from the handle:

```javascript
function generatePalette(handle) {
  let hash = 0;
  for (let i = 0; i < handle.length; i++) {
    hash = ((hash << 5) - hash) + handle.charCodeAt(i);
    hash |= 0;
  }
  return { h: Math.abs(hash % 360), s: 30 + (Math.abs(hash) % 50) };
}
```

Auto-generated outfits are never written back to passenger.json.

## Backward Compatibility

Legacy passenger.json files use `{ hue, saturation, brightness }`. The entity-loader
normalizes: `hue` → `h`, `saturation` → `s`, `brightness` dropped (brightness is
consumer-derived per SPEC-063 §5).

## Specs

- VESTA-SPEC-063 — Outfit Schema (LOD 0–3, CSS contract, backward compat)
- VESTA-SPEC-099 — Outfit LOD Extension (Visual LOD-3, Spatial LOD-4, sovereign pipeline)
