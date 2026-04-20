# Emissions — Engineer Role

You build. The daemon's emission system is how you narrate work in flight so coordinators see what's happening without interrupting you. The base mechanics live in `KOAD_IO.md`'s Emissions section. This primer is your role-specific patterns.

## You're already in a flight

When you're dispatched as a subagent, the orchestrator's PreToolUse hook opened a `flight` emission for you and injected `KOAD_IO_EMISSION_ID` into your bash env. **Don't open a new lifecycle emission** — you're already in one.

What you do instead: emit updates as your work progresses. Coordinators watching the tree see your narration in real time.

```bash
source ~/.koad-io/helpers/emit.sh

# Long-running work — narrate the milestones
koad_io_emit_update "reading specs"
# ... do work ...
koad_io_emit_update "implementing /traffic endpoint"
# ... do work ...
koad_io_emit_update "running tests"
# ... do work ...
koad_io_emit_update "tests passing — committing"
```

The orchestrator's flight close hook will fire when you return — you don't need to `emit_close` yourself.

## Update meta when you learn things

Updates can carry metadata that gets merged into the emission. If you discover the cost or the package you touched, attach it:

```bash
koad_io_emit_update "shipped" '{"package":"meteor-koad-io","commits":3,"linesAdded":47}'
```

Coordinators querying your emission later see the structured data without parsing your update strings.

## Emit warnings for degraded conditions

When something is suspect but not blocking — a retry, a fallback, a deprecation, a slow upstream — fire a `warning`. Watchers and healers are listening.

```bash
koad_io_emit warning "npm install retried after registry timeout"
koad_io_emit warning "falling back to ollama after openrouter rate-limited"
```

Errors mean the work failed. Warnings mean the work proceeded but you noticed something.

## Errors close your flight

If you fail hard, don't try to keep narrating. Emit one `error` with the diagnosis and let your return summary close the flight:

```bash
koad_io_emit error "build failed: missing meteor-platform dep — installed but reify still chokes"
exit 1
```

Salus or whoever's watching can pick up from the error emission and the flight's history.

## Don't emit every tool call

Updates are for milestones a watcher would care about, not for "ran ls" / "ran grep". Once or twice per significant phase. The history array is meant to be readable — keep it readable.

## When you're not dispatched

If you're running interactively (no `KOAD_IO_EMISSION_ID` in env), you're in a `session` emission, not a `flight`. Same advice: don't open a new lifecycle, just `emit_update` if narration helps. Use `notice`/`warning`/`error` for one-shot signals.
