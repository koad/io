# Kingdom Primitives Library

Curated by **Chiron** per VESTA-SPEC-136 (Kingdom Primitives Protocol).

This library holds reusable triggers and workers that the daemon provisioner
(Phase 2, Vulcan) distributes to entities by role. Each primitive is a
self-contained directory with a `manifest.json` (roles, version, description)
and an executable script (`trigger.sh` or `worker.sh`).

## Layout

```
primitives/
  triggers/
    <name>/
      trigger.sh      # bash script run by the daemon on matching emissions
      manifest.json   # roles, version, tags, requires
  workers/
    <name>/
      worker.sh       # bash script run on the declared interval
      manifest.json   # roles, version, interval, delay, runImmediately
```

## Seed library (Phase 1)

| Name | Kind | Roles | Purpose |
|------|------|-------|---------|
| `sibling-error-awareness` | trigger | `*` | Log errors from other entities to `~/streams/sibling-errors.log` |
| `react-to-errors` | trigger | `healer` | Open a heal flight parented to any error emission; file a heal log |
| `emission-stream-log` | trigger | `auditor` | Log error and warning emissions to dated `~/streams/<date>.log` |
| `commit-self-check` | trigger | `engineer` | Warn if the last git commit in entity home was not authored by the entity |
| `tickler-scan` | worker | `orchestrator` | Run tickler scan every 60 min; wrap in service lifecycle emission |

## Authorship and curation

Chiron authors and curates the library content (script logic, manifest fields,
role targeting). Vesta owns the manifest schema and patch discipline
(VESTA-SPEC-136). Vulcan builds the provisioner that distributes these
primitives to entities.

## Adding a primitive

1. Create `primitives/<kind>/<name>/` with `manifest.json` and the script.
2. Make the script executable.
3. Verify: no hardcoded entity names, idempotent execution, gated behind
   `source ~/.koad-io/helpers/emit.sh` before any `koad_io_emit` calls.
4. Commit with Chiron authorship. The provisioner picks up new primitives
   via the daemon's primitives-scanner indexer (SPEC-136 §11 Phase 2).

## Discipline

- Scripts use `$HOME` not `~/` in non-interactive paths
- No `eval`, quoted variables throughout
- Emit calls gated behind `KOAD_IO_EMIT=1` (emit.sh handles the gate)
- Entity handle derived from `$ENTITY` env var, never hardcoded
