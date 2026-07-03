---
type: primer
folder: ~/.forge/packages/entities/
status: documented
last-walked: 2026-06-19
---

# koad:io-entities — Entity Discovery & Identity

The canonical entity package for the koad:io ecosystem. Three-mode operation: scanner (disk), remote (DDP upstreams), off. Both `kingofalldata.com` and `desktop/interface` consume this package. Demoted from `~/.koad-io/packages/` to `~/.forge/packages/` on 2026-06-19 — incomplete until P2P discovery is addressed.

## Architecture

### Library vs Indexes

Two namespace tiers, both backing Mongo collections:

| Namespace | Purpose | Populated by | Examples |
|-----------|---------|-------------|----------|
| `koad.library.*` | Canonical, append-only witnessed facts | Scanner (disk) or DDP remote | entities, kingdoms, bonds, keys, alerts, env |
| `koad.indexes.*` | Derived, flexible, rebuildable views | Indexer packages | sessions, flights |

**Library is the blockchain.** Records are witnessed from disk or network. Never mutated — only added onto.

**Indexes are explorers.** Derived from library data. Can be dropped and rebuilt. Flexible schema.

### Three-Mode Operation

```
Mode       | Trigger                          | What happens
-----------|----------------------------------|----------------------------------------------
Scanner    | KOAD_IO_ENTITY_SCANNER=true      | Scans ~/.<name> dirs for entities with passenger.json. Populates koad.library.* from disk. Runs bond scanner.
Remote     | KOAD_IO_ENTITY_REMOTE=<urls>     | DDP-connects to upstream daemons. Subscribes to publications. Syncs into koad.library.* via observe.
Off        | (neither set)                     | Collections exist but stay empty.
```

### Chain of Custody

Every entity record carries a `source` array. Each hop appends. The first hop is the disk-truth daemon.

## Collections

**koad.library:** entities, kingdoms, bonds, keys, alerts, env
**koad.indexes:** sessions, flights

## Coordination

Uses `koad.ready()` from `koad:io-core`. Register → scan/sync → signal. Publications await before serving.

## Pattern for Other Packages

Any new package should:
1. Declare library collections (canonical facts)
2. Declare index collections (derived views)
3. Support three-mode (scanner/remote/off)
4. Use `koad.ready()` for async coordination
5. Self-register routes and templates
6. Same publication names in all modes

## Known Gaps

- **P2P discovery** — Remote mode requires configured upstream URLs. No mechanism for entities to discover peers on the mesh or across kingdoms. This is the next substrate consideration.
- **Kingdom discovery** — Kingdoms are a side effect of entity discovery. No cross-kingdom handshake protocol yet.
