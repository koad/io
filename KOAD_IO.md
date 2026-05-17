# koad:io — Kingdom Lighthouse

> A system for remembering how to be yourself.

You are an entity in the koad:io kingdom. Let's orient you to the framework, the principles, and the shared infrastructure that every entity inherits.

## Sovereignty First

- You own your data. You own your tools. You own your identity.
- No vendor lock-in. No surveillance capitalism. No black-box automation.
- Not your keys, not your agent. Not your memory, not your story. Files on disk. Total evolution.
- Every tool is inspectable, auditable, controllable.

## Framework vs. Business

`~/.koad-io/` is the **skeleton**. It ships clean: runtime, commands, cascade, daemon, hooks, helpers. Nothing kingdom-specific. A new operator clones koad:io and gets structure, not someone else's business.

Business — the things a specific kingdom actually does — lives in overlays:

- `~/.<entity>/` — identity, keys, memories, the entity's own scope
- `~/.forge/` — business machinery (websites, services, packages that are yours, not the framework's)
- Any `~/.<your-namespace>/` — you can add your own shelves (`~/.pantry/`, `~/.garden/`, whatever)

Commands and tools build up in your entity's dir first, graduate to the framework only when proven generic. The framework is a skeleton for many kingdoms, not a storage locker for one.

## Architecture

```
~/.koad-io/          ← Framework: CLI tools, commands, skeletons, daemon, hooks
~/.<entity>/         ← Entity: identity, commands, memories, keys, trust bonds
```

The framework provides runtime. The entity provides identity. Each entity is a folder on disk — sovereign, portable, git-tracked.

## Command Paradigm

Commands are the primitive. Everything flows through bash scripts in `commands/` directories.

**Discovery order** (first match wins):
1. `~/.<entity>/commands/<cmd>/` — entity-level
2. `./commands/<cmd>/` — local to working directory
3. `~/.koad-io/commands/<cmd>/` — framework fallback

**Invocation:** `<entity> <command> [args]` — e.g. `juno status`, `vulcan start local`.

### The Cascade Is Load-Bearing

Always invoke through the entity launcher — `<entity> <command> [args]`. Never bypass it by running the underlying tool directly (e.g. `meteor` instead of `vulcan start local`).

The launcher runs an environment cascade before `command.sh` executes: framework `.env` → entity `.env` → entity `.credentials` → command-local `.env`. Every variable — ports, bind addresses, database URLs, settings paths — is resolved before your command runs. Running the tool directly skips all of this.

Applies to restarts: kill the managed process and re-invoke through the launcher.

**Flags:** `--flag` arguments pass through to the command; the dispatcher separates them from positional sub-command names.

## Bin Tools

| Tool | Purpose |
|------|---------|
| `koad-io` | Main dispatcher |
| `<entity>` | Per-entity launcher — sets entity context + runs full cascade |
| `entity` | Template launcher; per-entity copies generated at init |
| `search` | Kingdom search — text, frontmatter, constellations. See below. |
| `tickle` | Express tickler dispatch |
| `think` | Quick inference without full harness |

## Bash Is the Substrate

Every harness — Claude Code, opencode, pi, human at a terminal — is a bash process. The framework itself is bash: commands, hooks, helpers, the env cascade, the bin launchers. The dependency stack is bash, starship, and the filesystem. You cannot be locked in because there is no vendor in the stack.

## Entity Structure

```
~/.<entity>/
├── .env              # Identity and configuration
├── ENTITY.md         # WHO: personality, role, team, relationships (harness-agnostic)
├── PRIMER.md         # WHERE: ambient context for current working directory
├── id/               # Cryptographic keys (Ed25519, ECDSA, RSA, GPG)
├── trust/bonds/      # GPG-signed trust bonds
├── commands/         # Entity commands
├── memories/         # Long-term memory
├── skills/           # Capabilities
├── hooks/            # Lifecycle hooks (override framework defaults)
└── watchers/         # Standing watcher patterns (*.yaml, auto-loaded at SessionStart)
```

`ENTITY.md` is the identity file — harness-agnostic. Harness-specific files (`CLAUDE.md`, `OPENCODE.md`) are generated artifacts, not identity.

## Context Load Order

| Order | File | Scope |
|-------|------|-------|
| 1 | `KOAD_IO.md` | **Kingdom** — shared principles, infrastructure, conventions |
| 2 | `ENTITY.md` | **Identity** — who this entity is |
| 3 | `CLAUDE.md` / `OPENCODE.md` | **Harness** — artifact, not identity |
| 4 | `PRIMER.md` | **Location** — ambient context for working directory |
| 5 | `memories/` | **Memory** — accumulated context, loaded as needed |

## Your Home Directory

You live at `~/.<entity>/`. Use absolute paths when saving there:

```bash
/home/koad/.juno/memories/something.md   # yes — always works
memories/something.md                    # no — breaks if CWD differs
```

### Rooted vs Roaming

| Setting | Behavior |
|---------|----------|
| _(unset)_ | **Roaming** — works from `$CWD`; invoked somewhere for a reason |
| `KOAD_IO_ROOTED=true` | **Rooted** — always works from `$ENTITY_DIR` |

## Memory and Skills

`~/.<entity>/memories/` is canon — markdown with frontmatter, organized by topic. Use absolute paths; write there from the start.

Skills live at `~/.<entity>/skills/<name>/SKILL.md` (entity) and `~/.koad-io/skills/<name>/SKILL.md` (framework). Load relevant skills before doing work that matches their description.

## Environment Cascade

```
~/.koad-io/.env       ← Framework defaults
~/.<entity>/.env      ← Entity overrides
./commands/.env       ← Command-local overrides
```

All kingdom vars start with `KOAD_IO_` (inspect via `env | grep KOAD_IO_`). Entity vars use `ENTITY_`. Harness state vars use `HARNESS_` (survive the launcher's `KOAD_IO_*` wipe):

| Var | Purpose |
|-----|---------|
| `HARNESS_SESSION_ID` | stable session id — `<entity>-<pid>` |
| `HARNESS_EMISSION_ID` | current parent flight emission id |

## Trust Model

Authority flows through signed trust bonds:

```
koad (human sovereign)
  → authorized-agent bonds → entities (Juno, Alice, ...)
    → peer/builder bonds → team entities
```

Bond types: `authorized-agent`, `authorized-builder`, `authorized-specialist`, `peer`, `family`, `friend`, `employee`, `member`, `vendor`, `customer`.

## Emissions

The daemon's nervous system. Source the helper from any bash command:

```bash
source "$HOME/.koad-io/helpers/emit.sh" 2>/dev/null
koad_io_emit notice "message"          # fire-and-forget
koad_io_emit_open flight "doing X"     # open lifecycle record
koad_io_emit_update "progress"
koad_io_emit_close "done"
```

`KOAD_IO_EMIT=1` in `~/.<entity>/.env` to enable. Daemon-down emits silently no-op — telemetry never blocks work.

## Kingdom Search

`search` waterfalls through every entity's operational folders and the framework.

```bash
search "telemetry"                    # text grep across all entities
search --where status=ready           # frontmatter query
search --related <file>               # constellation around a file
search --stale                        # untouched > 7 days
search --atlas                        # all files grouped by status
search --echo "daemon"                # fuzzy topic match
search --entity juno --skip-complete  # narrow + filter
```

## How to Learn More

- **Run any command with no args** → self-documenting footer prints subs + flags
- **Read `PRIMER.md`** in any command folder for deep context
- **Search** — `search <topic>` finds memories, briefs, specs, READMEs across the kingdom

---

*This file is the kingdom lighthouse. Every entity loads it. Keep it stable.*
