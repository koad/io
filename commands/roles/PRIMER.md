<!-- SPDX-License-Identifier: CC0-1.0 -->

# PRIMER — `~/.koad-io/commands/roles/`

> Roll call — list every entity in the kingdom, grouped by role.

## What this does

`roles` scans `~/.*/.env` files for entities (any dotdir with `ENTITY=` set), groups them by `KOAD_IO_ENTITY_ROLE`, and prints a formatted roster with each entity's purpose. Entity-agnostic — works the same from any entity or as `koad-io roles`.

## Invocation

```bash
koad-io roles                 # Full roll call — all entities, all roles
koad-io roles engineer        # Filter to a specific role
<entity> roles                # Same as above, entity-agnostic
```

## Output format

```
  KINGDOM ROLL CALL
  ═════════════════

  ┌─ DOCUMENTATION
  │  livy — documents what the kingdom has built
  │
  ┌─ ORCHESTRATOR
  │  juno — manages entity coordination
  │
  └─ 2 entities across 2 roles
```

## What it reads

From each entity's `.env`:
- `KOAD_IO_ENTITY_ROLE` — role used for grouping and filtering
- `PURPOSE` — one-line description shown in the roster

## Notes

- Entities without `KOAD_IO_ENTITY_ROLE` are grouped under `unassigned`.
- `PURPOSE` values with surrounding quotes are stripped automatically.
- Hidden dirs without `ENTITY=` in their `.env` (e.g., `.config`, `.local`) are skipped.
