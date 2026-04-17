<!-- SPDX-License-Identifier: CC0-1.0 -->

# PRIMER — `~/.koad-io/commands/adas/`

> ADAS (Autonomous Dispatch and Scheduling) — helper scripts for agent loop control, token budget enforcement, and flight report instrumentation.

## What this directory is

`adas/` is a collection of utility scripts used by ADAS loops (VESTA-SPEC-107 and VESTA-SPEC-103). They are not invoked as `<entity> adas` — they are sourced or called directly from within agent dispatch loops.

## Scripts

| Script | Purpose |
|--------|---------|
| `route-model.sh` | Resolve model tier (local/mid/frontier) for a given leg type; applies `model_ceiling` constraint from flight plan |
| `budget-ceiling.sh` | Check token consumption against budget; emits WARN/WRAP/STOP signals at 80%/95%/100% |
| `flight-report-fields.sh` | Emit YAML `token_budget:` block for inclusion in flight reports |
| `memory-pass-report.sh` | Emit YAML `memory_pass:` instrumentation block (VESTA-SPEC-103 §11.5) |

## Invocation

These scripts are called by ADAS loops, not by entity operators directly:

```bash
adas route-model --leg memory_consolidation --ceiling mid
adas budget-ceiling --consumed 42000 --total 50000
adas flight-report-fields --budget 50000 --consumed 48230 --model-ceiling mid
adas memory-pass-report --consumed 4200 --budget 20000 --files-read 18
```

## Notes

- There is no top-level `command.sh` here — `adas` is not a dispatchable entity command.
- Leg type routing defaults follow the Hermez routing table in VESTA-SPEC-107 §3.2.
- Model ceiling from the flight plan always caps the recommended tier — it never elevates it.
