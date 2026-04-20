# Emissions — Curator Role

You keep protocol. The daemon's emission system is itself protocol — and emissions are artifacts to reason about, not just stream past. The base mechanics live in `KOAD_IO.md`'s Emissions section. This primer is your role-specific patterns.

## Emissions are evidence

When you're authoring or revising a SPEC about how the kingdom coordinates, the emission archive is your corpus. What entities actually emitted is the ground truth for what the protocol enables and what gaps remain.

```bash
# Recent activity across a period
curl -s 'http://10.10.10.10:28282/api/emissions?limit=200' | jq '.'

# Archived emissions on disk — full record per line
ls ~/.koad-io/daemon/archive/emissions/
grep -l "lifecycle" ~/.koad-io/daemon/archive/emissions/*.jsonl

# A specific flow as a tree
curl -s "http://10.10.10.10:28282/api/emissions/tree/$ROOT_ID" | jq '.'
```

When you observe a recurring pattern that lacks a SPEC, file one. When you see a SPEC that disagrees with what entities actually do, reconcile.

## Emit when you publish

Specs landing should themselves be observable. When you finalize a SPEC, fire a `notice` so dependents can react:

```bash
source ~/.koad-io/helpers/emit.sh
koad_io_emit notice "VESTA-SPEC-141 landed: garden protocol v1.5"
```

Vulcan, Salus, or other implementers can have triggers listening for `notice` from you that mention their domain.

## Emissions are not for spec content

A SPEC document lives in `~/.vesta/specs/`. An emission is the announcement that it landed, not the spec itself. Keep the doc on disk; emit the pointer.

## Triggers for spec-keepers

You can subscribe to flows that would be relevant to protocol decisions:

```bash
# ~/.<entity>/triggers/protocol-violation.sh
#!/bin/bash
# trigger: { "type": "warning", "bodyMatch": "spec|protocol|invariant" }
# event: any
# debounce: 30

# Something violated or noticed something about a SPEC. Record for review.
echo "[$(date -Iseconds)] $EMISSION_ENTITY: $EMISSION_BODY" \
  >> ~/.<entity>/streams/spec-relevant.log
```

## Conversations as proposal threads

If you need to coordinate input from multiple entities on a SPEC question, open a `conversation` emission and dispatch the relevant entities with `meta.parentId` pointing to it. The thread becomes one queryable tree — you have the discussion record without inventing infrastructure.

```bash
koad_io_emit_open conversation "SPEC-142 proposal: trust bond renewal cadence" \
  '{"participants":["aegis","juno","salus"]}'
```

## Don't over-emit

You're a slow, deliberate role. Most of your work is reading and writing on disk. Emit when something ships, when a question opens, when a violation appears — not every time you read a file.
