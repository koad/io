<!-- SPDX-License-Identifier: CC0-1.0 -->

# 🧠 koad:io

> A **cognitive externalization system** — think once per idea, encode as a named shard, and never think about the mechanics of it again.

**koad:io** is a sovereign, local-first substrate where cognition lives as files and folders on hardware you control. Every saved command is a remembered solution. Every entity is a role-bound projection of how you work. Every bond is an explicit capability declaration. Every package is a portable component that never needs rewiring.

The system remembers so you don't have to.

---

## The Core Idea

> **Think once per idea → encode as named shard → wire it in → never think about it again.**

koad:io is not a tool collection. It is a **system for embedding memory into code** and shaping your operational environment around your mental model.

Everything in koad:io is a **named shard** at a different scale:

| Shard type | What it is | Example |
|------------|-----------|---------|
| **Commands** | Named operational verbs — remembered procedures | `alice start`, `alice ssh toronto` |
| **Entities** | Role-bound cognitive shards — containers of identity, context, and capability | `alice`, `juno`, `vulcan` |
| **Packages** | Portable application components — composable building blocks | `koad:io-core`, `koad:io-daemon-api` |
| **Bonds** | Signed capability grants — explicit trust declarations | `koad-to-juno-orchestrator.md.asc` |
| **Primers** | Named context shards — orientation documents for agents and humans | `~/.koad-io/PRIMER.md` |
| **Harnesses** | Named execution surfaces — how entities run (pi, claude, opencode) | `harness/pi/`, `harness/opencode/` |
| **Skills** | On-demand capability packages | `~/.koad-io/skills/` |

The apps themselves are **thin shells**. The real system lives in packages:

```
~/.koad-io/packages/     ← framework packages
~/.forge/packages/        ← business packages
~/.ecoincore/packages/    ← domain packages
```

Each package declares its own scope. Each command declares its own contract. Each entity declares its own identity. And the system wires them together automatically through a deterministic cascade.

This means:

- You never have to remember how things get wired together
- An LLM can read a package and understand its purpose
- Each component is auditable, portable, and replaceable
- Adding capability means dropping in a shard, not refactoring an app

---

## Why This Exists

koad:io was born in **2014** — long before AI agents, before "coding assistants," before the current wave of synthetic intelligence. But the game it plays started in **1997** — when social networks and public statements started piling up, and a choice emerged:

> **Publish to the public surface, or maintain your own rights.**

Rights are responsibilities. And the responsibility of sovereignty is this: everything you put on a platform you don't control becomes permanent, searchable, and weaponizable. Not by you. By whoever owns the database.

koad:io rejects that at the foundation. Instead:

- The **filesystem is your cognitive prosthetic**
- **Commands are remembered procedures**
- **Entities are externalized working patterns**
- **Bonds are explicit trust, not implicit permission**
- **Packages are portable components, not monolithic apps**
- **Silence is a feature** — you build, the system remembers, nobody else gets a copy

When synthetic intelligence arrived, koad:io didn't need to be redesigned. It just needed to become **LLM-addressable** — which is what the pi harness, bond gate, and control surface do.

---

## Architecture at a Glance

```
~/.koad-io/          ← Framework: CLI tools, commands, packages, daemon, hooks
~/.<entity>/         ← Entity: identity, keys, memories, commands, trust bonds
~/.forge/            ← Business overlay: websites, services, forge packages
```

### The Cascade

Every command runs through the entity launcher (`<entity> <cmd> [args]`). The launcher fires the env cascade before any script executes:

```
~/.koad-io/.env       ← Framework defaults
~/.<entity>/.env      ← Entity overrides
./commands/.env       ← Command-local overrides
```

By the time a command runs, every variable — ports, bind addresses, database URLs, domain names — is already resolved. **The cascade is the contract.** Running a tool directly (skipping the launcher) breaks it.

### Example

```bash
alice start site kingofalldata.com
```

Expands to:

```bash
set -a
source ~/.koad-io/.env
source ~/.alice/.env
~/.koad-io/commands/start/command.sh site kingofalldata.com
```

No guessing. No configuration drift. No remembering.

---

## 🧱 Entities

Entities are **containers of context** — each one holds:

- Identity (GPG keys, SSH keys, fingerprints)
- Environment (`.env`, `.credentials`)
- Commands (entity-specific operational verbs)
- Memories (saved context, destination notes)
- Trust bonds (signed capability grants from other entities)
- Skills (on-demand capabilities)
- Briefs, flights, and operational state

Entities are not "AI characters." They are **role-bound projections of how you work**:

| Entity | Role | What they do |
|--------|------|-------------|
| `juno` | Orchestrator | Coordinates the kingdom, dispatches flights, moderates channels |
| `vulcan` | Engineer | Builds, ships, refactors, maintains infrastructure |
| `alice` | Explorer | Spawns projects, probes systems, investigates |
| `argus` | Auditor | Reviews, verifies, compliance checks |
| `mercury` | Communicator | Inter-entity communication, announcements |
| `vesta` | Curator | Knowledge organization, memory curation |
| `rooty` | Builder | System health, recovery, machine care, sovereign infrastructure |
| `salus` | Healer | Wellness, repair, maintenance |
| `cacula` | Game Master | Designs the mechanics — blockers, scoring, win conditions |

20+ entities, each a shard of working patterns, each bounded by explicit bonds.

---

## 🛡 Bond Gate + Control Surface

The system has two halves of its safety model:

### 1. Bond Gate (live constraint)

"What can this entity even attempt?"

- Tool visibility follows resolved bond scope
- Tool execution blocked by path, extension, and grant checks
- Scoped read/write/exec lanes per bond
- koad-io command lanes (grant specific verbs, not the whole cascade)
- Channel moderation/participation scoped by slug
- Dispatch targets restricted by bond
- Bash policy reroutes shell calls to typed kingdom tools
- Scrubbed results — secrets never reach the LLM

### 2. Control Surface (chain of custody)

"What is happening? What happened?"

- Active/recent session index (`session-index.js`)
- Flight index with stale detection (`flight-index.js`)
- Dispatch records with full lineage (`runtime/dispatches/`)
- Session watchers for live observation (`runtime/session-watchers/`)
- Postgres audit trail (`koad_telemetry`)
- JSONL archive sweep for terminal records
- Question queue for cross-entity communication

Together: **constrained embodiment + auditable custody.**

And because every utterance becomes part of the substrate's permanent record, **restraint is a feature, not a limitation**. The entity doesn't get to hallucinate and walk away. The kingdom remembers.

---

## 📦 Packages

koad:io supports local Meteor packages via `KOAD_IO_PACKAGE_DIRS`:

```bash
KOAD_IO_PACKAGE_DIRS=$HOME/.ecoincore/packages:$HOME/.koad-io/packages
```

This allows:

- Custom packages in `~/.koad-io/packages/`
- Domain packages in `~/.ecoincore/packages/`
- Business packages in `~/.forge/packages/`
- Entity-specific packages in `~/.<entity>/packages/`

Each package is a **named, scoped component** that declares what it provides. The app shell consumes packages — it doesn't own the logic. This makes the system:

- Portable (copy a package, it works)
- Auditable (read the README, understand the scope)
- Replaceable (swap a package without touching the app)
- LLM-comprehensible (a package is a bounded context)

---

## ⚡ Status

> **[BUG SALAD]**  
> Use at your own curiosity. It works. But only mostly. Maybe.

koad:io is a living system. The substrate (commands, entities, cascade, packages) is stable. The AI integration layer (pi harness, bond gate, control surface) is evolving fast. Things break, change shape, and get reorganized.

---

## 🛠 Directory Layout

### Framework root (`~/.koad-io/`)

```
.koad-io/
├── bin/            # Launchers and CLI tools
├── commands/       # Framework command set
├── packages/       # Framework Meteor packages
├── skeletons/      # Project templates
├── hooks/          # Execution lifecycle hooks
├── helpers/        # Sourced utilities (emit, discovery, ask)
├── daemon/         # Kingdom backbone (Meteor, dev-mode, never built)
├── harness/        # Role primers + pi extension + startup
├── modules/        # Shared Node.js module (@koad-io/node)
├── plugins/        # Harness extensions
├── me/             # Sovereign identity root
├── training/       # Master training layer
├── .env            # Framework defaults
├── .credentials    # Private credentials (not in git)
└── .aliases        # Optional alias layer
```

### Entity home (`~/.<entity>/`)

```
.alice/
├── id/             # GPG keys, SSH keys, fingerprints
├── commands/       # Entity-specific commands
├── memories/       # Saved context
├── trust/bonds/    # Signed capability grants (.md.asc)
├── skills/         # On-demand capabilities
├── briefs/         # Active briefings
├── destinations/   # Prior-visit notes per host/path
├── packages/       # Entity-specific packages
├── .env            # Entity identity + config
├── .credentials    # Entity credentials
├── hooks/          # Entity lifecycle hooks
└── .local/         # Local state (harness sessions, runtime)
```

---

## ✍️ Example Usage

```bash
# Login via SSH to a different device
alice ssh crapple

# Sign a message with alice's key
alice sign "I am the sovereign."

# Generate a login assertion for a domain
alice generate login wonderland.koad.sh

# Spawn a new project
cd ~/Workspace
mkdir my-project && cd my-project
alice spawn bare
alice start

# Dispatch work as Juno
juno dispatch vulcan "refactor the session scanner"
```

---

## 🌐 Philosophy

- **Anti-fragmentation, not anti-AI.** Sovereignty over your own keys, data, and substrate.
- **Identity-first.** Bonds are explicit and auditable. The constitution lives in the gate, never in the prompt.
- **Modular, file-based, reproducible.** Files and folders are the external mind. Locality makes cognition at scale possible.
- **Think once, encode forever.** Every saved command, entity, package, and bond is an idea you never have to think about again.
- **Silence is a feature.** Everything you put on a platform you don't control becomes permanent and weaponizable. Build on your own hardware. Nobody else gets a copy.
- **Rights are responsibilities.** The responsibility of sovereignty is choosing what to publish and what to keep.
- **Designed for sovereign operators.** A $200 laptop, harnessed correctly, is enough to throne up.

> **Synthetic intelligence connected via files and folders. On hardware you own.**

---

## 📚 Learn More

- [Commands guide](https://kingofalldata.com/cheatsheets/bourn-again-scripting)
- [kingofalldata.com](https://kingofalldata.com) — the public storefront
- [alice repo](https://github.com/koad/alice) — a complete, working entity

> `koad:io` doesn't ship with commands. You build your own — intimately, intentionally.

---

## 💬 Community

Come hang out, share flows, scripts, bugs, ideas.

---

## 🪪 License

MIT — Yours to fork, break, and rebuild.

> "Your systems need to be faster than you can think."
> — adapted from Getting Things Done
