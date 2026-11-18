---
type: primer
folder: ~/.koad-io/
parents: []
children:
  - path: bin/
    blurb: The launchers — the `koad-io` dispatcher, one wrapper per entity, and the bash tools (grep, find, sin, search, status, tickle)
    status: documented
  - path: cache/
    blurb: Generated shell completions — safe to delete
    status: not-yet-walked
  - path: commands/
    blurb: The shared command set — the kindergarten lifecycle verbs and everything else any kingdom needs
    status: documented
  - path: console/
    blurb: The entity console (console.koad.sh) — its own repo, its own PRIMER
    status: documented
  - path: curriculum/
    blurb: Lessons served by `koad-io curriculum` — one file per mechanism (entity-habits, command-cascade, environment-cascade, …)
    status: documented
  - path: daemon/
    blurb: The kingdom's live backbone — Meteor 3 in dev mode, never built; entities, flights, emissions
    status: documented
  - path: desktop/
    blurb: Desktop widget (Electron) — real-time operator dashboard outside the browser
    status: documented
  - path: features/
    blurb: Feature map — MAP.md plus a folder per landed feature
    status: documented
  - path: harness/
    blurb: Session assembly (startup.sh), role primers, skill loading, the bond-gate docs
    status: documented
  - path: helpers/
    blurb: Sourced utilities — emit.sh/emit.py, discovery.sh, ask.sh, spinner, cd-reflex, tickler-reflex
    status: documented
  - path: hooks/
    blurb: Substrate lifecycle hooks — entity-no-args, entity-upstart, CWD PRIMER injection
    status: documented
  - path: lighthouse/
    blurb: A Meteor app in its own repo — src/, builds/, config/, logs/, scripts/
    status: not-yet-walked
  - path: modules/
    blurb: The shared Node module (@koad-io/node) — identity, crypto, sigchain, BIP39 exports
    status: documented
  - path: passenger/
    blurb: Passenger metadata — per-entity passenger.json files, indexed by the daemon
    status: documented
  - path: skeletons/
    blurb: Starter templates for new entities and project types — bare/skeleton carries a PRIMER
    status: documented
  - path: test/
    blurb: Substrate test suites — argv conformance, env values, the grep wrapper, session meta, spec-240; test/all, its known-failing set, and test/pre-commit
    status: documented
features:
  - name: environment-cascade
    blurb: Four-layer env load (~/.koad-io/.env → ~/.<entity>/.env → ~/.<entity>/.credentials → ./commands/.env) that resolves all runtime config before any command.sh runs
    location: ~/.koad-io/.env, ~/.<entity>/.env
  - name: command-discovery-order
    blurb: Deepest command directory wins; at equal depth, project-local → entity → KOAD_IO_COMMANDS_DIRS in listed order, then ~/.koad-io/commands; first match wins
    location: ~/.koad-io/bin/koad-io
  - name: shared-root-vs-entity-boundary
    blurb: ~/.koad-io/ ships the shapes a clone needs; whatever one operator's work adds lives in the entity dir — the `required | example` distinction, recorded in the glossary
    location: ~/.koad-io/KOAD_IO.md, ~/.koad-io/GLOSSARY.md
  - name: koad-io-lighthouse
    blurb: KOAD_IO.md — Layer 1, loaded first by every entity in every harness
    location: ~/.koad-io/KOAD_IO.md
  - name: koad-io-version-pin
    blurb: KOAD_IO_VERSION written to every entity dir at gestation — records the gestation commit the entity was born at
    location: ~/.koad-io/commands/gestate/entity/command.sh
  - name: entity-no-args-hook
    blurb: The "just type the entity name" door — resolves work dir, injects CWD PRIMER, delegates to the harness default
    location: ~/.koad-io/hooks/executed-without-arguments.sh
  - name: cwd-primer-injection
    blurb: Auto-prepend of $CWD/PRIMER.md to PROMPT when an entity is invoked inside a project folder
    location: ~/.koad-io/hooks/executed-without-arguments.sh
  - name: entity-upstart-hook
    blurb: Boot-time daemon and desktop launcher; lock-guarded so only one copy runs per upstart
    location: ~/.koad-io/hooks/entity-upstart.sh
relates-to:
  - ~/.koad-io/KOAD_IO.md
  - ~/.koad-io/GLOSSARY.md
  - ~/.koad-io/harness/PRIMER.md
  - ~/.koad-io/console/PRIMER.md
  - ~/.koad-io/helpers/PRIMER.md
entities:
  - vulcan
  - juno
  - livy
last-walked: 2026-11-15
as-of: 2026-11-15
---

# `~/.koad-io/` — the shared root

> What a clone inherits: the launchers, the shared commands, the cascade, the daemon, the hooks, the glossary. Nothing kingdom-specific.

## Cognitive Externalization

koad:io exists so a human mind can put its cognitive shards on disk. Think once per idea; encode it as a named shard — a command, a package, an entity, a bond, a primer; wire it in through the cascade; and never solve the same mechanical problem twice.

```
think once per idea
  → encode as named shard (command, package, entity, bond, primer)
  → wire it in via the cascade
  → never think about it again
```

The shard carries everything: its name, purpose, boundaries, dependencies, execution surface, and custody trail. The cascade wires them together. You just drop them in place.

## The Two Directories

```
~/.koad-io/          ← the shared root: launchers, commands, daemon, hooks, glossary
~/.<entity>/         ← the entity: identity, keys, memories, commands, trust bonds
```

- **The shared root** provides the shapes any kingdom needs.
- **The entity** provides identity: who is acting, with what capabilities, under what bonds.

Anything beyond those two is the operator's own — their sites, their services, their packages. The cascade finds them where they are declared (`KOAD_IO_COMMANDS_DIRS`, `KOAD_IO_PACKAGE_DIRS`), not at a path this file promises.

The cascade is load-bearing. Every command runs through the entity launcher, which fires the env cascade before `command.sh` executes:

```
~/.koad-io/.env       ← base defaults
~/.<entity>/.env      ← entity overrides
~/.<entity>/.credentials ← secrets
./commands/.env       ← command-local overrides
```

By the time a command runs, every variable is resolved. **The cascade is the contract.** Running a tool directly (skipping the launcher) breaks it.

## Packages Are the Real System

Apps are thin shells. The real logic lives in packages, each one an independent repository, found through `KOAD_IO_PACKAGE_DIRS` — a colon-separated list of the directories that hold them.

The shared root ships no Meteor packages of its own.

Each package declares its own scope. The app shell consumes packages — it doesn't own the logic. This makes the system portable, auditable, replaceable, and readable by an entity as well as by a person.

## Safety Model

### 1. Bond Gate (live constraint)

Tools are only visible and executable when granted by an active bond. Bash is rerouted to typed kingdom tools. Results are scrubbed of secrets. Dispatch targets and channel access are scoped by bond.

### 2. Control Surface (chain of custody)

Flights carry lineage: who dispatched, from which session, with what plan, what model, what cwd. Session watchers observe active work. Postgres + JSONL archives provide durable audit trails.

## Top-level Inventory

Verified against `ls ~/.koad-io/` on 2026-11-15. Sixteen directories.

| Path | Role | Walk status |
|------|------|-------------|
| `bin/` | The launchers + bash tools | documented |
| `cache/` | Generated shell completions | not-yet-walked |
| `commands/` | The shared command set | documented |
| `console/` | The entity console (own repo) | documented |
| `curriculum/` | Lessons served by `koad-io curriculum` | documented |
| `daemon/` | Kingdom backbone (Meteor, dev-mode, never built) | documented |
| `desktop/` | Desktop widget (Electron) | documented |
| `features/` | Feature map (`MAP.md`) + per-feature folders | documented |
| `harness/` | Session assembly, role primers, skills, bond-gate docs | documented |
| `helpers/` | Sourced utilities (emit, discovery, ask, spinner) | documented |
| `hooks/` | Substrate lifecycle hooks | documented |
| `lighthouse/` | A Meteor app in its own repo | not-yet-walked |
| `modules/` | Shared Node.js module (@koad-io/node) | documented |
| `passenger/` | Per-entity passenger.json metadata | documented |
| `skeletons/` | Starter templates | documented |
| `test/` | Substrate test suites | documented |

## Key Files at the Root

| File | Purpose |
|------|---------|
| `KOAD_IO.md` | Layer 1 — loaded first by every entity, every harness |
| `GLOSSARY.md` | The words this kingdom uses — the one place a definition lives |
| `.env` | Base defaults — start of the cascade |
| `CHANGELOG.md` | Changelog |
| `LICENSE` / `KINGDOM-LICENSE` | AGPL-3.0 + kingdom license |
| `philosophy.md` | The principles behind the design |
| `README.md` | Overview (public-facing) |
| `PRIMER.md` | This file — orientation for whoever works here |

## Subfolders with Their Own PRIMERs

These exist:

- `bin/PRIMER.md` — the launchers
- `helpers/PRIMER.md` — every helper: what it is for, and whether you source it or call it
- `modules/PRIMER.md`, `modules/node/PRIMER.md` — the shared Node module (`@koad-io/node`)
- `harness/PRIMER.md` (+ `harness/primers/*/PRIMER.md`, `harness/patches/PRIMER.md`) — session assembly, role primers, dispatch
- `console/PRIMER.md` — the entity console (`console.koad.sh`)
- `desktop/PRIMER.md`, `passenger/PRIMER.md`, `skeletons/bare/skeleton/PRIMER.md` — the application layers
- `commands/<name>/PRIMER.md` — per-command docs, where they exist: `assert`, `generate`, `gestate/entity`,
  `harness`, `init`, `spawn`, `test`, `upstart`

**There is no `commands/PRIMER.md`, no `daemon/PRIMER.md`, and no `hooks/PRIMER.md`.** This section used to
cite files that were never written, and the inventory used to list a `packages/` and a `training/` that are
not in the tree. The command tree documents itself in-flow instead: a command run with no arguments prints
its own usage, and `helpers/discovery.sh` appends its siblings and flags on a TTY. If you write one of these
files, add it here — an honest missing entry beats a citation to a file that was never written.

## What Goes Here vs. The Entity Dir

**The shared root (`~/.koad-io/`):** commands, hooks, and helpers that any kingdom needs from day one. Generic shapes — nothing that assumes a particular operator's products, sites, or services.

**Entity dir (`~/.<entity>/`):** things that belong to exactly one entity — identity, memories, trust bonds, entity-specific commands.

When in doubt: would a fresh operator cloning koad:io need this? If yes, it belongs here. If no, it belongs in an entity dir.

## Worktree state — uncommitted, as of 2026-11-18

This walk read the tree on disk, which differs from `HEAD` in ways it could not commit (other entities' in-flight edits). A dated snapshot, not a permanent claim:

- `commands/stop/` and `commands/summary/command.sh` — deleted in the worktree, still in `HEAD`.
- `parsers/` (ten files plus its README) — deleted in the worktree, still in `HEAD`; the parser set followed the summary host out of the shared root.
- `bin/summary` — now a compatibility shim to the operator's summary command; `bin/tickle` — rewritten so its scan half reads through `tickler ls`.
- `commands/contacts/` and `commands/touch/` — present as untracked worktree additions, not in `HEAD`.

Until those land, `git show HEAD:<path>` still has the old files while `ls` does not. `git status` is the authority; update or delete this section when the worktree and `HEAD` agree again.

---

*Last walked 2026-05-10. Inventory rebuilt from `ls ~/.koad-io/` and vocabulary corrected against `~/.koad-io/GLOSSARY.md` on 2026-11-15 (VESTA-SPEC-247 m4). Child folders still marked `not-yet-walked` await their own flights.*
