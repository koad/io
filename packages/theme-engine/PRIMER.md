# PRIMER: koad:io-theme-engine

**Meteor package name:** `koad:io-theme-engine`  
**Version:** 3.6.9  
**State:** Built, active — CSS variable theme system

---

## What It Does

A CSS custom property (CSS variables) based theming system for koad:io Meteor apps. Provides:

- HSL-based color system with derived palette from a single hue value
- Dark mode toggle (swaps brightness values)
- CSS normalization and base body styles
- Responsive media query utilities
- JavaScript API via `koad.theme` for programmatic control
- A `{{#if HasTheme}}` Blaze helper

## Dependencies

**Meteor:** `koad:io-core` (client), `templating` (client), `tracker` (client), `reactive-var` (client)

**No npm dependencies.**

## CSS Variables Provided

```css
:root {
  --application-hue: 200;         /* 0–360 */
  --application-saturation: 61;   /* 0–100 */
  --application-brightness: 10;   /* 0–100 — dark by default */
  --application-transparency: 10;
  --content-width: 90vw;

  /* Derived — auto-calculated from hue/saturation/brightness */
  --text-color, --background-color, --accent-color
  --shadow-color, --border-color, --highlight-color
  --primary, --secondary, --success, --info, --warning, --danger

  /* Named palette */
  --blue, --indigo, --purple, --pink, --red, --orange
  --yellow, --green, --teal, --cyan, --white, --gray, --gray-dark

  /* Typography */
  --font-family, --body-font, --heading-font, --table-font, --card-font
}
```

## JavaScript API

```javascript
// Set theme hue (0–360)
koad.theme.set.hue(200);   // blue
koad.theme.set.hue(0);     // red
koad.theme.set.hue(120);   // green

// Toggle dark/light mode
koad.theme.darkmode.toggle();
// swaps --application-brightness between 10 and 90
// swaps --text-brightness between 90 and 10

// Check if theme is set
koad.theme.hue  // false or number
```

## Blaze Helper

```html
{{#if HasTheme}}
  <div>Custom theme is active</div>
{{/if}}
```

## Configuration via Settings

```json
{
  "public": {
    "application": {
      "theme": {
        "hue": 200,
        "saturation": 61,
        "brightness": 10
      }
    }
  }
}
```

## File Map

```
styles/
  01-normalize.css    ← CSS reset/normalization
  02-variables.css    ← all CSS custom properties + HSL calculations
  body.css            ← base body/html styles
  media-queries.css   ← responsive breakpoint utilities
logic.js              ← koad.theme API + HasTheme helper (client only)
```

Load order matters — `01-normalize.css` → `02-variables.css` → `body.css` → `media-queries.css` → `logic.js`.

## Known Issues / Notes

- `--application-brightness: 10` means dark mode is the default (10% brightness = near black)
- Theme rotation via `setInterval` is present in `logic.js` but commented out
- No server-side component — entirely client
- To override the default hue, set it in `settings.json` or call `koad.theme.set.hue()` in `Meteor.startup`
- CSS variable support required: Chrome 49+, Firefox 31+, Safari 9.1+, Edge 15+
