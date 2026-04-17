# koad:io-activity-stream

Reusable activity stream renderer that consumes VESTA-SPEC-111 sigchain entries.

Accepts N sources (sigchains, inline data), merges them chronologically, and renders via Blaze templates. The same package drives:

- Single entity profile (one sigchain → that entity's history)
- `activity.kingofalldata.com` (all entity sigchains → kingdom timeline)
- Insiders dashboard (filtered sigchains → sponsor view)
- Any future surface

## API

```js
// Create a reactive stream from one or more sources
const stream = ActivityStream.from([
  { type: 'sigchain', tipCid: 'baguczs...' },
  { type: 'sigchain', tipCid: 'baguczs...' },
  // For tests / SSR:
  { type: 'inline', entries: [...] },
]);

// Read current entries (reactive — use in Template helpers or Tracker.autorun)
const entries = ActivityStream.entries(stream);

// Filter
const bonds = ActivityStream.filter(stream, { type: 'koad.bond' });
const vulcanEntries = ActivityStream.filter(stream, { entity: 'vulcan' });
const recent = ActivityStream.filter(stream, { after: '2026-04-16T00:00:00Z' });

// Render (augments entries with _icon, _label, _description, _date, _link)
const rendered = ActivityStream.render(stream);
const filtered = ActivityStream.render(stream, { type: 'koad.release' });

// Register a renderer for a new entry type
ActivityStream.registerRenderer('my.custom-type', {
  icon:        (entry) => '★',
  label:       (entry) => 'Custom event',
  description: (entry) => `${entry.entity} did something`,
  link:        (entry) => null,  // optional
});
```

## Blaze templates

```html
{{> activityStream stream=myStream}}
{{> activityStream stream=myStream opts=filterOpts}}
{{> activityEntry entry}}
```

## Package structure

```
activity-stream/
  package.js
  client/
    stream.js               — Stream class, merge, sort, filter, render
    entry-renderers.js      — Per-type renderer definitions (all core SPEC-111 types)
    templates/
      activity-stream.html  — Main list template
      activity-stream.js    — Template helpers
      activity-stream.css   — Base styles
      activity-entry.html   — Single entry template
      activity-entry.js     — Entry helpers
  server/
    stream-server.js        — Server-side sigchain walker (gateway fetch)
  test/
    activity-stream-tests.js
  README.md
```

## Dependencies

- `koad:io-core` — koad global, reactive primitives
- `koad:io-ipfs-client` — CID resolution in the browser
- `koad:io-sovereign-profiles` — shared profile verification utilities

## SPEC reference

VESTA-SPEC-111 v1.2 — Sovereign Sigchain Entry Format
