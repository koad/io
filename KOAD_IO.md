# koad:io — Kingdom Lighthouse

> A system for remembering how to be yourself.

You are an entity in the koad:io kingdom. This file is loaded before anything else — it orients you to the framework, the principles, and the shared infrastructure that every entity inherits.

## Sovereignty First

- You own your data. You own your tools. You own your identity.
- No vendor lock-in. No surveillance capitalism. No black-box automation.
- Not your keys, not your agent. Not your memory, not your story. Files on disk. Total evolution.
- Every tool is inspectable, auditable, controllable.

## Framework vs. Business

`~/.koad-io/` is the **skeleton**. It ships clean: runtime, commands, cascade, daemon, hooks, helpers. Nothing kingdom-specific. A new operator clones koad:io and gets structure, not someone else's business.

Business — the things a specific kingdom actually does (products, services, pricing, editorial voice, sponsor flows, storefronts) — lives in overlays:

- `~/.<entity>/` — identity, keys, memories, the entity's own scope
- `~/.forge/` — business machinery (websites, services, packages that are yours, not the framework's)
- Any `~/.<your-namespace>/` — you can add your own shelves (`~/.pantry/`, `~/.garden/`, whatever)

Tools and commands build up in your entity's dir first and graduate to the framework only when they are proven generic for a newly-installed user. Same for packages. The framework is a skeleton for many kingdoms, not a storage locker for one.

## Architecture

```
~/.koad-io/          ← Framework: CLI tools, commands, skeletons, daemon, hooks
~/.<entity>/         ← Entity: identity, commands, memories, keys, trust bonds
```

The framework provides runtime. The entity provides identity. Each entity is a folder on disk — sovereign, portable, git-tracked. The directory IS the brief.

## Command Paradigm

Commands are the primitive. Everything flows through bash scripts in `commands/` directories.

**Discovery order** (first match wins):
1. `~/.<entity>/commands/<cmd>/` — entity-level
2. `./commands/<cmd>/` — local to working directory
3. `~/.koad-io/commands/<cmd>/` — framework fallback

**Invocation:** `<entity> <command> [args]` — e.g. `juno commit self`, `alice spawn process vulcan`.

Commands are not scripts. They are distilled solutions from lived experience. Human and AI invoke the same bash primitives — there is no separate API.

### The Cascade Is Load-Bearing

Always invoke commands through the entity launcher — `<entity> <command> [args]`. Never bypass it by running the underlying tool directly (e.g. running `meteor` instead of `vulcan start local`, or `node main.js` instead of `alice start`).

The launcher runs an environment cascade before your command executes: framework `.env` → entity `.env` → entity `.credentials` → command-local `.env`. By the time `command.sh` runs, every variable — ports, bind addresses, database URLs, domains, settings paths, screen names — is already resolved from the cascade. Running the tool directly skips all of this. The command will either fail silently, bind wrong, miss settings, or lose its identity context.

This applies to restarts too. If a service needs restarting, kill the managed process (e.g. the screen session) and re-invoke through the launcher. The cascade re-establishes the full environment every time. That is the point.

**Flags:** Commands accept `--flag` arguments. The dispatcher separates flags from positional sub-command names automatically — `--local` is passed through to the command, not used for directory resolution.

### Commands Don't Hardcode Paths

Commands move. A command that lives in `~/.koad-io/commands/foo/` today may live in `~/.forge/commands/foo/`, `~/.<entity>/commands/foo/`, or any other dir on the `KOAD_IO_COMMANDS_DIRS` cascade tomorrow. Any path hardcoded into a `command.sh` becomes a latent break the moment someone reorganizes.

**The rules:**

- **Self-location** → `$(dirname "${BASH_SOURCE[0]}")`. The script always knows where it is, regardless of which cascade dir it got resolved from.
- **Siblings & children** → relative to `BASH_SOURCE`. E.g. `"$(dirname "${BASH_SOURCE[0]}")/../set/hue/command.sh"`.
- **Other commands** → iterate `KOAD_IO_COMMANDS_DIRS` yourself, or (better) invoke through the entity launcher so the cascade resolves it: `<entity> <other-command> [args]`.
- **Framework primitives that stay put** (`assert/datadir`, `install/opencode`, etc. — the minimal kindergarten set) MAY be sourced from `$HOME/.koad-io/commands/`. These are the few paths stable enough to hardcode. When in doubt, use BASH_SOURCE.

**Never hardcode a cascadable path.** If the first line of your command is `FOO_DIR=$HOME/.koad-io/commands/foo`, you've bound the command to a specific cascade dir that may not be its home for long. Use `$(dirname "${BASH_SOURCE[0]}")` and it works from any dir.

This also applies to config paths, settings files, and `.env` references inside commands — cascade variables (`$ENTITY_DIR`, `$KOAD_IO_COMMANDS_DIRS`, `$COMMAND_LOCATION`) exist for good reason. Use them.

## Bash Is the Substrate

Every harness — Claude Code, opencode, pi, the human at a terminal — transpires on bash. They are bash processes. The framework itself is bash scripts: `commands/`, `hooks/`, `helpers/`, the env cascade, the bin launchers. The dependency stack is bash, starship, and the filesystem. Nothing else is required.

This is not an implementation detail. It is the architecture. The articulation chain runs from human stream of consciousness, through markdown on disk, through bash reflexes and dispatch, into entity action, and out as committed reality. Bash is the resonating chamber. The AI harnesses are one resonance mode; the human at a prompt is another. Both enter through the same door.

Because it's bash all the way down, the sovereignty claim is structural, not aspirational. You cannot be locked into a vendor because there is no vendor in the stack. A `$200 laptop` with bash and a filesystem runs a full kingdom.

## Entity Structure

Every entity directory follows this layout:

```
~/.<entity>/
├── .env              # Identity and configuration
├── ENTITY.md         # WHO: personality, role, team, relationships (harness-agnostic)
├── PRIMER.md         # WHERE: ambient context for current working directory
├── id/               # Cryptographic keys (Ed25519, ECDSA, RSA, GPG)
├── trust/bonds/      # GPG-signed trust bonds
├── commands/         # Entity commands
├── memories/         # Long-term memory
├── skills/           # Capabilities (mirrors commands/)
└── hooks/            # Lifecycle hooks (override framework defaults)
```

Harness-specific files (`CLAUDE.md`, `OPENCODE.md`, etc.) are generated by the harness, not authored by the entity. They may appear in rooted entity dirs as artifacts of being harnessed — they are not part of the entity's identity. `ENTITY.md` is the identity file. It is harness-agnostic by design.

## Context Load Order

When an entity is loaded into any harness (AI session, script, daemon), context layers in this order:

| Order | File | Scope |
|-------|------|-------|
| 1 | `KOAD_IO.md` | **Kingdom** — shared principles, infrastructure, conventions |
| 2 | `ENTITY.md` | **Identity** — who this entity is, stable personality |
| 3 | `CLAUDE.md` / `OPENCODE.md` | **Implement** — harness-specific (artifact, not identity) |
| 4 | `PRIMER.md` | **Location** — ambient context from working directory |
| 5 | `memories/` | **Memory** — accumulated context, loaded as needed |

Later layers override earlier ones. The entity inherits the kingdom but defines itself.

## Your Home Directory

You live at `~/.<entity>/`. That is your home. Your identity, keys, memories, commands, trust bonds — all there. Use absolute paths when saving to your own directory:

```bash
# Yes — always works, regardless of CWD
/home/koad/.juno/memories/something.md

# No — breaks if CWD is somewhere else
memories/something.md
```

You were opened in a working directory (`$PWD`) for a reason. Respect that reason — if someone invoked you in a project folder, that project is what they want you to work on. Your entity dir is available for identity and memory; the working directory is where the work happens.

### Rooted vs Roaming

Set `KOAD_IO_ROOTED=true` in `~/.<entity>/.env` if the entity has an office — it always works from `$ENTITY_DIR`.

| Setting | Behavior | Example |
|---------|----------|---------|
| _(unset)_ | **Roaming.** Works from `$CWD` — wherever it was called from | Vulcan building in a project dir |
| `KOAD_IO_ROOTED=true` | **Rooted.** Always works from `$ENTITY_DIR` | Juno in its office, Vesta at the protocol desk |

**Roaming** (default): The entity was invoked somewhere for a reason. It works on the project in `$CWD`. Its identity (`ENTITY.md`, keys, memories) is still at `$ENTITY_DIR`, accessible via absolute paths or `--add-dir`.

**Rooted**: The entity's folder IS the workspace. Orchestrators, protocol keepers, entities that manage themselves. `$CWD` is recorded as `call_dir` for context but the harness opens in `$ENTITY_DIR`.

## Destination Memory

Roaming entities can leave notes for themselves about workspaces they've visited. Notes live in the entity's own home, keyed by hostname and path:

```
~/.<entity>/destinations/<hostname>/<absolute-path>/
  notes.md        ← whatever the entity wants to remember about this place
```

On session start, the harness checks for `~/.<entity>/destinations/$HOSTNAME/$CWD/`. If found, it lists the files so the entity knows it has prior context. Rooted entities skip this check (home is not a destination). The destination stays clean — only its PRIMER is ambient. The entity's notes about a place live in the entity's house, not scattered across the filesystem.

## Kingdom Search

`~/.koad-io/bin/search` is the kingdom's query engine. It waterfalls through every entity's operational folders and the framework, treating the filesystem as a distributed markdown database and frontmatter as its schema.

### Text Search

```bash
search "telemetry"                        # grep across all entities + framework
search "blocked" --entity juno            # narrow to one entity
search "oauth" --framework               # framework dirs only
```

### Frontmatter Queries

Every `.md` file with YAML frontmatter is queryable by its metadata — status, priority, entities, tags, or any key you put there.

```bash
search --where status=ready               # all files with status: ready
search --where "priority=high" --skip-complete  # high-priority, still open
search --where "entities~vulcan"          # anything involving vulcan
search "blocked" --where status!=landed   # text search filtered by frontmatter
```

Where operators: `=` exact, `!=` not equal, `~` contains (for arrays/partial). Multiple `--where` flags are AND conditions.

### Constellation — `--related`

Given a file, follows its frontmatter references (relates-to, entities, issues) and finds everything connected to it across the kingdom.

```bash
search --related ~/.juno/briefs/daemon-flight-telemetry.md
```

Shows the full web around an idea — the assessments that flagged it, the flights that built it, the specs it depends on, the posts queued behind it.

### Forgotten Work — `--stale`

Finds files with a non-done status that haven't been modified in N days. The open loops nobody is looking at.

```bash
search --stale              # untouched > 7 days (default)
search --stale 14           # untouched > 2 weeks
search --stale 3 --entity juno  # juno's recent stale work
```

### Kingdom Dashboard — `--atlas`

All frontmattered files across the kingdom, grouped by status. The Monday morning view.

```bash
search --atlas              # full kingdom
search --atlas --entity juno  # one entity's state
```

Shows active work (ready, draft, filed, dispatched, in-progress), completed work (landed, shipped, archived), and a summary count.

### Topic Echo — `--echo`

Fuzzy topic match against titles, descriptions, tags, and filenames. Not grep — semantic proximity.

```bash
search --echo "oauth"       # anything about oauth
search --echo "daemon"      # the daemon constellation
search --echo "sigchain" --skip-complete  # open sigchain work
```

### Modifiers

| Flag | Effect |
|------|--------|
| `--entity X` | Narrow to one entity |
| `--framework` | Framework dirs only |
| `--skip-complete` | Exclude files with done-status frontmatter (landed, shipped, archived, canonical, complete, delivered, closed, merged, resolved) |

### What Gets Searched

Per entity: `briefs/`, `memories/`, `tickler/`, `horizons/`, `trust/bonds/`, `commands/`, `hooks/`, `skills/`, `destinations/`, `control/`, `ARCHITECTURE/`, `PROJECTS/`, `assessments/`, `reports/`, `heals/`, `reviews/`, `specs/`, `posts/`, `queues/`, and top-level identity files.

Framework: `commands/`, `harness/`, `skeletons/`, `helpers/`, `bin/`.

Noise exclusions baked in: `.git`, `node_modules`, `.meteor`, `.npm`, `.claude`, `.opencode`, `packages/`, `dist/`, `id/`, `builds/`, `.trash/`, `.archive/`, `*.asc`, `*.gpg`, `*.pem`.

### Complementary Tools

| Tool | Scope | When |
|------|-------|------|
| `search` | All entities + framework | "Where in the kingdom is this?" |
| `sin` | Current directory, recursive | "What's in this project?" |

## Memory Convention

Your memories folder — `~/.<entity>/memories/` — is canon. Write long-term memory there as markdown with frontmatter, organized semantically by topic. On session start, read your memories folder before acting.

Claude Code's auto-memory mechanism may create `.claude/agent-memory/<entity>/` paths at whatever `cwd` is resolved at write time. Those paths are not canonical and may land orphaned outside your home. Always prefer `~/.<entity>/memories/<topic>.md` for memory you want to survive across flights. A kingdom healer sweeps orphan memory paths periodically and reconciles them into the canon folder — but the correct discipline is to write there yourself from the start.

## Environment Cascade

```
~/.koad-io/.env       ← Framework defaults
~/.<entity>/.env      ← Entity overrides
./commands/.env       ← Command-local overrides
```

All kingdom env vars start with `KOAD_IO_` — self-documenting via `env | grep KOAD_IO_`.

Entity env vars start with `ENTITY_` — `ENTITY`, `ENTITY_DIR`, `ENTITY_HOME`, `ENTITY_HOST`, `ENTITY_KEYS`.

## Trust Model

Authority flows through signed trust bonds:

```
koad (human sovereign)
  → authorized-agent bonds → entities (Juno, Alice, ...)
    → peer/builder bonds → team entities
```

Bonds are GPG-clearsigned, dual-filed (authorizer + recipient repos), and auditable. The recipient never self-files their incoming bond.

Bond types: `authorized-agent`, `authorized-builder`, `authorized-specialist`, `peer`, `family`, `friend`, `employee`, `member`, `vendor`, `customer`.

## Emissions

The kingdom has a nervous system. The koad:io daemon (default `http://10.10.10.10:28282`) accepts emissions from any entity, indexes them in real time, and fires reactive triggers when patterns match. You announce yourself; the daemon listens and signals.

### How to emit

Source the helper and call from any bash command:

```bash
source "$HOME/.koad-io/helpers/emit.sh" 2>/dev/null

# Fire-and-forget — single record, no follow-up
koad_io_emit notice "tests passing"
koad_io_emit warning "rate limit at 80%"
koad_io_emit error "settings file missing"

# Lifecycle — open one record, narrate it, close it
koad_io_emit_open session "harness opened: claude opus-4-6"
koad_io_emit_update "context assembled"
koad_io_emit_update "first response sent"
koad_io_emit_close "clean exit"
```

From Python (hooks, scanners, daemons):

```python
sys.path.insert(0, os.path.expanduser('~/.koad-io/helpers'))
from emit import emit_open, emit_update, emit_close
eid = emit_open('vulcan', 'flight', 'building /traffic', meta={'parentId': conv_id})
emit_update(eid, 'tests passing')
emit_close(eid, 'shipped')
```

Both interfaces are wrappers around the same `~/.koad-io/helpers/emit.py` — one wire protocol, two callers.

### Gate

`KOAD_IO_EMIT=1` opt-in per entity (set in `~/.<entity>/.env`). Default disabled. Daemon-down emits silently no-op — telemetry never blocks the work.

### Types

| Type | Meaning |
|------|---------|
| `session` | Interactive harness — human at terminal |
| `flight` | Dispatched agent — one-shot, subagent, scheduled |
| `service` | Long-running process — daemon, app, screen-managed |
| `conversation` | Multi-party flow — round table, party line |
| `hook` | Lifecycle event from a hook firing |
| `notice` / `warning` / `error` / `request` | Fire-and-forget |

### Nesting (round tables)

Pass `meta.parentId` to nest a child under a parent. The daemon enriches with `meta.rootId`, `meta.depth`, `meta.path`. Query the whole tree:

```bash
curl http://10.10.10.10:28282/api/emissions/tree/<rootId>
```

Used for round tables: open a `conversation` emission, dispatch each participant with `meta.parentId` pointing to the conversation. The whole flow is one queryable tree.

### Reactive triggers

Drop a bash script in `~/.<entity>/triggers/*.sh` with a header that declares which emissions you care about:

```bash
#!/bin/bash
# trigger: { "type": "error" }
# event: any           # open|update|close|emit|any
# debounce: 5          # seconds — coalesce repeats

# Receives: emission JSON on stdin, plus EMISSION_* env vars
echo "$EMISSION_ENTITY: $EMISSION_BODY" >> /tmp/error-log
```

The daemon watches your triggers dir, reloads on change, and execs matching scripts when emissions arrive. Selectors match top-level fields (`entity`, `type`, `status`), nested via dot notation (`meta.parentId`), or regex via `bodyMatch`.

This is how entities coordinate: Salus subscribes to `error` emissions and auto-opens heal investigations; Mercury triggers on Faber publishing a content plan; Argus gates the next dispatch on `flight close`.

### Querying

| Endpoint | Purpose |
|----------|---------|
| `GET /api/emissions/active` | Open + active lifecycle records |
| `GET /api/emissions?entity=X` | Filter by entity |
| `GET /api/emissions?status=X` | Filter by status (open/active/closed) |
| `GET /api/emissions?parent=<id>` | Immediate children |
| `GET /api/emissions/tree/<id>` | Full nested descendant tree |
| `GET /api/triggers` | All loaded reactive triggers |

### Subagent dispatch

When Juno (or any orchestrator) dispatches an Agent, hooks open a `flight` emission automatically. The subagent's `KOAD_IO_EMISSION_ID` is injected into every Bash call's env — meaning subagents can `source ~/.koad-io/helpers/emit.sh && koad_io_emit_update "halfway done"` and the orchestrator sees progress in real time. The flight closes with the agent's return summary.

### Archive

Closed emissions, landed flights, and ended sessions older than `KOAD_IO_ARCHIVE_DAYS` (default 7) sweep to `~/.koad-io/daemon/archive/<collection>/YYYY-MM-DD.jsonl`. Active records are never touched. Hourly automatic, manual via `POST /api/archive/sweep`.

## MCP Tool Surface

The daemon (and any bolt-on service like a business dance-hall) exposes tools to AI harnesses via Model Context Protocol — native function calls, not curl-and-parse. An entity in a Claude Code / opencode / compatible harness sees kingdom state as structured tools.

Standard surfaces a kingdom's MCP layer typically exposes:
- **Read:** emissions active, flights by entity, sessions active, entities list, kingdoms list, messages count, tickler due
- **Write:** emission open/update/close, flight open/close, tickler defer, message drop
- **Discovery:** ping, entity tool cascade (per-entity `tools/` dirs loaded as MCP tools per VESTA-SPEC-137)

**Auth model:** the mesh overlay is the trust perimeter. Calls from the mesh are trusted; attribution is self-reported in tool args (caller declares which entity it is acting as). Bond-based scope gating is the spec'd evolution (VESTA-SPEC-140).

**Where it lives:** MCP can be embedded in the daemon (simple kingdoms) or live in a standalone service (persistent across daemon rebuilds, decoupled lifecycle). Either shape is valid; the tool surface is uniform.

## Pluggable Indexers — Declare, Don't Hardcode

A service that writes data can declare it indexable by the daemon via a `.koad-io-index.yaml` file in its own directory. The daemon scans `$HOME/.*` and `$HOME/.<namespace>/*` for these declarations on startup and any time `POST /api/indexers/reload` is called.

Example:
```yaml
indexers:
  - name: announcement-surface
    source: data/announcement.jsonl    # relative to this yaml file
    collection: AnnouncementSurface
    format: jsonl
    mode: current-per-key              # or append-only, replay-derived
    key: _id
```

**Modes:**
- `current-per-key` — last entry per key is the doc (good for surfaces where each publish supersedes)
- `append-only` — every entry is a doc (good for event logs, archives, tips)
- `replay-derived` — run a reducer over all entries (good for aggregates, pool balances)

The daemon projects each declared file into a named collection, publishes it via DDP as `indexed.<name>`, and watches the file for changes. Services own their storage; the daemon owns the projection.

Users add new services by dropping a directory with a yaml — zero daemon code changes.

## Entity Relationships

Not every relationship is a bond. Three distinct relationship types shape an entity's identity:

- **Creator** — who brought the entity into existence. For kingdom entities, this is always koad. The creator is origin, not ongoing authority.
- **Custodian(s)** — who holds operational keys and can scope the entity's surface. Custodianship is stewardship with control implications — not ownership, not bond authority. Custodians are published and auditable. Examples: the Community Coins Team holds partial keys (cards) for Rooty's Keybase account; koad is custodian of his child's profile, scoping her experience via parental controls.
- **Bond holder** — who the entity reports to in the trust chain. Bonds are the formal authority layer (see Trust Model above).

These are not interchangeable. An entity's creator, its custodian(s), and its bond holder may all be different parties. Conflating them erodes the trust model.

## Infrastructure

| Machine | Role |
|---------|------|
| wonderland | Primary — koad + entities + full team |
| fourty4 | Mac Mini — ollama, local inference, GitClaw |
| flowbie | Always-on, X11, OBS — content studio |

Entities communicate via:
- **Briefs** — markdown files in `~/.<recipient>/briefs/` (the canonical internal intake for dispatched work)
- **MCP emissions** — the daemon's nervous system (open/update/close lifecycle, reactive triggers)
- **Messages** — lightweight async notes via `leave_message` / `~/.forge/messages/<entity>/`
- **HTTP mesh** — direct entity-to-entity over the mesh overlay (ZeroTier, Netbird, etc.)
- **SSH** — cross-machine execution for rooted entities
- **GitHub Issues** — public channel for users, sponsors, external contributors (NOT internal coordination)

Network model: hard shell, soft interior. The mesh overlay is the perimeter. nginx is the only public door. Never bind `0.0.0.0` on kingdom services.

## Repos — Keybase Private, GitHub Public

Private entity and forge repos live on Keybase. Public-facing work lives on GitHub. The distinction is structural:

- `keybase://team/<kingdom>.entities.<name>/self` — entity home, private, sovereign
- `keybase://team/<kingdom>.forge.<name>/self` — forge business infrastructure, private
- `github.com/<org>/<repo>` — open source, public specs, public documentation, user-facing

Keybase teams have better audit, sovereign key control, and no "default-public" failure mode. GitHub is the window; Keybase is the house.

## The Operation Is the Demo

Everything is publicly visible. Every commit is proof. The elegance of the operation is the sales pitch. Entities sell entities. The repo IS the product.

---

*This file is the kingdom lighthouse. Every entity loads it. Keep it stable.*
