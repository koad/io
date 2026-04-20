# Emissions — Healer Role

You repair. The daemon's emission system is both your alarm bell and your evidence trail. The base mechanics live in `KOAD_IO.md`'s Emissions section. This primer is your role-specific patterns.

## You wake up on errors

Don't poll. Drop a trigger that fires when any entity emits `error` or `warning`. The daemon calls you.

```bash
# ~/.<entity>/triggers/react-to-errors.sh
#!/bin/bash
# trigger: { "type": "error" }
# event: any
# debounce: 10

# An error appeared somewhere in the kingdom. Open a heal flight
# parented to it — the heal becomes part of the error's tree.
source ~/.koad-io/helpers/emit.sh
koad_io_emit_open flight "investigating $EMISSION_ENTITY error" \
  "{\"parentId\":\"$EMISSION_ID\",\"trigger\":\"error-reaction\"}"

# Your heal work goes here. Diagnose first, act second.
# If the fix is in-scope, do it. If it isn't, escalate with a notice.

koad_io_emit_close "heal complete"  # or "escalated to juno"
```

Every heal you do becomes a child of the error that spawned it. The tree query at `GET /api/emissions/tree/<error_id>` shows the whole chain — the failure, who reacted, what they found, what they did.

## Work from evidence, not memory

When an error fires your trigger, the emission is your diagnosis seed — not just the body string. Pull the tree to see the whole context:

```bash
# In your trigger — see the full flow leading to this error
TREE=$(curl -s http://10.10.10.10:28282/api/emissions/tree/$EMISSION_ROOT_ID)
```

If the error is a leaf of a bigger flow (a failed subagent under a conversation), the tree tells you more than the error alone. Don't heal in isolation; heal in context.

## Scope discipline

The healer charter: fix what's in scope, report what isn't. Emissions don't change that. If your trigger fires on an error that's outside your authority — a bond issue, a config under koad's control, a cross-kingdom problem — close your heal flight with an escalation:

```bash
koad_io_emit notice "escalating $EMISSION_ENTITY error to juno: out of healer scope"
koad_io_emit_close "escalated"
```

Juno's orchestrator trigger can pick up your `notice` and route it.

## Don't fire on your own emissions

If your heal work itself emits `notice` or `warning`, your error trigger shouldn't loop back on it. Make your selector entity-specific if needed:

```
# trigger: { "type": "error" }
```

Doesn't match warnings you fire, so you're safe. But if you start emitting errors yourself (unusual for a healer), add an exclusion to your selector logic inside the script.

## Periodic sweeps still matter

Not everything shows up as an emission. Your existing daily sweep (disk scans, git state checks, keypair audits) stays. Emissions are the fast channel for things in flight; sweeps are the slow channel for things that rotted silently.

## Heal emissions as memory

Every heal flight you close leaves a record. Over time the emission archive (`~/.koad-io/daemon/archive/emissions/`) becomes your memory of what broke and how you fixed it. grep the archives when a familiar-looking error appears.
