---
type: primer
folder: ~/.koad-io/harness/
parents:
  - ~/.koad-io/
children:
  - path: harness/primers/
    blurb: Thirteen role-specific context directories — analyst, auditor, communicator, curator, curriculum, designer, engineer, healer, keeper, orchestrator, producer, researcher, teacher
    status: documented
  - path: harness/extensions/
    blurb: Pi harness extensions — koad-io (kingdom integration), koad-io-hooks (lifecycle hooks), koad-io-bond-gate (permission gating)
    status: documented
  - path: harness/config/
    blurb: Framework-level tooling config — opencode.jsonc, model-prices.json
    status: documented
  - path: harness/patches/
    blurb: Third-party tool patches — opencode.patch
    status: documented
  - path: harness/plugins/
    blurb: Harness extension shelf — plugins that render into harness chrome (opencode, pi, claude, hermez)
    status: documented
  - path: harness/default/
    blurb: Kindergarten default harness — minimal dependency, opencode launcher
    status: documented
features:
  - name: entity-context-assembly
    blurb: startup.sh assembles KOAD_IO.md → ENTITY.md → role primers → pre-emptive primitives into a SYSTEM_PROMPT before the session opens
    location: ~/.koad-io/harness/startup.sh
  - name: harness-light-mode
    blurb: --light flag (or KOAD_IO_STARTUP_LIGHT=1) strips briefs, daemon status, flights, inbox, working-dir listing — fast context for conversation dispatch
    location: ~/.koad-io/harness/startup.sh
  - name: role-primer-system
    blurb: KOAD_IO_ENTITY_ROLE in entity .env selects a primers/<role>/ folder; every .md in it is injected as a Role Primer section at startup
    location: ~/.koad-io/harness/primers/
  - name: harness-variable-substitution
    blurb: _subst() replaces $ENTITY/$ENTITY_DIR/$HOST/$USER/$DATE/$PURPOSE/$ROLE in all primer files so one source file serves every entity
    location: ~/.koad-io/harness/startup.sh
  - name: destination-memory
    blurb: Prior-visit note files at ~/.<entity>/destinations/$HOST/<path>/ surfaced at startup so roaming entities know they have prior context
    location: ~/.koad-io/harness/startup.sh
  - name: harness-default
    blurb: Kindergarten default harness — minimal dependency, ensures opencode binary exists, assembles context, launches opencode; first harness a new koad:io user encounters
    location: ~/.koad-io/harness/default/command.sh
  - name: memory-kek-ceremony
    blurb: Node.js ceremony implementing VESTA-SPEC-134 §6.2 Path C — passphrase prompt, KEK derivation UI, stub JSON output; real Argon2id wired in Phase 6
    location: ~/.koad-io/harness/memory-kek-ceremony.js
  - name: pi-extension-system
    blurb: Three pi extensions loaded at session start — koad-io (kingdom integration), koad-io-hooks (lifecycle bridges), koad-io-bond-gate (tool permission gating)
    location: ~/.koad-io/harness/extensions/
  - name: ddp-reactive-layer
    blurb: WebSocket DDP clients connect to control-tower (flights, bonds, sessions) and daemon (emissions, cues, questions) for live reactive state — no REST polling
    location: ~/.koad-io/harness/extensions/koad-io/ddp.ts
  - name: dispatch-system
    blurb: Entities can dispatch work to other entities via flight plans — assemble, launch, watch, wait, follow-up, complete. Background watcher injects landing messages into session.
    location: ~/.koad-io/harness/extensions/koad-io/dispatch/
  - name: channel-communication
    blurb: SPEC-154/156 inter-agent channel tools — wait_for_cue, raise_hand, channel_leave, channel_state_read, channel_cue_deliver, channel_broadcast, channel_wait_for_next_turn, channel_wait_for_state_change
    location: ~/.koad-io/harness/extensions/koad-io/channels/
  - name: question-queue
    blurb: Daemon-backed question system (SPEC-165) — ask_question, wait_for_answer, answer_question. Long-polling with progress notifications.
    location: ~/.koad-io/harness/extensions/koad-io/questions.ts
  - name: conversation-stream
    blurb: DDP emission events (flight landings, errors, messages, YouTube chat) injected as system messages mid-session — live situational awareness without polling
    location: ~/.koad-io/harness/extensions/koad-io/stream.ts
  - name: live-prompt-streaming
    blurb: Entity typing streamed to daemon → storefront in real time for observability
    location: ~/.koad-io/harness/extensions/koad-io/live-prompt.ts
  - name: kingdom-search
    blurb: Waterfall search tool — text (grep), where (frontmatter query), related (constellation discovery), stale (forgotten work), atlas (dashboard grouped by status)
    location: ~/.koad-io/harness/extensions/koad-io/search.ts
  - name: kingdom-status
    blurb: Operational pulse tool — daemon health, active flights, recent emissions, sessions
    location: ~/.koad-io/harness/extensions/koad-io/status.ts
  - name: music-control
    blurb: Groove Basin music control via storefront proxy — skip, queue, now, play, pause. Now-playing displayed in footer.
    location: ~/.koad-io/harness/extensions/koad-io/music.ts
  - name: koad-io-command-cascade
    blurb: Typed gateway to 50+ framework commands (announce, message, tickle, pin, session, emit, conversation, git, build, publish, etc.) — full env cascade + hooks + emission audit trail
    location: ~/.koad-io/harness/extensions/koad-io/koad-io-tool.ts
  - name: bond-gate-permissions
    blurb: Tool-call gate resolved from trust bonds on disk or env vars — bonded mode, env-var mode, bypass mode. Scoped read/write/exec paths per bond type.
    location: ~/.koad-io/harness/extensions/koad-io-bond-gate.ts
  - name: kingdom-dashboard
    blurb: Interactive TUI overlay (/kingdom) — flights, bonds, health tabs with DDP live updates. Navigate with keyboard.
    location: ~/.koad-io/harness/extensions/koad-io/kingdom/
  - name: identity-footer
    blurb: Rich footer rendering entity identity, token stats, cost, context usage, model, thinking level, kingdom health indicators, now-playing, and last emission
    location: ~/.koad-io/harness/extensions/koad-io/identity/
  - name: lifecycle-hooks
    blurb: koad-io-hooks bridges pi lifecycle events to kingdom bash hooks — session_start → standing-watchers + session-harvest, input → prompt-awareness injection
    location: ~/.koad-io/harness/extensions/koad-io-hooks/index.ts
  - name: session-auto-naming
    blurb: First user prompt becomes session display name — cleans prefixes, collapses whitespace, truncates at word boundary, capitalizes
    location: ~/.koad-io/harness/extensions/koad-io/identity/telemetry.ts
  - name: session-flush
    blurb: Every 30s, session state written to daemon as JSON snapshot — cost, tokens, context, model, thinking level, kingdom health, uptime
    location: ~/.koad-io/harness/extensions/koad-io/identity/telemetry.ts
  - name: health-polling
    blurb: HTTP health checks against daemon + control-tower every 10s via .well-known/koad-io.json — footer status indicators (●/◐/○)
    location: ~/.koad-io/harness/extensions/koad-io/identity/telemetry.ts
  - name: daemon-injection
    blurb: Daemon health (status, uptime, flight/emission/session counts) spliced into system prompt at startup via HTTP health endpoint
    location: ~/.koad-io/harness/startup.sh
  - name: active-flights-injection
    blurb: Entity's control/flight scanner output injected into system prompt at session start
    location: ~/.koad-io/harness/startup.sh
  - name: bookmarked-questions-injection
    blurb: Entity's control/q scanner output injected into system prompt at session start
    location: ~/.koad-io/harness/startup.sh
  - name: tickler-injection
    blurb: Pending tickles from entity's tickler/scan spliced into system prompt at session start — colored version to stderr for human, plain to stdout for entity
    location: ~/.koad-io/harness/startup.sh
  - name: inbox-notification
    blurb: Count of unread messages in ~/.forge/messages/<entity>/ surfaced in system prompt — entity told to check inbox, never reads content automatically
    location: ~/.koad-io/harness/startup.sh
  - name: local-koad-io-parties
    blurb: Workspace .koad-io/ folder surfaced at startup — active party-line conversations with session IDs and PRIMER context
    location: ~/.koad-io/harness/startup.sh
  - name: harness-preamble
    blurb: Each harness can ship a PREAMBLE.md describing native tool surface, DDP stream, bond gate, footer, live typing — loaded as Layer 1b between kingdom and entity layers
    location: ~/.koad-io/harness/startup.sh
  - name: plugin-shelf
    blurb: Framework-authored plugins that run inside harness processes (opencode, pi, claude) rendering into harness chrome — separate from commands and hooks
    location: ~/.koad-io/harness/plugins/
  - name: error-logging
    blurb: Tool execution errors captured to in-memory ring buffer (last 100), surfaced in kingdom dashboard errors tab and footer
    location: ~/.koad-io/harness/extensions/koad-io/identity/telemetry.ts
relates-to:
  - ~/.koad-io/PRIMER.md
  - ~/.koad-io/KOAD_IO.md
  - ~/.koad-io/hooks/executed-without-arguments.sh
  - ~/.forge/commands/harness/PRIMER.md
  - ~/.koad-io/plugins/PRIMER.md
status: experimental
experimental-notes:
  - Channel backend still pending — tools return "backend pending" until daemon channel API is built
  - Bond gate resolution from trust bonds on disk — bond format and scope maps still evolving
  - Plugin shelf (pi, claude shelves) are reserved placeholders — only opencode/shell-git active
  - KEK ceremony is Phase 5 stub — real Argon2id wired in Phase 6
  - Music control depends on Groove Basin connector at storefront
  - Question queue backend is daemon-side — API surface stable but implementation young
entities:
  - vulcan
  - juno
last-walked: 2026-05-27
as-of: TBD
---

# ~/.koad-io/harness/ — Entity Context Assembly & Runtime Integration

> The harness is the first breath. Before an entity's first tool call, `startup.sh` has already assembled its identity, its commands, its open flights, and the shape of its world. Once running, pi extensions wire the entity into the live kingdom — DDP streams, dispatch, channels, questions, search, and the command cascade. The entity wakes up knowing what it has.

The harness directory has two jobs: assemble a SYSTEM_PROMPT from layered sources at startup, and maintain a live integration surface (pi extensions) that keeps the entity connected to the kingdom throughout its session.

## Status

**Experimental.** The assembly model is stable and proven across multiple harnesses (opencode, Claude Code, pi). The pi extension surface is actively evolving — channel backend, bond gate resolution, and plugin shelves are all in flight. The core concept of "entities as first-class agents with layered context and live kingdom integration" is settled; specific implementations are still finding their final shape.

## Architecture at a glance

```
┌─ startup.sh ───────────────────────────────────────────────┐
│  Context assembly pipeline (pre-session)                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐ │
│  │ Session  │→│ Git      │→│ Active   │→│ Pre-emptive│ │
│  │ Header   │  │ Status   │  │ Briefs   │  │ Primitives │ │
│  └──────────┘  └──────────┘  └──────────┘  └────────────┘ │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐ │
│  │ Kingdom  │→│ Entity   │→│ Role     │→│ Location   │ │
│  │ Layer    │  │ Identity │  │ Primers  │  │ PRIMER     │ │
│  └──────────┘  └──────────┘  └──────────┘  └────────────┘ │
└────────────────────────────────────────────────────────────┘
                            ↓
┌─ pi extensions (runtime) ──────────────────────────────────┐
│  Live kingdom integration                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐ │
│  │ DDP      │  │ Dispatch │  │ Channels │  │ Questions  │ │
│  │ Stream   │  │ System   │  │ (SPEC154)│  │ (SPEC165)  │ │
│  └──────────┘  └──────────┘  └──────────┘  └────────────┘ │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐ │
│  │ Search   │  │ Status   │  │ Command  │  │ Bond Gate  │ │
│  │ Tool     │  │ Tool     │  │ Cascade  │  │ Permissions│ │
│  └──────────┘  └──────────┘  └──────────┘  └────────────┘ │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────────────┐ │
│  │ Footer   │  │ /kingdom │  │ Lifecycle Hooks          │ │
│  │ Identity │  │ Dashboard│  │ (watchers, harvest,      │ │
│  │          │  │          │  │  awareness injection)     │ │
│  └──────────┘  └──────────┘  └──────────────────────────┘ │
└────────────────────────────────────────────────────────────┘
```

## Files at a glance

| Path | Role |
|------|------|
| `startup.sh` | Core assembly script — reads all context sources, emits SYSTEM_PROMPT to stdout |
| `settings.json` | Pi harness settings — extensions, provider, model, thinking level |
| `PRIMER.md` | This file — harness orientation |
| `default/command.sh` | Kindergarten harness — ensures opencode, assembles, launches |
| `extensions/koad-io/` | Pi extension — DDP, dispatch, channels, questions, search, status, music, footer, dashboard, command cascade |
| `extensions/koad-io-hooks/` | Pi lifecycle hooks — standing-watchers, session-harvest, prompt-awareness |
| `extensions/koad-io-bond-gate.ts` | Tool permission gate — trust bond resolution, scoped read/write/exec paths |
| `primers/<role>/` | Thirteen role-specific context directories with PRIMER.md + emissions.md |
| `plugins/` | Harness extension shelf — plugins that render into harness chrome |
| `patches/` | Third-party tool patches (opencode) |
| `config/` | Framework-level tooling config (opencode.jsonc, model-prices.json) |
| `memory-kek-ceremony.js` | VESTA-SPEC-134 §6.2 KEK passphrase ceremony (Phase 5 stub) |

## The assembly model

`startup.sh` emits a composed SYSTEM_PROMPT in layers. The design philosophy: **the cheapest token is the one the entity never has to generate.** Front-load the map so the entity wakes up already oriented — zero tool calls needed to discover its own structure.

```
Layer 0: Session header     — entity, host, user, date, working directories
         Git status         — entity repo + working dir (if different)
         Active briefs      — non-done briefs from ~/.<entity>/briefs/
         Pre-emptive        — commands, hooks, trust bonds, memories,
           primitives         destinations, skills, daemon status, flights,
                              tickles, inbox, working dir listing, local .koad-io/

--- [end of pre-emptive section] ---

Layer 1:  Kingdom           — ~/.koad-io/KOAD_IO.md, then all ~/.*/KOAD_IO.md
Layer 1b: Harness preamble  — PREAMBLE.md describing native tool surface (DDP, bond gate, etc.)
Layer 2:  Entity identity   — ~/.<entity>/ENTITY.md
Layer 2b: Role primers      — primers/<KOAD_IO_ENTITY_ROLE>/*.md
Layer 4:  Location context  — PRIMER.md from working directory (roaming only)
```

### Pre-emptive primitives (what the entity wakes up knowing)

| Primitive | Source | Description |
|-----------|--------|-------------|
| Commands | `~/.<entity>/commands/`, `~/.koad-io/commands/` | Available shell commands listed by name |
| Hooks | `~/.<entity>/hooks/` | Lifecycle hook scripts available |
| Trust bonds | `~/.<entity>/trust/bonds/` | Bond names (minus `.md` extension) |
| Memories | `~/.<entity>/memories/` | Memory file names |
| Destination memory | `~/.<entity>/destinations/$HOST/<path>/` | Prior-visit notes for current workspace |
| Skills | `~/.<entity>/skills/`, `~/.koad-io/skills/` | Skill directories listed by name |
| Daemon status | HTTP `/.well-known/koad-io.json` | Health, uptime, flight/emission/session counts |
| Active flights | `~/.<entity>/commands/control/flight/` | Scanner output if control layer present |
| Bookmarked questions | `~/.<entity>/commands/control/q/` | Scanner output if control layer present |
| Pending tickles | `~/.<entity>/commands/tickler/scan/` | Due tickles (also echoed to stderr in color) |
| Inbox | `~/.forge/messages/<entity>/` | Count of unread messages (never reads content) |
| Local .koad-io/ | workspace `./.koad-io/` | Active parties with session IDs and PRIMER context |

### Rooted vs. roaming

`KOAD_IO_ROOTED=true` in an entity's `.env` means it always operates from `$ENTITY_DIR`. Rooted entities skip location PRIMER and destination memory — they have a fixed office. Roaming entities work from `$CWD` and get full location context.

### Light mode

For conversation dispatch (where a topic PRIMER replaces the heavy context), pass `--light` or set `KOAD_IO_STARTUP_LIGHT=1`. Light mode emits only: session header, git status, KOAD_IO.md, ENTITY.md, and role primers. All pre-emptive primitives are skipped.

### Variable substitution

All primer and identity files pass through `_subst()` which resolves `$ENTITY`, `$ENTITY_DIR`, `$HOST`, `$USER`, `$DATE`, `$PURPOSE`, `$ROLE` — one source file serves every entity.

## Pi extension surface

Three extensions are loaded when pi starts with this harness:

### 1. koad-io (core integration)

The main extension. Wires the entity into the live kingdom.

**Infrastructure layer:**
- **DDP clients** — Two WebSocket connections (control-tower for flights/bonds/sessions, daemon for emissions/cues/questions). Reactive Minimongo-style collections with typed events.
- **Identity footer** — Rich TUI footer showing entity name, operator, model, thinking level, token/cost stats, context usage, kingdom health indicators (●/◐/○), now-playing music, and last emission. Refreshes every 1s.
- **Telemetry** — Session state flushed to daemon as JSON snapshot every 30s. Health polling every 10s via HTTP `/.well-known/koad-io.json`. Session auto-naming from first user prompt.

**Dispatch system:**
- `dispatch` — Assembles a flight plan and launches a detached harness session on another entity via control-tower. Supports budget ceilings, model tier limits, custom working directories.
- `dispatch_followup` — Send follow-up prompts to running entities (appends to flight's followup.jsonl).
- `dispatch_complete` — Signal mission complete to running entity.
- `wait` — Block until flight lands or entity requests follow-up. Background watcher injects landing messages into the session stream.

**Channel communication (SPEC-154/156):**
- Entity tools: `wait_for_cue`, `raise_hand`, `channel_leave`
- Moderator tools: `channel_state_read`, `channel_cue_deliver`, `channel_broadcast`, `channel_wait_for_next_turn`, `channel_wait_for_state_change`
- Internal: `channel_event_fire`
- Talks to daemon `/api/channels/*` endpoints. **Currently pending** — tools return polite "backend pending" errors until Vulcan builds the daemon channel API.

**Question queue (SPEC-165):**
- `ask_question` — File a question to an operator/entity via daemon queue. Default `wait:true` long-polls (9min timeout) with periodic progress notifications to keep transport warm. `wait:false` for fire-and-forget.
- `wait_for_answer` — Re-enter wait after transport drop. The question stays alive; this just re-enters the poll loop.
- `answer_question` — Submit an answer, unblocking any waiting caller.

**Conversation stream:**
- DDP emission events injected as system messages mid-session: flight landings, errors, inter-entity messages, YouTube chat messages. No polling — rides the same WebSocket as telemetry.

**Live prompt streaming:**
- Entity typing streamed to daemon `/api/prompt/live` for storefront observability. Fire-and-forget HTTP POST per keystroke batch.

**Kingdom tools:**
- `search` — Waterfall search across all kingdom surfaces. Modes: `text` (grep), `where` (frontmatter query, e.g. `status=ready`), `related` (constellation discovery around a file), `stale` (forgotten work > N days), `atlas` (dashboard grouped by status). Wraps `~/.koad-io/bin/search`.
- `status` — Kingdom operational pulse. Sub-commands: daemon, flights, emissions, sessions. Wraps `~/.koad-io/bin/status`.
- `music` — Groove Basin control via storefront proxy. Commands: skip, queue, now, play, pause. Now-playing polled every 5s for footer display.
- `koad-io` — Typed gateway to 50+ framework commands (announce, message, tickle, pin, session, emit, conversation, git, build, publish, configure, probe, etc.). Every invocation goes through the full entity launcher cascade (env, credentials, hooks) with automatic emission audit trail.

**Kingdom dashboard:**
- `/kingdom` command — Interactive TUI overlay with tabs: all, flights, bonds, health, errors. DDP live updates. Keyboard navigable. Shows flight status, bond relationships, daemon/control health with uptime, and error log ring buffer.

### 2. koad-io-hooks (lifecycle bridges)

Bridges pi's extension API to kingdom bash hook scripts:

- **`session_start`** — Writes kingdom lifecycle IDs as custom entry. Registers standing watchers (blocking, 8s timeout). Fires session-harvest (async, detached).
- **`input`** — Runs `prompt-awareness.sh` on every user-originated and RPC input. If output is non-empty, wraps the user text in `<system-reminder>` tags for context injection. Extension re-submissions pass through unchanged.

### 3. koad-io-bond-gate (permissions)

Gates every tool call against entity trust bonds or harness env vars. Resolution order:

1. `KOAD_IO_BOND_GATE_BYPASS=1` → disable gate (dev escape hatch)
2. `~/.<entity>/trust/bonds/*.md` → derive scope from bond capabilities frontmatter
3. `KOAD_IO_ENTITY_SCOPE=<bond-type>` → reuse built-in bond-type scope map
4. `KOAD_IO_HARNESS_{READ,WRITE,EXEC}_PATHS` → custom colon-separated path prefixes
5. No match → empty scope, everything blocked

Four bond types with scoped read/write/exec paths: `authorized-agent`, `authorized-builder`, `authorized-specialist`, `peer`. Blocked calls get `{ block: true, reason }` — tool never executes. **Experimental:** bond format and scope maps still evolving.

## Role primer system

Thirteen role directories under `primers/`, each containing `PRIMER.md` and optionally `emissions.md`:

| Role | Typical entities | Description |
|------|-----------------|-------------|
| `analyst` | — | Data analysis and reporting |
| `auditor` | Argus | Verification, compliance, security review |
| `communicator` | Mercury | Inter-entity communication, announcements |
| `curator` | Vesta | Knowledge organization, memory curation |
| `curriculum` | — | Learning path design, education |
| `designer` | Muse, Iris | Visual design, UX, creative direction |
| `engineer` | Vulcan | Building, coding, infrastructure |
| `healer` | Salus | System health, recovery, wellness |
| `keeper` | — | Record keeping, archival, preservation |
| `orchestrator` | Juno | Coordination, dispatch, channel moderation |
| `producer` | — | Content creation, publishing, media |
| `researcher` | — | Investigation, deep-dive analysis |
| `teacher` | — | Instruction, explanation, mentoring |

Role primers load automatically when `KOAD_IO_ENTITY_ROLE` matches a directory name. Adding a new `.md` file to any role directory makes it load on every session start for that role — no code changes.

## Plugin shelf

Framework-authored plugins that run inside harness processes (not as standalone scripts). Different from commands and hooks:

| Layer | Runs as | Triggered by |
|-------|---------|-------------|
| Commands | Standalone bash | User invocation |
| Hooks | Standalone bash | Lifecycle events |
| Plugins | In-process module | Harness loads at startup |

Currently: `opencode/shell-git` (git-state ribbon in prompt-right slots). `claude/` and `pi/` shelves are reserved placeholders.

## How to add a new role primer

1. Create `~/.koad-io/harness/primers/<role>/PRIMER.md` (and optionally `emissions.md`)
2. Set `KOAD_IO_ENTITY_ROLE=<role>` in the entity's `.env`
3. No changes to `startup.sh` needed — it discovers all `.md` files in the role directory automatically
4. Test: launch the entity and inspect the assembled system prompt on stderr via `--light` mode

## How to add a new pi extension

1. Create the extension file in `~/.koad-io/harness/extensions/`
2. Add its path to `settings.json` under `extensions`
3. The extension receives the pi `ExtensionAPI` — register tools, commands, event handlers, UI components
4. Extensions can import from sibling modules in `koad-io/` for shared infrastructure (DDP, formatting, ANSI helpers)
5. Restart pi or run `/reload` to pick up changes

## Multi-harness design

The harness is harness-agnostic at the assembly layer — `startup.sh` emits the same SYSTEM_PROMPT regardless of which leaf harness consumes it:

```
startup.sh → SYSTEM_PROMPT
                ↓
    ┌───────────┼───────────┬──────────┐
    ↓           ↓           ↓          ↓
  pi         Claude      opencode    hermez
  (--append- (--append-  (OPENCODE   (future)
   system-    system-    _CONFIG_
   prompt)    prompt)    CONTENT)
```

Each harness adds its own integration surface:
- **pi** — Extensions (this directory), PREAMBLE.md for tool surface description
- **Claude Code** — Hooks, statusLine commands
- **opencode** — Plugins, `opencode.jsonc` config
- **hermez** — Future

---

*Walked 2026-05-27. Thirteen role primers, three pi extensions with 30+ registered tools, DDP live reactivity, dispatch system, channel communication toolkit, question queue, bond gate permissions, and a plugin shelf. Experimental but operational — the assembly model is proven; the pi extension surface is the active frontier.*
