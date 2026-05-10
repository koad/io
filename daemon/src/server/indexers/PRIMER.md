---
type: primer
folder: ~/.koad-io/daemon/src/server/indexers/
parents:
  - ~/.koad-io/daemon/src/server/
children: []
features:
  - name: (indexer-loader-summary)
    blurb: Startup logger that prints which KOAD_IO_INDEX_* indexers are active vs inactive at Meteor.startup()
    location: ~/.koad-io/daemon/src/server/indexers/index.js
relates-to:
  - ~/.koad-io/packages/daemon-indexers/
  - ~/.koad-io/daemon/src/server/PRIMER.md
entities:
  - vulcan
last-walked: 2026-05-09
as-of: e96d9337de4b8ce946ad6be6c5cee441513e230f
---

# daemon/src/server/indexers/ — Indexer Loader Summary

This directory contains a single file: `index.js`. It is a startup logger, not an indexer implementation.

## What index.js does

At `Meteor.startup()`, it checks the `KOAD_IO_INDEX_*` env vars for each of the 14 opt-in indexers and prints a summary:

```
[INDEXERS] Entity scanner: always on
[INDEXERS] Alerts: always on
[INDEXERS] Entity workers: always on
[INDEXERS] Founding cohort scanner: always on (CACULA-SPEC-004)
[INDEXERS] Active: KINGDOMS=true, BONDS=true, PASSENGERS=true, PRIMERS=true
[INDEXERS] Inactive: ENV, KEYS, TICKLER, DOCUMENTS
```

The 14 indexer implementations live in `~/.koad-io/packages/daemon-indexers/server/indexers/`. This directory is a stub — it exists to make Meteor eager-load `index.js` as part of the `server/` glob, nothing more.

## Opt-in indexers (controlled by env vars)

| Env var | Indexer |
|---------|---------|
| `KOAD_IO_INDEX_KINGDOMS` | kingdoms.js — Kingdoms collection, cross-kingdom bonds |
| `KOAD_IO_INDEX_PASSENGERS` | passengers.js — Passengers collection from passenger.json |
| `KOAD_IO_INDEX_ENV` | env.js — entity env var snapshot |
| `KOAD_IO_INDEX_BONDS` | bonds.js — trust bond graph |
| `KOAD_IO_INDEX_KEYS` | keys.js — entity key snapshot |
| `KOAD_IO_INDEX_TICKLER` | tickler.js — tickler file watcher |
| `KOAD_IO_INDEX_DOCUMENTS` | documents.js — document index |
| `KOAD_IO_INDEX_PRIMERS` | primers.js — PRIMER.md atlas frontmatter walker |
