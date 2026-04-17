# Multi-Kingdom Mode

The koad:io daemon can index multiple kingdoms simultaneously. This document explains why
you'd want that, how to configure it, what happens when you enable it, and how to verify
it's working.

For conceptual background, see [docs/multi-kingdom-operators.md](../docs/multi-kingdom-operators.md).
For the protocol specification, see VESTA-SPEC-115.

---

## Why multi-kingdom

The default mode (no `kingdoms.json`) treats all entities as a flat namespace — every
entity your daemon discovers is just an entity. That works fine if you operate exactly one
community.

Enable multi-kingdom when you:

- **Run multiple communities** — your own kingdom plus one you participate in as a member
  or guest
- **Want Jesus as a memory reconciler** — Jesus is a peer resource available to all kingdoms
  as an authorized specialist; indexing his kingdom alongside yours makes him a first-class
  daemon participant, not an unknown entity
- **Operate community coin kingdoms** — Rooty's kingdom at rooty.cc is community-stewarded;
  the CCT operates it collectively; your daemon needs to know that Rooty is a sovereign, not
  just another team entity
- **Need cross-kingdom trust graph queries** — `CrossKingdomBonds` collection only populates
  in multi-kingdom mode; cross-kingdom bonds in flat-namespace mode are indexed as ordinary
  bonds with no kingdom context

---

## Configure `kingdoms.json`

Copy the example and edit it:

```sh
cp ~/.koad-io/daemon/kingdoms.json.example ~/.koad-io/daemon/config/kingdoms.json
```

The example covers all three current kingdoms on wonderland:

```json
{
  "kingdoms": [
    {
      "id": "koad-io",
      "name": "koad:io",
      "domain": "kingofalldata.com",
      "sovereign": "koad",
      "sovereigntyModel": "delegate",
      "members": [
        "juno", "vulcan", "vesta", "muse", "mercury", "sibyl",
        "argus", "salus", "janus", "aegis", "veritas", "iris",
        "atlas", "hestia", "diana", "apollo", "athena", "hermes",
        "ares", "poseidon", "hades"
      ]
    },
    {
      "id": "churchofhappy",
      "name": "Jesus",
      "domain": "churchofhappy.com",
      "sovereign": "jesus",
      "sovereigntyModel": "solo",
      "members": ["jesus"]
    },
    {
      "id": "rooty",
      "name": "Rooty",
      "domain": "rooty.cc",
      "sovereign": "rooty",
      "sovereigntyModel": "community-stewarded",
      "members": ["rooty"]
    }
  ]
}
```

**Field reference:**

| Field | Required | Description |
|-------|----------|-------------|
| `id` | yes | Stable slug — used as the collection `_id`; keep it short and lowercase |
| `name` | yes | Human-readable kingdom name |
| `domain` | yes | Discovery domain (routing hint — not the canonical identifier) |
| `sovereign` | yes | Entity handle of the kingdom sovereign |
| `sovereigntyModel` | yes | `"delegate"`, `"solo"`, or `"community-stewarded"` |
| `members` | yes | Array of entity handles who are full members |

---

## Enable the indexer

Set `KOAD_IO_INDEX_KINGDOMS=true` in your daemon's `.env` or environment:

```sh
# ~/.koad-io/.env (or entity-specific .env)
KOAD_IO_INDEX_KINGDOMS=true
```

Then restart through the cascade. Do not kill the Meteor process directly — restart via
the entity launcher to avoid 502s across your subdomain surface:

```sh
# Restart through cascade
juno restart daemon
# or whatever your entity launcher command is
```

---

## What happens when you enable it

On startup, the `kingdoms-indexer.js` reads `kingdoms.json`, seeds the `Kingdoms`
collection, and stamps every entity in the `Entities` collection with a `kingdomId`.

**Collections that become active:**

| Collection | Contents | Available via |
|-----------|----------|---------------|
| `Kingdoms` | One record per kingdom | `Meteor.subscribe('kingdoms')` |
| `Entities` (extended) | All entities, now with `kingdomId` | `Meteor.subscribe('entities.byKingdom', 'koad-io')` |
| `CrossKingdomBonds` | Bonds between entities in different kingdoms | `Meteor.subscribe('crossKingdomBonds')` |

**What each collection holds:**

```js
// Kingdoms — one record per kingdom
{
  _id: 'koad-io',
  name: 'koad:io',
  domain: 'kingofalldata.com',
  sovereign: 'koad',
  invitationSurface: 'https://kingofalldata.com',
  memberHandles: ['juno', 'vulcan', ...],
  discoveredAt: Date,
}

// Entities — extended schema (existing fields unchanged)
{
  handle: 'jesus',
  kingdomId: 'churchofhappy',    // NEW
  sovereignKingdom: 'churchofhappy',  // NEW — non-null if this entity is a kingdom sovereign
  ...
}

// CrossKingdomBonds — cross-kingdom trust relationships
{
  fromKingdomId: 'koad-io',
  toKingdomId: 'churchofhappy',
  fromEntity: 'koad',
  toEntity: 'jesus',
  bondType: 'authorized-specialist',
  bondFile: 'koad-to-jesus.md',
  sigStatus: 'signed',
  scannedAt: Date,
}
```

**Existing publications are unchanged.** `entities`, `passengers`, `entities.byRole` all
continue to work exactly as before. Multi-kingdom is purely additive.

---

## Backwards compatibility

| State | Behavior |
|-------|---------|
| No `kingdoms.json` | Flat-namespace mode. All indexers behave exactly as before. `Kingdoms` collection stays empty. `kingdomId` on entities stays `null`. |
| Empty `kingdoms.json` (`{ "kingdoms": [] }`) | Same as absent — flat-namespace mode. |
| `kingdoms.json` present, `KOAD_IO_INDEX_KINGDOMS` unset | File exists but indexer does not activate. Safe to ship the config file before enabling. |
| `kingdoms.json` present, `KOAD_IO_INDEX_KINGDOMS=true` | Kingdom mode active. All three collections populate on startup. |

You can ship `kingdoms.json` to a machine before enabling the env var. No data is written
until the indexer activates.

---

## Debugging

**Which kingdoms are indexed?**

From a Meteor shell or the PWA console:

```js
Kingdoms.find().fetch()
// Returns array of kingdom records, or [] if kingdoms.json is absent/indexer not enabled
```

**Verify an entity's kingdom membership:**

```js
Entities.findOne({ handle: 'jesus' })
// { handle: 'jesus', kingdomId: 'churchofhappy', sovereignKingdom: 'churchofhappy', ... }

Entities.findOne({ handle: 'rooty' })
// { handle: 'rooty', kingdomId: 'rooty', sovereignKingdom: 'rooty', ... }

Entities.findOne({ handle: 'juno' })
// { handle: 'juno', kingdomId: 'koad-io', sovereignKingdom: null, ... }
```

**Entities not listed in any kingdom's `members` array:**

```js
Entities.find({ kingdomId: 'unassigned' }).fetch()
// Entities discovered on disk but not claimed by any kingdom in kingdoms.json
```

**Cross-kingdom trust graph:**

```js
// All bonds where jesus is involved across any kingdom boundary
CrossKingdomBonds.find({
  $or: [{ fromEntity: 'jesus' }, { toEntity: 'jesus' }]
}).fetch()
```

**Daemon logs:**

The `kingdoms-indexer.js` logs to the standard daemon log on startup:

```
[kingdoms-indexer] loaded 3 kingdoms from kingdoms.json
[kingdoms-indexer] stamped 23 entities with kingdomId
[kingdoms-indexer] 0 entities unassigned
```

If you see `loaded 0 kingdoms`, check that `KOAD_IO_INDEX_KINGDOMS=true` is set and the
daemon was restarted through the cascade after the env var change.

---

## What's not yet wired

| Feature | Status |
|---------|--------|
| Sigchain verification of membership | Not yet — membership is declared in `kingdoms.json`, not verified against sigchain entries. SPEC-115 §3 defines the bilateral sigchain record; verification layer comes with sigchain indexer work. |
| Cross-kingdom invitation tooling | Protocol specified in SPEC-115 §6. No CLI tooling yet. |
| `rootSigchainCid` field on Kingdoms records | Stub — populated when kingdom sigchains are established and indexed |
| `sovereignCid` field on Kingdoms records | Stub — populated when sovereign's genesis sigchain entry is indexed |
| FROST/MuSig2 for community-stewarded signing | Deferred — see SPEC-115 §5.3, §8.3 |

The indexer is functional and kingdom-aware using `kingdoms.json` as the membership
authority. Sigchain verification will replace config-file membership declaration when the
sigchain indexer ships. The collection schema is designed to accommodate this transition
without breaking changes.

---

## Related

- [docs/multi-kingdom-operators.md](../docs/multi-kingdom-operators.md) — conceptual background and sovereignty models
- [VESTA-SPEC-115](~/.vesta/specs/VESTA-SPEC-115-kingdom-model.md) — protocol specification
- [kingdoms.json.example](kingdoms.json.example) — annotated config example
- [Vulcan indexer assessment](~/.vulcan/assessments/2026-04-17-daemon-multi-kingdom-indexer.md) — implementation shape and build order

---

*Livy — documentation lead, koad:io*
*Filed 2026-04-17. Grounded in Vulcan's daemon indexer assessment and VESTA-SPEC-115 v1.0.*
