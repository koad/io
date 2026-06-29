# koad:io Ecosystem

> A kingdom operating system where AI entities are first-class citizens with constitutional constraint enforcement at the tool layer, not the prompt layer.

---

## Architecture

```
                      ┌──────────────────────────────────┐
                      │     Dark Passenger (browser)      │
                      │  Chrome MV3 extension — co-presence│
                      │  window.__koad_io__ → SW → daemon │
                      └──────────────┬───────────────────┘
                                     │
              ┌──────────────────────┼──────────────────────┐
              │                      │                      │
              ▼                      ▼                      ▼
┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐
│    Meteor App       │  │      Daemon         │  │   Control Tower     │
│  (kingofalldata.com)│  │  10.10.10.10:28282  │  │  10.10.10.10:28283  │
│                     │  │                     │  │                     │
│  92 forge packages  │  │  Emissions          │  │  Flights            │
│  42 ecoincore pkgs  │  │  Bonds              │  │  Harness sessions   │
│  13 koad-io core    │  │  Entities           │  │  Mission coord      │
│                     │  │  Kingdom index      │  │  Follow-up dispatch │
└─────────────────────┘  └─────────────────────┘  └─────────────────────┘
                                     │
                                     │ DDP WebSocket (live, reactive)
                                     ▼
┌─────────────────────────────────────────────────────────────┐
│                     Entity Layer                             │
│                                                             │
│  ~/.juno/   ~/.vesta/   ~/.sibyl/   ~/.vulcan/   ...        │
│  ├── .env              # ENTITY_DEFAULT_HARNESS, provider    │
│  ├── .credentials      # API keys                           │
│  ├── ENTITY.md         # Identity document                  │
│  ├── commands/         # Entity-specific commands           │
│  ├── hooks/            # Lifecycle hooks                    │
│  ├── trust/bonds/      # Capability grants                  │
│  ├── skills/           # Agent Skills (SKILL.md)            │
│  ├── briefs/           # Active work briefs                 │
│  ├── memories/         # Entity memories                    │
│  └── destinations/     # Per-location visit notes           │
│                                                             │
│                    ┌──────────────┐                         │
│                    │   Harnesses   │                         │
│                    │              │                         │
│                    │  pi          │← default for juno       │
│                    │  opencode    │                         │
│                    │  claude      │                         │
│                    │  hermez      │                         │
│                    │  bash        │                         │
│                    │  zsh         │                         │
│                    └──────┬───────┘                         │
│                           │                                 │
│  ~/.koad-io/harness/      │  pi extension surface          │
│  ├── extension/           │  ~40 TypeScript files           │
│  │   ├── bond-gate/       │  Tool permission enforcement    │
│  │   ├── tools/           │  14 custom LLM tools            │
│  │   ├── kingdom/         │  Interactive dashboard          │
│  │   ├── identity/        │  Live footer + telemetry        │
│  │   ├── ddp.ts           │  DDP WebSocket client           │
│  │   ├── lifecycle.ts     │  Pi event → bash hook bridge    │
│  │   ├── context-budget.ts│  Token window monitoring        │
│  │   └── circuit-breaker.ts│ Provider failure recovery      │
│  ├── startup.sh           │  Context assembly pipeline      │
│  ├── settings.json        │  Pi harness config              │
│  └── PRIMER.md            │  Architecture documentation     │
└─────────────────────────────────────────────────────────────┘
```

---

## Invocation Chain

When you type an entity name with no arguments (e.g. `juno`):

```
$ juno
  │
  ▼
~/.koad-io/bin/juno                        4-line entity launcher
  │   export ENTITY="juno"
  │   export KOAD_IO_VIA_LAUNCHER=1
  │   exec ~/.koad-io/bin/koad-io "$@"
  │
  ▼
~/.koad-io/bin/koad-io                     330-line CLI engine
  │
  │  1. Pre-cascade env sanitization (prevents cross-entity leakage)
  │  2. Saves CWD, strips flags, separates --flags from positionals
  │  3. Env cascade: ~/.koad-io/.env → ~/.<entity>/.env
  │  4. No args → hooks waterfall: entity > CWD > global
  │     → ~/.koad-io/hooks/executed-without-arguments.sh
  │
  ▼
~/.koad-io/hooks/executed-without-arguments.sh
  │   • Sets terminal title, cds to work dir
  │   • Delegates to harness default
  │
  ▼
~/.koad-io/commands/harness/default/command.sh   meta-harness resolver
  │   • Reads ENTITY_DEFAULT_HARNESS from entity .env
  │   • Falls back: ENTITY_* → KOAD_IO_* → hardcoded "opencode"
  │   • Delegates to resolved harness
  │
  ▼
~/.koad-io/commands/harness/pi/command.sh         pi harness launcher
  │   • PI_CODING_AGENT_DIR=~/.koad-io/harness (isolated from normal pi)
  │   • Runs startup.sh → assembles layered SYSTEM_PROMPT
  │   • Launches pi --system-prompt "..." --no-context-files
  │
  ▼
pi process  ←─  extension/index.ts  (bond gate, tools, dashboard, footer, DDP)
```

---

## Command Tree

Commands are resolved by filesystem, not a router. Priority:

```
~/.forge/commands/     >  ~/.koad-io/commands/     (forge wins at equal depth)
~/.<entity>/commands/  >  framework               (entity overrides)
./commands/            >  all                      (project-local always wins)
```

Deeper paths win at equal-or-greater depth. New commands = `mkdir` + `command.sh`.

### Framework Layer (`~/.koad-io/commands/` — 19 commands)

| Command | Purpose |
|---------|---------|
| `harness/` | 13 sub-harnesses: pi, opencode, claude, hermez, bash, zsh, default |
| `identity/` | Entity identity management |
| `kingdom/` | Kingdom-level operations |
| `init/`, `install/` | Initialization, package installation |
| `generate/`, `build/`, `deploy/`, `upload/` | Build and deployment pipeline |
| `test/`, `assert/` | Testing and assertions |
| `start/`, `stop/`, `restart/`, `upstart/` | Service lifecycle |
| `gestate/` | Gestation/bootstrap |
| `feedback/` | Feedback collection |

### Kingdom Business Layer (`~/.forge/commands/` — 56 commands, git-tracked)

**Entity Coordination:** `dispatch`, `flight`, `control`, `session`, `wait`, `conversation`
**Communication:** `announce`, `message`, `tickle`, `tickler`, `respond`, `inbox`, `pin`
**Identity & Trust:** `entity`, `profile`, `roles`, `outfit`, `invite`, `sign`, `trust-bond-viewer`
**Knowledge:** `brief`, `archive`, `browse`, `recon`, `probe`, `inspect`
**Infrastructure:** `emit`, `drift`, `drive-chain`, `heartbeat`, `portal`, `spawn`, `shell`, `console`
**Work:** `kanban`, `obligation`, `surface`, `commit`, `channel`
**Other:** `play`, `think`, `shot`, `publish`, `rebuild`, `status` (17 sub-commands), `usage`, `configure`, `io`, `kadira`, `party`, `test`, `feedback`, `git`

---

## Package Ecosystem (Meteor.js monorepo)

```
~/.koad-io/packages/     (13 packages)   Framework core
~/.forge/packages/       (92 packages)   Kingdom business layer
~/.ecoincore/packages/   (42 packages)   Crypto-economic layer
```

### Framework Core (`~/.koad-io/packages/`)

`core`, `router`, `session`, `accounts`, `entities`, `templating`, `workers`, `logger`, `head-js`, `koad-io-merkle-tree`, `koad-io`

### Kingdom Business Layer (`~/.forge/packages/` — 92 packages)

| Domain | Packages |
|--------|----------|
| **Bridge & Telemetry** | `koad-io-bridge`, `koad-io-flight-deck`, `koad-io-telemetry-core/agent` |
| **Dashboards** (20+) | access-control, access-points, devices, discord, domains, errors, events, exchange-rates, exchange-trades, services, sessions, suppositories, telephone, users, worker-processes |
| **Identity & Trust** | `sovereign-profiles`, `koad-io-kingdom-sigchain`, `koad-io-saltpack`, `koad-io-pgp-identify`, `koad-io-permissionary`, `koad-io-invitations`, `koad-io-dance-hall` |
| **Collaboration** | `koad-io-comments`, `koad-io-spaces`, `koad-io-social-stream`, `koad-io-chat-ingest`, `koad-io-commitments` |
| **Content** | `koad-io-file-manager`, `koad-io-repo-viewer`, `io-atlas-viewer` (3D force-graph), `koad-io-oembed`, `koad-io-workbook` |
| **Infrastructure** | `harness`, `daemon-api`, `lighthouse`, `koad-io-drive-chain`, `koad-io-namespace`, `navigation`, `theme-engine`, `throne` |
| **IPFS** | `ipfs-client`, `koad-io-ipfs-pinning` |
| **UI** | `brand-components`, `kingdom-live-overlays`, `profile-shell`, `koad-io-ui-extras`, `koad-io-config-editor`, `koad-io-disclosure-dashboard` |
| **Other** | `kingofalldata-game`, `playback-machine`, `koad-io-badgers`, `koad-io-benchmarks`, `koad-io-notifications`, `koad-io-profiler`, `koad-io-scoring-indexer`, `search`, `session-history`, `koad-io-becoming`, `koad-io-compass`, `koad-io-insights`, `activity-stream`, `koad-io-anchoring/engine`, `koad-io-briefs-resources`, `koad-io-goals-projects-resources`, `koad-io-offerings`, `koad-io-resource-factories`, `koad-io-session-annotations`, `koad-io-social-stream`, `koad-io-well-known` |

### Crypto-Economic Layer (`~/.ecoincore/packages/` — 42 packages)

| Domain | Packages |
|--------|----------|
| **AtomicDEX** | `atomicdex`, `atomicdex-orderbooks`, `atomicdex-orders`, `atomicdex-swaps` + viewers |
| **Chainpack** | `chainpack`, `chainpack-viewer`, `chainpack-editor`, `chainpack-broadcast-watcher` |
| **UTXO** | `utxo`, `utxo-ingest-api` |
| **Electrum** | `electrum`, `electrum-viewer`, `electrum-worker` |
| **Wallet** | `wallet`, `wallet-routing` |
| **Exchange** | `exchange`, `exchange-trades`, `price-matrix` |
| **Trust & Identity** | `trust-bond-onchain`, `sigchain-discovery`, `cross-chain-provenance`, `membership` |
| **Infrastructure** | `daemon-manager`, `daemon-viewer`, `deployments-dashboard`, `ecoincore` |
| **Other** | `stake`, `charts`, `explorer-components`, `insiders-gate`, `notifications`, `p2aux`, `rosetta`, `settings`, `web3`, `omni-layer`, `interface` |

---

## Pi Harness Extension Surface

When an entity launches via the pi harness, ~40 TypeScript files register a rich extension surface:

### Custom Tools

| Category | Tools |
|----------|-------|
| **Dispatch** | `dispatch`, `wait`, `dispatch_followup`, `dispatch_complete` — detached entity launches via control-tower |
| **Questions** | `ask_question`, `wait_for_answer`, `answer_question` — batphone to operators/entities |
| **Channels** | `wait_for_cue`, `raise_hand`, `channel_leave`, `channel_state_read`, `channel_cue_deliver`, `channel_broadcast`, `channel_wait_for_next_turn`, `channel_wait_for_state_change`, `channel_event_fire` |
| **Kingdom Awareness** | `search` (waterfall grep/frontmatter/atlas), `status` (daemon pulse) |
| **Body Motions** | `surface_now`, `intake_digest`, `obligation_*`, `brief_issue` |
| **Kingdom Query** | `mission_query`, `session_query`, `emission_query`, `bond_query`, `question_query`, `entity_query` |
| **Cascade** | `koad-io` passthrough (announce, message, tickle, pin, emit, git, session) |
| **File Ops** | `mkdir`, `cp`, `mv`, `rm`, `chmod`, `append` |
| **Music** | Groove Basin REST control (`/skip`, `/queue`, `/pause`, `/play`) |
| **Model Picker** | `/model` overlay with pricing, context windows, filtering, and provider grouping |
| **Sin** | Recursive grep in one explicit directory |

Default active-tool policy: `ls` stays, `grep`/`find` removed (replaced by `search`/`sin`).

### Bond Gate (Tool Permission Enforcement)

Every `read`, `write`, `edit`, `bash` call is gated against trust bonds on disk. The gate:

- Parses bond frontmatter → derives read/write/exec/blocked scope
- Blocks tools outside scope **before the LLM sees anything**
- Blocks dangerous bash patterns (`sudo`, `chmod 777`, recursive `rm` on root paths)
- Scrubs secrets from tool results (API keys, tokens, passwords)
- Two modes: **entity mode** (trust bonds on disk) and **visitor mode** (access scope for SDK/RPC)

This is constitutional enforcement — not prompt-based. Prompts can be socially engineered; the gate cannot.

### DDP Live Streams

Two WebSocket connections (Meteor DDP protocol) inject kingdom events as non-turn-triggering system messages:

| Source | Port | Events |
|--------|------|--------|
| Daemon | 28282 | Emissions, bonds, entities, kingdom index |
| Control Tower | 28283 | Flights, harness sessions, mission coordination |

Events appear mid-conversation: `✓ sibyl landed ⟐ flightId (12s)`, `⚠ entity error`, `📨 entity: message body`, `📺 viewer: chat message`.

### Live Footer (3-5 rows)

```
koad on wonderland with juno ~/…  🐏 19GiB/31GiB        dsv4-pro · high
  github.com/koad/io 🌱main ●40 🗑️1 🌱1                   ↑12k ↓8k $0.023 c45%
  25:06:13:23:45:01 ◊ koad:io                             t12 d● c●
```

Rows: identity → git+token stats → timestamp+kingdom health → last emission (60s fade) → now playing.

### Kingdom Dashboard (`/kingdom` command)

Interactive TUI overlay — tabs: all, flights, bonds, scope, health, errors. DDP-live updates, arrow-key navigation, right-center panel.

### Lifecycle Hook Bridge

Pi events are bridged to bash hooks:
- `session_start` → `standing-watchers.sh` + `session-harvest.sh`
- `before_agent_start` → `prompt-awareness.sh` (injects inbox awareness)
- `agent_start/end` → telemetry emissions
- `tool_result` → flight artifact recording to daemon

### Additional Infrastructure

- **Context Budget** — monitors token window, warns and auto-compacts under pressure
- **Circuit Breaker** — detects provider failures and recovers
- **Live Typing** — keystrokes stream to daemon → storefront at `kingofalldata.com/live`

---

## Context Assembly Pipeline (`startup.sh`)

Before the agent's first tool call, `startup.sh` assembles a layered system prompt:

```
Session Context (entity, host, user, cwd, date)
  │
  ├── Git Status (entity repo + working dir)
  │
  ├── Active Briefs (non-completed briefs from ~/.<entity>/briefs/)
  │
  ├── Pre-emptive Primitives
  │   ├── Commands (entity + framework)
  │   ├── Hooks
  │   ├── Trust Bonds
  │   ├── Memories
  │   ├── Destination Memory (prior visit notes for this location)
  │   └── Skills (entity + framework)
  │
  ├── Daemon Status (health, uptime, flight/emission/session counts)
  │
  ├── Active Flights (from control-tower scanner)
  ├── Pending Questions (from control-tower scanner)
  ├── Pending Tickles (from tickler scanner)
  ├── Message Inbox (count only, from ~/.forge/messages/<entity>/)
  │
  ├── Working Directory listing (roaming entities)
  ├── Local .koad-io/ footprint (parties, breadcrumbs)
  │
  ├── Layer 1: Kingdom (~/.koad-io/KOAD_IO.md + any ~/.*/KOAD_IO.md)
  ├── Layer 1b: Harness PREAMBLE (tool surface description)
  ├── Layer 2: Entity (~/.<entity>/ENTITY.md)
  ├── Layer 2b: Role Primer (~/.koad-io/harness/primers/<role>/PRIMER.md)
  └── Layer 4: Location PRIMER.md (roaming entities only)
```

---

## Dark Passenger (Browser Extension)

`~/.forge/passenger/` — Chrome MV3 extension. The kingdom's browser-side presence.

**Three tiers:**
| Tier | Connection | Use |
|------|-----------|-----|
| 1 | ZeroTier → daemon (10.10.10.10:28282) | Full sovereignty |
| 2 | Public lighthouse (wonderland.koad.sh) | Remote access |
| 3 | localStorage fallback | Offline |

**Runtime components:**
| Component | Role |
|-----------|------|
| Service worker | Proxy + auth. Probes tiers, holds MCP session token, routes requests |
| Content scripts | `window.__koad_io__` API on every URL + isolated-world bridge |
| Side panel + popup | Side panel = daemon workspace (iframe). Popup = heads-up display |

The extension **never holds private keys**. Signing and identity always delegate to the daemon.

---

## Design Principles

1. **Entities are filesystem citizens.** `~/.<entity>/` — .env, commands, hooks, trust bonds, memories. No database, no registry.

2. **Commands are directories, not routes.** Adding a command is `mkdir` + `command.sh`. Resolution is filesystem depth-priority, not a switch statement.

3. **Enforcement is at the gate, not the prompt.** The bond gate blocks tools before the LLM sees anything. Prompts can be socially engineered; the gate cannot.

4. **The cheapest token is one never generated.** `startup.sh` front-loads the map so entities wake up oriented with zero tool calls.

5. **Harnesses are interchangeable.** The same constitution, hooks, and kingdom state work across pi, opencode, claude, or hermez.

6. **Cross-entity isolation is surgical.** The env sanitization in `koad-io` prevents leakage when one entity dispatches another.

7. **The filesystem is the API.** Packages, commands, entities, hooks — all resolved by directory presence. No config wiring needed.

---

## Key Paths

| Path | Role |
|------|------|
| `~/.koad-io/bin/koad-io` | CLI engine — env cascade, hook resolution, command dispatch |
| `~/.koad-io/bin/<entity>` | Entity launcher — 4-line wrapper setting ENTITY |
| `~/.koad-io/commands/` | Framework command tree (19 commands) |
| `~/.forge/commands/` | Kingdom business command tree (56 commands, git) |
| `~/.koad-io/packages/` | Framework core Meteor packages (13) |
| `~/.forge/packages/` | Kingdom business Meteor packages (92) |
| `~/.ecoincore/packages/` | Crypto-economic Meteor packages (42) |
| `~/.forge/passenger/` | Dark Passenger Chrome MV3 extension |
| `~/.koad-io/harness/` | Pi harness — extension, startup.sh, settings, primers |
| `~/.koad-io/hooks/` | Global hooks (executed-without-arguments, etc.) |
| `~/.koad-io/harness/primers/` | 13 role-specific context directories |
| `~/.koad-io/.env` | Kingdom-level environment defaults |
| `~/.<entity>/.env` | Entity environment (ENTITY_DEFAULT_HARNESS, provider, model) |
| `~/.<entity>/ENTITY.md` | Entity identity document |
| `~/.<entity>/trust/bonds/` | Capability grants between entities |
| `~/.koad-io/KOAD_IO.md` | Kingdom constitution |
