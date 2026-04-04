# PRIMER: koad:io-plus-head-js

**Meteor package name:** `koad:io-plus-head-js`  
**Version:** 3.6.9  
**State:** Built, stable — vendored third-party library

---

## What It Does

Bundles [Head.js](https://github.com/headjs/headjs) into the koad:io Meteor stack. Head.js is a browser capability detection and resource loading library that adds CSS classes to the `<html>` element based on detected browser/screen features, enabling CSS feature queries without JavaScript.

Specifically provides:
- Screen size breakpoint detection → CSS classes like `gt-768`, `lt-1024`
- Browser version detection (IE 6–11)
- CSS class hooks on `<html>` for responsive/progressive enhancement via CSS

The entire library is vendored in `koad-io-plus-head-js.js` as a single concatenated file (core + features modules from Head.js v1.0.x).

## Dependencies

**Meteor:** `ecmascript`

**No npm dependencies.** The library is fully vendored.

## Usage

No JavaScript configuration needed — the library runs automatically when included. After load, `<html>` gets classes like:

```html
<html class="gt-480 gt-768 lt-1024 no-ie js">
```

Use in CSS:
```css
.gt-768 .my-component { /* tablet+ styles */ }
.lt-480 .sidebar { display: none; }
```

Access the `head` global in JavaScript:
```javascript
head.ready(function() {
  // DOM is ready, features detected
});
```

## File Map

```
koad-io-plus-head-js.js  ← entire Head.js library, vendored (client only)
package.js
README.md
```

## Known Issues / Notes

- The Head.js website (`headjs.github.io`) is down/stolen per the README — the GitHub repo is the canonical reference
- This is a maintenance inclusion — the library is mature and unlikely to change
- Only loads on client (`mainModule` client-only)
- Screen breakpoints default: `[240, 320, 480, 640, 768, 800, 1024, 1280, 1440, 1680, 1920]`
- IE detection only (Chrome/Firefox/iOS/Android detection is commented out in source)
