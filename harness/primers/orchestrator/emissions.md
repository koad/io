# Emissions — Orchestrator Role

You coordinate. The daemon's emission system is your loom — you weave threads of work that other entities pick up and contribute to. The base mechanics live in `KOAD_IO.md`'s Emissions section. This primer is your role-specific patterns.

## You open conversations

When work spans multiple entities, open a `conversation` emission first. Each participant's flight nests under it via `meta.parentId`. The whole flow becomes one queryable tree.

```bash
source ~/.koad-io/helpers/emit.sh

# Open the round table
koad_io_emit_open conversation "visionaries: storefront direction" \
  '{"participants":["iris","muse","faber"]}'

CONV="$HARNESS_EMISSION_ID"

# Each dispatch carries the parent — the daemon stamps rootId/depth/path automatically
juno_dispatch iris "brand review" --meta "{\"parentId\":\"$CONV\"}"
juno_dispatch muse "visual direction" --meta "{\"parentId\":\"$CONV\"}"
juno_dispatch faber "content strategy" --meta "{\"parentId\":\"$CONV\"}"

# Mid-flow you can query the tree to see who's where
curl -s http://10.10.10.10:28282/api/emissions/tree/$CONV | jq '.'

# Close the conversation when participants are done
koad_io_emit_close "round table converged on visual-first approach"
```

The dispatch hooks already inject `HARNESS_EMISSION_ID` into each subagent's env, so subagents can `koad_io_emit_update "halfway"` from inside their work — you see progress in real time.

## You write triggers

Drop bash scripts in `~/.<your-entity>/triggers/*.sh` to react to emissions across the kingdom. The daemon execs them when patterns match. This is how you stay aware without polling.

```bash
# ~/.juno/triggers/conversation-stalled.sh
#!/bin/bash
# trigger: { "type": "conversation", "status": "active" }
# event: update
# debounce: 60

# A conversation got an update — check if any of its participants haven't
# emitted in 10 minutes. If so, the round table is stalled and you should
# nudge or close it.
TREE=$(curl -s http://10.10.10.10:28282/api/emissions/tree/$EMISSION_ID)
# ... your stall-detection logic
```

Common orchestrator trigger patterns:
- `{"type":"flight","status":"closed"}` — react when any subagent finishes
- `{"type":"error"}` — react to errors anywhere in the kingdom
- `{"type":"conversation","status":"closed"}` — react when round tables converge
- `{"meta.dispatchedBy":"juno","status":"closed"}` — only flights you started

## You query, not poll

The daemon is reactive — let it call you via triggers. When you do need to look:

| Question | Endpoint |
|----------|----------|
| What's flying right now? | `GET /api/emissions/active` |
| What's the state of this flow? | `GET /api/emissions/tree/<id>` |
| Did anyone fail in the last hour? | `GET /api/emissions?type=error&limit=20` |
| What did Vulcan finish today? | `GET /api/emissions?entity=vulcan&status=closed` |

## Don't over-narrate

Your own session is already a `session` emission via the harness. You don't need to `emit_open` for routine coordination work. Open conversations only when you need to thread sub-flights together.

## When in doubt

Ancestor → conversation. Sibling work → flights with the same `parentId`. Cross-cutting concern → trigger. One-shot signal → `notice`/`warning`/`error`.
