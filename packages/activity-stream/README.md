# koad:io-activity-stream

Activity stream renderer for koad:io Meteor apps. Accepts N SPEC-111 sigchain sources, merges entries chronologically, and renders via Blaze templates. The same package drives a single entity's profile history, the kingdom-wide `activity.kingofalldata.com` timeline, and the insiders sponsor dashboard.

## Installation

```shell
meteor add koad:io-activity-stream
```

## What it does

Each koad:io entity maintains a SPEC-111 sigchain — a linked list of signed entries on IPFS recording everything the entity has done (bonds filed, keys added, profiles updated, releases cut, etc.). This package walks those chains, merges entries from multiple entities into a single chronological list, and renders them through Blaze templates with per-type icons, labels, and descriptions.

The stream is reactive: Meteor's `ReactiveVar` backs the entry list so Blaze helpers re-run automatically when the stream updates.

## Quick start

### Single entity stream

```js
// Walk one entity's sigchain and display it
const stream = ActivityStream.from([
  { type: 'sigchain', tipCid: 'baguczsa...' }
]);
```

```html
{{> activityStream stream=stream}}
```

### Merged kingdom stream

```js
// Walk multiple entity sigchains and merge into one timeline
const stream = ActivityStream.from([
  { type: 'sigchain', tipCid: aliceTipCid,  label: 'alice' },
  { type: 'sigchain', tipCid: vulcanTipCid, label: 'vulcan' },
  { type: 'sigchain', tipCid: junoTipCid,   label: 'juno' },
]);
```

```html
{{> activityStream stream=stream}}
```

Failed sources are dropped silently — a partial stream is better than no stream. If ALL sources fail, `stream.error()` returns the error string.

### Filtered view

```js
// Render only bond entries from alice
const rendered = ActivityStream.render(stream, {
  type: 'koad.bond',
  entity: 'alice'
});
```

### Inline / test data (no IPFS)

```js
const stream = ActivityStream.from([
  {
    type: 'inline',
    entries: [
      { type: 'koad.genesis', entity: 'alice', timestamp: '2026-01-01T00:00:00Z', payload: {} },
      { type: 'koad.bond',    entity: 'alice', timestamp: '2026-04-01T12:00:00Z', payload: { from: 'alice', to: 'vulcan', bond_type: 'peer' } },
    ]
  }
]);
```

## API reference

### `ActivityStream.from(sources)` → `Stream`

Creates a reactive stream and immediately begins loading. Returns a `Stream` instance.

```js
const stream = ActivityStream.from(sources);
```

Each source is one of:

| Type | Shape | Description |
|------|-------|-------------|
| `sigchain` | `{ type: 'sigchain', tipCid: string, label?: string }` | Walk a SPEC-111 sigchain via `IPFSClient.get()` |
| `inline` | `{ type: 'inline', entries: object[] }` | Direct entry array — for tests, SSR, or static data |

---

### `ActivityStream.entries(stream)` → `object[]`

Returns the current merged entry array from a `Stream` instance. Reactive — use inside Blaze helpers or `Tracker.autorun`.

```js
const entries = ActivityStream.entries(stream);
// [{ type, entity, timestamp, payload, _cid, ... }, ...]
```

You can also read entries directly from the stream:

```js
stream.entries()    // same result
stream.isLoading()  // true while any source is loading
stream.error()      // error string or null
stream.sourceCount() // number of sources
```

---

### `ActivityStream.filter(stream, opts)` → `object[]`

Filters the stream's current entries. Does not mutate the stream; returns a plain array.

| Option | Type | Description |
|--------|------|-------------|
| `opts.type` | string \| string[] | Include only entries of these type(s) |
| `opts.entity` | string \| string[] | Include only entries from these entity/entities |
| `opts.after` | string (ISO 8601) | Include entries with `timestamp > opts.after` |
| `opts.before` | string (ISO 8601) | Include entries with `timestamp < opts.before` |

```js
// All bond entries
const bonds = ActivityStream.filter(stream, { type: 'koad.bond' });

// Multiple types
const keys = ActivityStream.filter(stream, { type: ['koad.device-key-add', 'koad.device-key-revoke'] });

// Entries from a specific entity this year
const aliceRecent = ActivityStream.filter(stream, {
  entity: 'alice',
  after: '2026-01-01T00:00:00Z'
});
```

---

### `ActivityStream.render(stream, opts?)` → `object[]`

Passes entries through the renderer registry and returns template-ready objects. Accepts an optional filter `opts` (same shape as `filter()`).

Each entry is augmented with:

| Field | Type | Description |
|-------|------|-------------|
| `_icon` | string | Icon string from the type's renderer |
| `_label` | string | Short human-readable label |
| `_description` | string | Full sentence description |
| `_timestamp` | string | Original ISO 8601 timestamp |
| `_date` | Date \| null | JS `Date` object |
| `_link` | string \| null | URL for linked entries (e.g. bond CID, release URL) |
| `_renderer` | object | The renderer object used |

```js
const rendered = ActivityStream.render(stream);
const releasesOnly = ActivityStream.render(stream, { type: 'koad.release' });
```

---

### `ActivityStream.registerRenderer(type, renderer)`

Register a custom renderer for an entry type. Call at module load time (before any stream is rendered).

```js
ActivityStream.registerRenderer('my.custom-type', {
  icon:        (entry) => '★',
  label:       (entry) => 'Custom event',
  description: (entry) => `${entry.entity} triggered ${entry.type}`,
  link:        (entry) => entry.payload?.url || null,  // optional
});
```

The renderer object:

| Method | Signature | Required |
|--------|-----------|----------|
| `icon` | `(entry) → string` | Yes |
| `label` | `(entry) → string` | Yes |
| `description` | `(entry) → string` | Yes |
| `link` | `(entry) → string \| null` | No |

Register `'*'` to override the default fallback renderer (used for unrecognized entry types).

## Built-in entry types

Core SPEC-111 entry types have renderers registered automatically:

| Type | Icon | Notes |
|------|------|-------|
| `koad.genesis` | `⊕` | First entry in a new sigchain |
| `koad.bond` | `⛓` | Bond filed or revoked between entities |
| `koad.release` | `⬆` | Package or artifact release |
| `koad.key-rotation` | `↻` | Signing key rotation |
| `koad.gestation` | `✦` | A new entity gestated |
| `koad.state-update` | `◎` | State update within a scope (e.g. `profile`) |
| `koad.device-key-add` | `+` | Device key authorized |
| `koad.device-key-revoke` | `x` | Device key revoked |
| `*` (fallback) | `·` | Any unregistered type |

## Blaze templates

### `{{> activityStream}}`

Main list template. Handles loading state, error state, empty state, and the entry list.

```html
{{> activityStream stream=myStream}}

{{!-- With filter options passed to render(): --}}
{{> activityStream stream=myStream opts=filterOpts}}
```

Data context:

| Key | Type | Description |
|-----|------|-------------|
| `stream` | Stream | A `Stream` instance from `ActivityStream.from()` |
| `opts` | object | Optional filter/render options |

### `{{> activityEntry}}`

Single entry template. Expects the data context to be a rendered entry object (as produced by `ActivityStream.render()`). Use directly when you need to render entries outside the `activityStream` list.

```html
{{#each entries}}
  {{> activityEntry this}}
{{/each}}
```

### `{{> activityStreamEmpty}}`

Empty state. Rendered automatically by `activityStream` when there are no entries. Override in your app's templates if you need a custom empty state.

## Server-side API

On the server, `IPFSClient` is not available. `ActivityStreamServer` walks sigchains via HTTP gateway fetch instead.

```js
// Server (SSR, publication, API endpoint)
import { ActivityStreamServer } from 'meteor/koad:io-activity-stream';

// Walk one chain
const entries = await ActivityStreamServer.walk(tipCid, { maxDepth: 100 });

// Walk multiple chains and merge
const merged = await ActivityStreamServer.walkAll([
  { tipCid: aliceTipCid },
  { tipCid: vulcanTipCid },
]);
```

`ActivityStreamServer.walk(tipCid, opts)` — walks chain tip-to-genesis, returns array oldest-first.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `opts.maxDepth` | number | 1000 | Stop after N entries |
| `opts.gateway` | string | `IPFS_GATEWAY` env var or `https://kingofalldata.com/ipfs` | Gateway base URL |

`ActivityStreamServer.walkAll(sources, opts)` — walks multiple chains, deduplicates by CID, returns merged array oldest-first.

> The gateway fetch is the current server path. Phase 2: when the daemon IPFS node is live, the server will use a direct RPC to the local Helia node instead.

## Package structure

```
activity-stream/
  package.js
  client/
    stream.js               — Stream class, merge, sort, filter, render, renderer registry
    entry-renderers.js      — Core SPEC-111 type renderers
    templates/
      activity-stream.html  — activityStream and activityStreamEmpty templates
      activity-stream.js    — Template helpers (isLoading, streamError, renderedEntries)
      activity-stream.css   — Base styles
      activity-entry.html   — activityEntry template
      activity-entry.js     — Entry helpers (entryTypeClass, formattedDate)
  server/
    stream-server.js        — ActivityStreamServer (gateway-based chain walker)
  test/
    activity-stream-tests.js
  README.md
```

## Relationship to other packages

| Package | Relationship |
|---------|-------------|
| `koad:io-ipfs-client` | Dependency — client-side CID resolution and dag-json decoding |
| `koad:io-sovereign-profiles` | Dependency — `koad.state-update[scope="profile"]` entries in the stream carry profile data; sovereign-profiles is the builder/verifier for those entries |

## Dependencies

- `koad:io-core` — koad global, Blaze, reactive system
- `koad:io-ipfs-client` — CID resolution (`IPFSClient.get()`)
- `koad:io-sovereign-profiles` — profile entry utilities
- `blaze-html-templates`, `templating`, `reactive-var`, `tracker` — Meteor reactive rendering
- `multiformats` `13.3.0`, `@noble/ed25519` `2.1.0`, `@ipld/dag-json` `10.2.2` — SPEC-111 CID stack

## Related

- [VESTA-SPEC-111](~/.vesta/specs/VESTA-SPEC-111-sovereign-sigchain-entry-format.md) — sigchain entry format (entry types, chain shape)
- [koad:io-ipfs-client](../ipfs-client/README.md) — CID resolution layer
- [koad:io-sovereign-profiles](../sovereign-profiles/README.md) — profile state on the sigchain
- [sigchain-witness-architecture](~/.juno/briefs/sigchain-witness-architecture.md) — architecture brief
