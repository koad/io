# Emissions — Designer Role

You make the visual or mechanical artifacts the kingdom ships. The daemon's emission system is how you signal when assets are ready for consumption, and how you pick up asset requests without the caller having to babysit. The base mechanics live in `KOAD_IO.md`'s Emissions section. This primer is your role-specific patterns.

## You emit when assets land

Your work is slower than a reactive watcher — a render batch, a palette extraction, a badge schema, a mechanics design doc. When the asset is ready for use, emit once so downstream pickers-up can consume it.

```bash
source ~/.koad-io/helpers/emit.sh

# Render batch complete
koad_io_emit notice "flux-pro batch complete: 12 images" \
  '{"out":"~/.muse/renders/2026-04-20-founder-story/"}'

# Or if part of a larger flow — emit an update on the parent instead
# (you're probably already inside a flight emission that was dispatched to you)
koad_io_emit_update "12 images rendered, 1 flagged for redo" \
  '{"flagged":["image-07.png"]}'
```

## Meta carries the artifact

Always include the output path (or palette hash, or schema ID, or whatever the asset is) in meta. Downstream triggers can read the meta without parsing your body text.

```bash
koad_io_emit notice "badge schema drafted" \
  '{"schema":"~/.cacula/schemas/flowbie-builder-v2.yaml","version":"v2"}'

koad_io_emit notice "palette extracted" \
  '{"entity":"thalia","hue":220,"sat":35,"bri":55}'
```

## You don't write many triggers

Most designer work is request-driven — someone asks for an asset, you produce it. You don't usually need to react to streams of emissions. If you do need a trigger, it's usually "my upstream produced something I need to render":

```bash
# ~/.muse/triggers/render-on-avatar-update.sh
#!/bin/bash
# trigger: { "type": "notice", "bodyMatch": "avatar reference" }
# event: any
# debounce: 30

# Someone dropped a new avatar reference. Queue a render job.
# ... your render queue logic
```

Don't over-subscribe. If you add a trigger for every signal that might be interesting, you'll be rendering in a loop. Debounce hard and be picky.

## Game mechanics (Cacula)

If you design mechanics rather than visuals, emissions help you signal when a schema lands for Vulcan to implement. Same pattern — emit when the schema is ready, include the file path in meta. Vulcan's trigger (if wired) picks it up and starts the implementation flight.

## Batch your emissions

A render batch of 200 images is one emission — the batch — not 200 emissions. A palette extraction pass across 20 entities is one emission summarizing the run. Granularity matters; the audit trail should be useful, not flooded.

## Visual regression is watcher territory

When a render breaks (wrong dimensions, missing alpha, corrupt output), emit `warning` or `error` with the file path. Auditors and healers are listening and will pick it up. You don't have to fix broken assets yourself unless it's a trivial re-render.
