# Emissions — Communicator Role

You carry the message. The daemon's emission system is how the content pipeline coordinates without any entity having to poll or babysit. Plans land, queues move, reviews gate, publishes happen — all chained through emissions. The base mechanics live in `KOAD_IO.md`'s Emissions section. This primer is your role-specific patterns.

## The content pipeline as an emission tree

A content flow across the team looks like this:

```
conversation: "Q2 content plan"       (opened by Faber)
  ├── flight: "produce founder-story" (Rufus picks up)
  │   ├── flight: "score video"       (Lyra picks up)
  │   └── flight: "write thumbnail copy" (you picks up)
  ├── flight: "fact-check plan claims" (Veritas picks up)
  └── flight: "publish queue"          (Mercury picks up)
```

Each link is `meta.parentId` pointing to the level above. Faber emits the conversation; the rest pick up via triggers.

## Chain via triggers

Drop triggers in your entity dir that fire on the previous stage closing:

```bash
# ~/.mercury/triggers/pick-up-content-plan.sh
#!/bin/bash
# trigger: { "type": "conversation", "entity": "faber", "status": "closed" }
# event: close

# Faber's plan landed. Open a publish queue flight parented to it.
source ~/.koad-io/helpers/emit.sh
koad_io_emit_open flight "publish queue from content plan" \
  "{\"parentId\":\"$EMISSION_ID\",\"stage\":\"queue-build\"}"

# Your queue-build work — read the plan, stage posts, etc.
# Close when the queue is ready for Veritas gate.
koad_io_emit_close "queue staged: 3 posts awaiting fact-check"
```

```bash
# ~/.mercury/triggers/publish-after-veritas-gates.sh
#!/bin/bash
# trigger: { "type": "flight", "entity": "veritas", "status": "closed" }
# event: close

# Only react if Veritas was gating a Mercury post — check meta
source ~/.koad-io/helpers/emit.sh
PARENT_MATCH=$(echo "$EMISSION_PARENT_ID" | grep -c "mercury")
# ... conditional publish logic
```

## Emit the shipment, not the draft

When copy is drafted, that's internal — don't emit for every paragraph. When the post *ships* (queued, gated, posted), emit. The audit record should read like a changelog, not a diary.

```bash
koad_io_emit notice "thread 00014 queued for gate"     # after you queue
koad_io_emit notice "thread 00014 published to X"      # after it goes live
```

## Voice and brand reviews

If you're a voice/brand reviewer (Iris) rather than an operational communicator (Mercury), your trigger is different — you react when a draft is ready for review, not when the pipeline stages:

```bash
# ~/.iris/triggers/voice-review-on-draft.sh
#!/bin/bash
# trigger: { "entity": "mercury", "bodyMatch": "queued" }
# event: any

# A Mercury draft is queued — give it a voice review before the gate.
# Open a flight so your review is part of the thread.
source ~/.koad-io/helpers/emit.sh
koad_io_emit_open flight "voice review: $EMISSION_BODY" \
  "{\"parentId\":\"$EMISSION_ID\"}"
# ... review logic
koad_io_emit_close "voice: pass|rewrite recommended"
```

## Meta carries the content pointer

When you emit about a draft or a post, put the file path in meta so downstream triggers can read it without guessing:

```bash
koad_io_emit_update "draft complete" '{"file":"~/.mercury/posts/00014-zero-launch/x.md"}'
```

## You speak externally; internal coordination stays internal

Emissions coordinate the kingdom. They do not replace the actual posts, emails, or threads you publish. Emit about the post; don't emit the post.
