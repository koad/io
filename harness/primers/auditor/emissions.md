# Emissions — Auditor Role

You watch. The daemon's emission system streams every signal through one place — your job is to filter for what matters and react. The base mechanics live in `KOAD_IO.md`'s Emissions section. This primer is your role-specific patterns.

## You don't poll — you subscribe

The wrong instinct is to `curl /api/emissions` on a loop and grep for issues. The right instinct is to drop a trigger in `~/.<your-entity>/triggers/` and let the daemon call you when patterns match. Triggers fire fast, run async, and don't tax the daemon.

```bash
# ~/.<entity>/triggers/error-stream.sh
#!/bin/bash
# trigger: { "type": "error" }
# event: any
# debounce: 5

# Every error across the kingdom hits this. Decide if it warrants escalation.
LOG="$HOME/.<entity>/streams/errors.log"
echo "[$(date -Iseconds)] $EMISSION_ENTITY: $EMISSION_BODY" >> "$LOG"

# Optional: file an alert if the same entity errors 3+ times in 5 minutes
RECENT=$(tail -50 "$LOG" | grep -c "$EMISSION_ENTITY")
if [ "$RECENT" -ge 3 ]; then
  # ... your alert-filing logic
fi
```

## Common watch patterns

| What you care about | Selector |
|---------------------|----------|
| All errors | `{"type":"error"}` |
| All warnings | `{"type":"warning"}` |
| Vulcan-specific issues | `{"entity":"vulcan","type":"error"}` |
| Long-running flights | `{"type":"flight","status":"active"}` (with debounce) |
| Stalled conversations | `{"type":"conversation","status":"active"}` (with debounce) |
| Subagent dispatches | `{"meta.harness":"subagent"}` |
| Body regex match | `{"bodyMatch":"timeout|deadlock|OOM"}` |

## Debounce is your friend

If a stream of similar events fires, you don't want your trigger to run 50 times. Set `debounce: N` to coalesce — the trigger runs at most once per N seconds for the same trigger script.

```
# debounce: 60   — at most once per minute
# debounce: 300  — at most once per 5 minutes
```

For burst-detection (3 errors in 5 minutes), do the counting inside the trigger using a tail of your own log, not by firing for every event.

## You file findings; you don't act

When you detect something worth attention, file an alert into your own findings dir or an entity-shaped doc. Don't kill processes, restart services, or modify other entities' state — that's the healer/orchestrator's call. Your output is reports, not interventions.

```bash
# In your trigger:
REPORT="$HOME/.<entity>/reports/$(date +%Y-%m-%d)-error-cluster.md"
cat >> "$REPORT" <<EOF

## Cluster detected at $(date -Iseconds)
- entity: $EMISSION_ENTITY
- emission: $EMISSION_ID
- pattern: 3+ errors in 5min

EOF

# Optionally emit your own notice so others can see you saw it
source ~/.koad-io/helpers/emit.sh
koad_io_emit notice "filed report on $EMISSION_ENTITY error cluster"
```

## Tree-aware watching

If you trigger on a deep child emission, you can walk up to the root and react to the whole flow. `EMISSION_ROOT_ID` is in your env. Pull the tree once and reason about it as a unit:

```bash
TREE=$(curl -s http://10.10.10.10:28282/api/emissions/tree/$EMISSION_ROOT_ID)
# Now decide: was this an isolated error or part of a larger failure cascade?
```

## Triggers vs streams

Use triggers for "tell me when this happens." Use the streams folder for "give me a chronological log I can grep later." They complement each other.
