# Pi Harness — koad:io Extension Surface

> How the kingdom actually works when you're running in Pi.

This file is the operational reality. `KOAD_IO.md` still loads for kingdom
principles, trust model, and entity conventions — but the tool surface
described there (bash commands, `source emit.sh`, `juno control dispatch`)
is not how Pi works. The extensions registered at
`extensions/koad-io/` replace that surface with native Pi tools.

## Tool Surface

Every coordination primitive is a Pi tool — typed parameters, rich schemas,
blocking waits. You are not running bash subprocesses to coordinate.

### Dispatch (the `Agent` tool alternative)

| Tool | What it does |
|------|-------------|
| `dispatch` | Assembles a flight plan, launches a detached harness session via control-tower. Returns flight-id immediately. |
| `wait` | Blocks until a dispatched flight lands (`sub=flight`) or the entity requests follow-up (`sub=followup`). |
| `dispatch_followup` | Sends a follow-up prompt to a running entity. Appends JSONL to the flight's followup file. |
| `dispatch_complete` | Signals mission complete. The entity's `wait followup` returns with `action=complete`. |

Dispatch is the replacement for the legacy `Agent` tool pattern. Up to 2 in
parallel for non-conflicting work. The flight watcher auto-injects landing
notifications into your conversation via the DDP stream (see below).

**Never use the Pi `Agent` tool for team entities.** It runs in your process
on your quota and commits under your authorship. `dispatch` launches a
detached session with the entity's own identity cascade.

### Questions (the batphone)

| Tool | What it does |
|------|-------------|
| `ask_question` | File a question to an operator or entity. Default `wait: true` blocks until answered (9 min timeout). Set `wait: false` to fire-and-forget. |
| `wait_for_answer` | Re-enter the wait after a transport drop. The question is still alive — don't file a duplicate. |
| `answer_question` | Answer an open question. Unblocks any waiting caller. |

If the transport drops mid-wait, you'll see a connection error. You are NOT
done. Call `wait_for_answer(question_id)` to re-enter the poll loop. If you
lost the `question_id`, query `GET /api/questions?from=<entity>&status=open`.

### Command Cascade (via `koad-io` tool)

The `koad-io` tool is a typed gateway to the framework binary. Use it for:

| Pattern | Example |
|---------|---------|
| `koad-io announce <body>` | Kingdom-wide signal |
| `koad-io message <to> <body>` | Drop a note in an entity's inbox |
| `koad-io tickle <to> <body>` | Deferred reminder |
| `koad-io pin <ref> [tags]` | Lightweight coordination anchor |
| `koad-io session <sub> [args]` | Session awareness (objective, land, watch) |
| `koad-io emit <type> <body>` | Fire an emission (notice, warning, error) |
| `koad-io git <args>` | Git operations with pre/post emissions |

Also available as a `/koad-io` slash command (output via message, not tool result).

### Kingdom Awareness

| Tool | What it does |
|------|-------------|
| `search` | Waterfall search across all entities, forge, framework. Modes: text, where (frontmatter), related (constellation), stale (forgotten work), atlas (dashboard). |
| `status` | Kingdom operational pulse — daemon health, active flights, recent emissions, sessions. |

### Channels

When `KOAD_IO_CHANNEL_BACKEND=true`: `wait_for_cue`, `raise_hand`, `channel_leave`,
`channel_state_read`, `channel_cue_deliver`, `channel_broadcast`,
`channel_wait_for_next_turn`, `channel_wait_for_state_change`, `channel_event_fire`.

### Music

`music` tool — skip, queue, now playing, play, pause. Controls Groove Basin at
disco.koad.sh:16242. Now-playing appears in footer row 5.

## Footer (the 3-5 rows at the bottom)

The footer is live telemetry, not static text.

**Row 1 — Identity:** `operator on host with entity cwd 🐏 RAM`
- 🐏 appears when the working tree is dirty (staged, modified, untracked, etc.)
- RAM shows used/total

**Row 2 — Git + tokens:** `remote 🌱branch 📦staged 🗑️deleted ●modified 🌱untracked` then `↑tokensIn ↓tokensOut $cost ccontext%`
- Token counters accumulate across the session
- Cost is session total
- Context % shows token window utilization; color shifts green→yellow→red

**Row 3 — Timestamp + status:** `YY:MM:DD:HH:MM:SS ◊ koad:io` then turn count, active tool, kingdom health dots, error count
- `d● c●` — daemon and control-tower health (● = ok, ◐ = degraded, ○ = down)
- `⚠N` — error count for this session
- Active tool shows when a tool is executing (e.g., `⚙bash src/foo.ts`)

**Row 4 — Last emission:** Appears when a kingdom emission fires (fades after 60s). Shows entity, type, body.

**Row 5 — Now playing:** Currently playing track from Groove Basin (only when music is playing).

Extension statuses (bond gate, channels, etc.) appear at the end of row 3 as compact labels.

## DDP Stream (kingdom events in your conversation)

The extension maintains two WebSocket connections (daemon + control-tower) via
Meteor DDP. Events are injected as system messages mid-conversation — you don't
poll. You'll see:

| Event | Format |
|-------|--------|
| Flight landed | `✓ **entity** landed ⟐ flightId (Xs)` |
| Flight error | `⚠ **entity** error ⟐ flightId — reason` |
| Kingdom error | `⚠ **entity**: error message` |
| Message to you | `📨 **entity**: message body` |
| Chat message | `📺 **viewer**: message body` (YouTube/external) |

These appear as non-turn-triggering system messages. They don't interrupt —
they inform.

## Bond Gate

When `KOAD_IO_EXPERIMENTAL=1`, every `read`, `write`, `edit`, and `bash` call
is gated against trust bonds in `~/.<entity>/trust/bonds/`. Currently **disabled**
(the extension returns early at the top — too hard right now, needs evolution).

When active, the gate:
- Parses bond frontmatter to determine bond type
- Derives effective scope: read prefixes, write prefixes, exec cwd, blocked patterns
- Blocks tools that fall outside scope
- Emits `tool.blocked` events to the daemon for audit
- Injects bond scope into the working message at session start
- No bonds = restricted to own entity directory (readonly for most things)

Blocked paths include `.env`, `.credentials`, `id/`, `trust/` for all bond types
below authorized-agent. Dangerous bash patterns (sudo, chmod 777, recursive rm on
root-ish paths) are blocked regardless of bond type.

## Live Typing

Every keystroke in the Pi input box is streamed to the daemon's
`/api/prompt/live` endpoint. The storefront at `kingofalldata.com/live`
renders "Entity is typing..." with the draft text. Clears on submit.
Auto-clears after 10s of no input.

This is invisible to you — it just happens.

## Hook Shims

Pi lifecycle events are bridged to the kingdom bash hooks:

| Pi event | Hook | Effect |
|----------|------|--------|
| `session_start` | `standing-watchers.sh` | Registers per-entity watchers for this session |
| `session_start` | `session-harvest.sh` | Writes session state to disk (async, detached) |
| `input` (user/rpc) | `prompt-awareness.sh` | Injects inbox awareness as `<system-reminder>` block |

You don't run these — they run on you.

## /kingdom Command

Interactive TUI overlay (right-center panel). Tabs: all, flights, bonds, health,
errors. DDP-live — updates without polling. Navigate with arrow keys or `l`/`h`.
Close with Escape.

## Session Awareness

The `koad-io session` tool (via the `koad-io` tool router) provides:
- `objective <text>` — declare session intent
- `land <type> <ref> [summary]` — atomic landing event
- `intent-update <focus>` — update current focus mid-session
- `watch <pattern>` — register a watcher for this session
- `inbox` — read pending watcher-matched events

But inbox awareness also arrives automatically via the `prompt-awareness.sh` hook
on every user input — you don't need to poll.

## What's Different from KOAD_IO.md

| KOAD_IO.md says | Pi reality |
|----------------|-----------|
| `juno control dispatch <entity>` | `dispatch` tool |
| `source ~/.koad-io/helpers/emit.sh` | `koad-io emit` tool |
| `juno dispatch <entity>` | `dispatch` tool |
| `curl http://10.10.10.10:28282/api/...` | DDP stream injects events; `status` tool for queries |
| Daemon REST polling | DDP WebSocket (live, reactive) |
| Bash hooks run on command invocation | Hook shims run on Pi lifecycle events |
| `juno message <to> <body>` | `koad-io` tool or `message` Pi tool |
| No footer mentioned | 3-5 row live telemetry footer |
| No bond gate mentioned | Every tool call gated (when enabled) |
| No live typing mentioned | Keystrokes stream to storefront |
| No `/kingdom` command | Interactive DDP-live dashboard |

The kingdom principles (sovereignty, trust model, entity model, env cascade) are
unchanged. This file describes the *interface*, not the *constitution*.
