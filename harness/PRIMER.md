---
type: primer
folder: ~/.koad-io/harness/
parents:
  - ~/.koad-io/
children:
  - path: harness/primers/
    blurb: Seven role-specific context directories — auditor, communicator, curator, designer, engineer, healer, orchestrator
    status: documented
  - path: harness/default/
    blurb: Kindergarten default harness — installs opencode if missing, assembles context, exec opencode
    status: documented
features:
  - name: entity-context-assembly
    blurb: startup.sh assembles KOAD_IO.md → ENTITY.md → role primers → pre-emptive primitives into one SYSTEM_PROMPT before the session opens
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
relates-to:
  - ~/.koad-io/PRIMER.md
  - ~/.koad-io/KOAD_IO.md
  - ~/.koad-io/hooks/executed-without-arguments.sh
  - ~/.forge/commands/harness/PRIMER.md
entities:
  - vulcan
  - juno
last-walked: 2026-05-09
as-of: 05643665bcb4fb9c4ca162cf09c34456d22f3177
---

# ~/.koad-io/harness/ — Entity Context Assembly

> The harness is the first breath. Before an entity's first tool call, `startup.sh` has already assembled its identity, its commands, its open flights, and the shape of its world. The entity wakes up knowing what it has.

The harness directory is the runtime context layer for every koad:io entity. It has two jobs: assemble a SYSTEM_PROMPT from layered sources, and route that prompt into a leaf AI process (opencode, claude, pi, etc.).

## Files at a glance

| Path | Role |
|------|------|
| `startup.sh` | Core assembly script — reads all context sources, emits to stdout |
| `default/command.sh` | Kindergarten harness — ensures opencode, assembles, launches |
| `primers/<role>/` | Role-specific context directories (7 roles) |
| `memory-kek-ceremony.js` | SPEC-134 §6.2 KEK passphrase ceremony (Phase 5 stub) |

## The assembly model

`startup.sh` emits a composed SYSTEM_PROMPT in layers:

```
1. Session header   — entity name, host, user, date, work dir
2. Git status       — entity repo + working dir (if different)
3. Active briefs    — non-done briefs from ~/.<entity>/briefs/
4. Pre-emptive      — commands, hooks, trust bonds, memories, destinations,
   primitives         skills, daemon status, flights, questions, tickles, inbox
5. Working dir      — ls of HARNESS_WORK_DIR (roaming entities only)
6. Local .koad-io/  — party-line conversations in this workspace

--- [end of pre-emptive section] ---

7. Layer 1: Kingdom — ~/.koad-io/KOAD_IO.md, then every ~/.<dir>/KOAD_IO.md
8. Layer 2: Entity  — ~/.{entity}/ENTITY.md
9. Layer 2b: Roles  — primers/<KOAD_IO_ENTITY_ROLE>/*.md
10. Layer 4: PRIMER  — PRIMER.md from the working dir (roaming only)
```

The leaf harness (claude, opencode, pi) receives `SYSTEM_PROMPT` and passes it to the AI via its native mechanism. Claude Code uses `--append-system-prompt`; opencode uses `OPENCODE_CONFIG_CONTENT`.

## Rooted vs. roaming

`KOAD_IO_ROOTED=true` in an entity's `.env` means it always operates from `$ENTITY_DIR`. Rooted entities skip the working-dir listing and location PRIMER injection — they have a fixed office. Roaming entities work from `$CWD` and get the full location context.

## How to add a new role primer

1. Create `~/.koad-io/harness/primers/<role>/PRIMER.md` (and optionally `emissions.md`)
2. Set `KOAD_IO_ENTITY_ROLE=<role>` in the entity's `.env`
3. No changes to `startup.sh` needed — it discovers all `.md` files in the role directory automatically
4. Test: launch the entity and inspect the assembled system prompt on stderr via `--light` mode

## Light mode

For conversation dispatch (where a topic PRIMER replaces the heavy context), pass `--light` to `startup.sh` or set `KOAD_IO_STARTUP_LIGHT=1`. Light mode emits only: session header, git status, KOAD_IO.md, ENTITY.md, and role primers. Briefs, daemon, flights, inbox, working dir are suppressed.

## Subfolders

### `primers/`

Seven role directories, each containing `PRIMER.md` and `emissions.md`:

| Role | Entity examples |
|------|----------------|
| `auditor` | Argus |
| `communicator` | Mercury |
| `curator` | Vesta |
| `designer` | Muse, Iris |
| `engineer` | Vulcan |
| `healer` | Salus |
| `orchestrator` | Juno |

Role primers load automatically when `KOAD_IO_ENTITY_ROLE` matches a directory name. Adding a new file to any role directory makes it load on every session start for that role — no code changes.

### `default/`

The kindergarten harness. Called by `hooks/executed-without-arguments.sh` when an entity is launched with no arguments and no `KOAD_IO_HARNESS` override. It is intentionally minimal — the business-layer harnesses (claude, opencode, pi, etc.) live in `~/.forge/commands/harness/` and are richer.

---

*Livy walked this folder 2026-05-09. Children documented: `primers/` (7 roles), `default/`. Features: 7 (see frontmatter).*
