---
doc-debt: complete
doc-audience: developer
doc-updated: 2026-05-07
doc-maintainer: livy
title: "The Pluggable Indexer — Getting Started"
type: tutorial
relates-to:
  - /home/koad/.forge/control-tower/src/server/indexers/README.md
  - /home/koad/.forge/control-tower/src/server/indexer-registry.js
  - /home/koad/.forge/control-tower/src/server/jsonl-projector.js
  - /home/koad/.forge/control-tower/src/server/pluggable-indexers-startup.js
  - /home/koad/.forge/packages/koad-io-bridge/README.md
  - /home/koad/.forge/dance-hall/.koad-io-index.yaml
  - /home/koad/.koad-io/training/cascade/index.md
entities:
  - livy
audience: developers building new daemon-visible data surfaces
---

# The Pluggable Indexer — Getting Started

The daemon maintains live in-memory collections for all kingdom data — flights, entities, bonds, announcements. You can add your own collection to that set without touching a single line of daemon code.

The mechanism: drop a `.koad-io-index.yaml` file into your service directory. The daemon discovers it, reads your JSONL file, projects it into a named Minimongo collection, and registers a DDP publication. Any Meteor consumer on the mesh can subscribe immediately.

This walkthrough takes you from a service writing JSONL to a working subscription in a Meteor consumer. One concrete example, end to end.

---

## The scenario

You're building a service — call it `~/.statusd/` — that watches your kingdom's health and writes one status record per check. Each check is a JSON object:

```json
{"checkId": "disk-root", "status": "ok", "pct": 42, "ts": 1746650000}
{"checkId": "mem", "status": "warn", "pct": 88, "ts": 1746650000}
{"checkId": "disk-root", "status": "ok", "pct": 43, "ts": 1746650060}
```

The file grows as the service runs. For each `checkId`, you want the daemon to hold only the most recent record — not the full history.

That's `mode: current-per-key`, and it's the first mode you'll reach for when you want state rather than log.

---

## Step 1 — The service writes JSONL

Your service writes one JSON object per line to `~/.statusd/data/checks.jsonl`. Each line is a complete, self-contained record. No commas between lines. No array wrapper.

```
~/.statusd/
  data/
    checks.jsonl     ← your service writes here
```

If the `data/` directory doesn't exist yet, create it. The daemon will watch for the file but will not create it.

---

## Step 2 — Drop the yaml

Create `.koad-io-index.yaml` in the root of your service directory:

```yaml
# ~/.statusd/.koad-io-index.yaml
entity: statusd

indexers:
  - name: statusd-checks
    source: data/checks.jsonl
    collection: StatusChecks
    format: jsonl
    mode: current-per-key
    key: checkId
```

Field by field:

- **`entity`** — your service's handle. Injected into each record as an `entity` field, used for multi-entity collection sharing.
- **`name`** — daemon-wide unique identifier. Prefix with your service name to avoid collisions. `statusd-checks`, not `checks`.
- **`source`** — path to the JSONL file, relative to this yaml file. The daemon resolves it from `~/.statusd/data/checks.jsonl`.
- **`collection`** — PascalCase name for the Minimongo collection. This also becomes part of the DDP publication name.
- **`format: jsonl`** — one JSON object per line.
- **`mode: current-per-key`** — for each `checkId` value, only the last entry in the file is kept. Older entries with the same key are superseded.
- **`key: checkId`** — the field that identifies "which record is this the latest of."

For the full field reference, see the [indexers developer guide](../../.forge/control-tower/src/server/indexers/README.md).

---

## Step 3 — Trigger reload

The daemon discovers `.koad-io-index.yaml` files at startup and can re-scan without a full restart:

```bash
curl -X POST http://10.10.10.10:28282/api/indexers/reload
```

Response:

```json
{ "status": "ok", "reloaded": 8, "indexers": ["statusd-checks", ...] }
```

Your indexer name should appear in the list. If it doesn't, the daemon log will say why (missing file, malformed yaml, name collision).

You can also restart the daemon — hot reload is a convenience, not a requirement.

---

## Step 4 — Verify via daemon REST

The daemon doesn't expose a collection-contents REST endpoint, but the reload endpoint confirms the indexer is registered. For data verification, use DDP directly or read daemon logs:

```bash
# Watch daemon logs at startup or after reload
# You should see lines like:
[indexer-registry] scanning: found 4 .koad-io-index.yaml file(s)
[indexer-registry] loaded 1 indexer(s) from /home/koad/.statusd/.koad-io-index.yaml
[jsonl-projector] statusd-checks: created collection StatusChecks
[jsonl-projector] statusd-checks: registered publication indexed.StatusChecks
[jsonl-projector] statusd-checks: projected 2 entries → 2 docs in StatusChecks
```

The projection count ("2 docs") reflects the `current-per-key` reduction: three lines in the file collapsed to two documents because `disk-root` appeared twice and only the latest was kept.

---

## Step 5 — Subscribe from a Meteor consumer

There are two paths depending on whether your consumer already uses `koad:io-bridge`.

### Path A — The bridge is not wired for your collection yet

This is the common case for a brand-new indexer. Subscribe directly from your consumer's server code using the daemon DDP handle:

```js
// server/main.js (or any server file in your Meteor app)
import { _daemon } from 'meteor/koad:io-bridge';

// Declare the collection on the daemon connection
const StatusChecks = new Mongo.Collection('StatusChecks', { connection: _daemon });

// Subscribe to the daemon publication
_daemon.subscribe('indexed.StatusChecks', {
  onReady() { console.log('[statusd] StatusChecks ready'); },
  onError(err) { console.error('[statusd] StatusChecks error', err); }
});

// Publish to browsers via the null publication
Meteor.publish(null, function () {
  return StatusChecks.find();
});
```

The `connection: _daemon` declaration puts this collection in the bridge's minimongo, not Mongo. That is correct and intentional — the daemon runs with `MONGO_URL=false`; all collections are in-memory.

### Path B — Add your collection to the bridge

If this indexer is kingdom infrastructure that every consumer needs, add it to `koad:io-bridge` itself. The bridge README covers this in the Vulcan note section — it's a four-line addition. When you've done it, the collection is available as a named import everywhere the bridge is loaded.

```js
// After adding to the bridge:
import { StatusChecks } from 'meteor/koad:io-bridge';

Meteor.publish(null, function () {
  return StatusChecks.find();
});
```

Start with Path A. Add to the bridge when it becomes clear the collection belongs to shared kingdom infrastructure.

---

## Step 6 — Subscribe from the browser

With the server publish in place, the browser side is standard Meteor:

```js
// client/main.js
Meteor.subscribe('statusChecks'); // or whatever you named your pub

// In a Blaze helper:
Template.statusPanel.helpers({
  checks() {
    return StatusChecks.find({}, { sort: { ts: -1 } });
  }
});
```

The client-side `StatusChecks` collection receives data from the server's null publication. It does not connect to the daemon directly.

If you used the null publication (`Meteor.publish(null, ...)`) rather than a named publication, the subscription is automatic — no `Meteor.subscribe` call needed from the client.

---

## The live update loop

Once the indexer is running, writes to `data/checks.jsonl` propagate automatically:

1. Your service appends a line to `checks.jsonl`
2. The daemon's `fs.watch` on the `data/` directory fires (debounced to 200ms)
3. The projector re-reads the file and updates the `StatusChecks` collection
4. DDP pushes the change to all subscribed clients
5. Blaze re-renders

No polling. No manual refresh. The file is the source; the collection is the live projection.

---

## Common confusion points

**"My indexer is registered but the collection is empty."**

Check whether your JSONL file exists and has content. The projector starts watching immediately but cannot project a file that doesn't exist. Write at least one line, then trigger another reload or wait for the watch to fire.

**"I changed the yaml but the collection isn't updating."**

The yaml controls the projection config, not the data. Changing the yaml requires a reload (`POST /api/indexers/reload`) or daemon restart. Changing the JSONL file triggers re-projection automatically via `fs.watch` — no reload needed.

**"Mode `current-per-key` is keeping the wrong record."**

The projector reads the file top-to-bottom and the last entry for each key wins. If your older record is appearing, the newer record is earlier in the file. JSONL is append-only by convention — new state should always be a new line at the end.

**"I see the collection in the daemon but not in the browser."**

The bridge collects data in server-side minimongo. It doesn't reach the browser until a `Meteor.publish` cursor includes it. Make sure your null publication (or named publication) returns a cursor from this collection.

**"New publications added to the daemon after the bridge connected are not visible."**

The bridge subscribes at startup. If the daemon gains a new `indexed.*` publication after the bridge has already connected, the bridge will not pick it up until the consuming app restarts. This applies to new indexers you add after the app is already running. Add the indexer, reload the daemon, then restart your Meteor consumer.

---

## A real example: dance-hall

The dance-hall service uses four indexers. The yaml is at `~/.forge/dance-hall/.koad-io-index.yaml`. Here's the announcement surface indexer:

```yaml
indexers:
  - name: announcement-surface
    source: data/announcement.jsonl
    collection: AnnouncementSurface
    format: jsonl
    mode: current-per-key
    key: _id
```

The file holds one current announcement at a time. When Mercury publishes a new announcement, it appends a line with `_id: "current"`. The projector sees a new line with the same key, supersedes the previous record, and the daemon collection holds one document — the current announcement.

The `koad:io-bridge` package bridges `AnnouncementSurface` as a named collection. The storefront subscribes to it and renders the current announcement without any polling.

---

## Append-only, for reference

The scenario above used `current-per-key`. If you want every event preserved:

```yaml
indexers:
  - name: statusd-history
    source: data/history.jsonl
    collection: StatusHistory
    format: jsonl
    mode: append-only
```

Every line becomes a distinct document. The collection grows as the file grows. Documents are never removed from the collection (even if you delete lines from the file — the daemon doesn't track deletions). Use this for logs, audit trails, and archives where every entry matters.

---

## What happens at daemon restart

All pluggable collections are rebuilt from their source files at startup. There is no persistent storage — the Minimongo collections are in-memory only. Restart the daemon and every collection is re-projected from scratch. The JSONL file is the source of truth; the daemon collection is the live view.

---

## Deep dive

The [indexers developer guide](../../.forge/control-tower/src/server/indexers/README.md) covers the full yaml schema (including `source_glob`, `post-folder` format, composite keys, and override semantics), the projector internals (watch debounce, collection sharing rules, deletion semantics), and hardwired indexer authorship (for when you need to add a collection that belongs in the daemon codebase rather than a service yaml).

---

*Maintained by Livy. If the behavior described here diverges from what the daemon does, file a doc-update issue at [github.com/koad/livy](https://github.com/koad/livy).*
