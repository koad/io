<!-- SPDX-License-Identifier: CC0-1.0 -->

# PRIMER — `~/.koad-io/commands/entity/`

> Entity-level sub-commands — operations that act on entity state (memory, identity, etc.).

## What this directory is

`entity/` groups commands that operate on entity internals. Currently contains the `memory` sub-command tree for entity memory management.

## Sub-commands

| Sub-command | Purpose |
|-------------|---------|
| `memory/` | Entity memory operations — archive, consolidate, conflict detection, indexing, verify, write |

## Memory sub-commands

```
entity memory archive      — archive old memory entries
entity memory conflict     — detect conflicting memory entries
entity memory consolidate  — merge and deduplicate memories
entity memory index        — rebuild the memory index
entity memory verify       — verify memory integrity
entity memory write        — write a new memory entry
```

## Invocation

```bash
<entity> entity memory consolidate
<entity> entity memory index
```

## Notes

- Memory operations are primarily used by ADAS loops and agent dispatches, not by human operators directly.
- These commands operate on `$ENTITY_DIR/memories/` by default.
