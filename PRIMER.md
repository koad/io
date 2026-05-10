---
type: primer
folder: ~/.koad-io/
parents: []
children:
  - path: bin/
    blurb: Launchers and CLI tools — koad-io dispatcher, per-entity wrappers, search, think, tickle
    status: not-yet-walked
  - path: commands/
    blurb: Framework command set — gestate, init, emit, assert, build, start, stop, deploy, and more
    status: documented
  - path: daemon/
    blurb: The kingdom's live backbone — Meteor 3 in dev mode, never built; entities + flights + emissions
    status: documented
  - path: harness/
    blurb: Role primers (auditor/engineer/orchestrator etc.) and harness startup logic
    status: documented
  - path: helpers/
    blurb: Sourced utilities — emit.sh/py, discovery.sh, ask.sh, spinner, cd-reflex, tickler-reflex
    status: documented
  - path: hooks/
    blurb: Framework-tier lifecycle hooks — entity-no-args-hook, entity-upstart, CWD PRIMER injection
    status: documented
  - path: me/
    blurb: Sovereign identity root — id/, sigchain/, trust/ for the kingdom operator (koad)
    status: not-yet-walked
  - path: modules/
    blurb: Shared Node.js module (@koad-io/node) — identity, crypto, sigchain, BIP39 exports
    status: documented
  - path: packages/
    blurb: Framework Meteor packages — core, workers, harness, daemon-api, daemon-indexers, declarations, search, session
    status: documented
  - path: plugins/
    blurb: Harness extensions (opencode plugin) — teach a harness to feel like it comes from the kingdom
    status: not-yet-walked
  - path: primitives/
    blurb: Shared trigger/tickler/worker/party primitives used by daemon and forked applications
    status: not-yet-walked
  - path: skeletons/
    blurb: Starter templates for new entities and project types (entity, meteor, garden, seed, etc.)
    status: documented
  - path: training/
    blurb: Graduated lessons and topical syllabi — the master training layer for the kingdom
    status: documented
  - path: kingdoms/
    blurb: Cross-kingdom index — one folder per kingdom this operator participates in
    status: not-yet-walked
  - path: onboarding/
    blurb: Newcomer orientation docs (commands, entity structure, trust, team)
    status: not-yet-walked
  - path: documentation/
    blurb: Kingdom model docs, multi-kingdom operator guide, writing-commands guide
    status: not-yet-walked
  - path: config/
    blurb: Model prices JSON and opencode.jsonc — shared configuration read by multiple tools
    status: not-yet-walked
  - path: assets/
    blurb: Logo, icon, splash — brand assets at the framework level
    status: not-yet-walked
  - path: desktop/
    blurb: Desktop widget application (Electron) — real-time operator dashboard outside the browser
    status: not-yet-walked
  - path: archive/
    blurb: Archived emissions and closed flights — JSONL per collection per day
    status: not-yet-walked
  - path: emissions/
    blurb: Live emission bus — in-flight records before archival
    status: not-yet-walked
  - path: messages/
    blurb: Async message inbox per entity — files written by message drop command
    status: not-yet-walked
  - path: git-hooks/
    blurb: Optional git lifecycle hooks — post-commit daemon landing event
    status: not-yet-walked
  - path: patches/
    blurb: Framework patches — diff/apply patches for upstream dependencies
    status: not-yet-walked
  - path: passenger/
    blurb: Passenger metadata — per-entity passenger.json files indexed by the daemon
    status: not-yet-walked
features:
  - name: environment-cascade
    blurb: Three-layer env load (~/.koad-io/.env → ~/.<entity>/.env → ./commands/.env) that resolves all runtime config before any command.sh runs
    location: ~/.koad-io/.env, ~/.<entity>/.env
  - name: command-discovery-order
    blurb: Entity → local → framework three-step command resolution; first match wins; `KOAD_IO_COMMANDS_DIRS` is the search path
    location: ~/.koad-io/bin/koad-io
  - name: framework-vs-business-boundary
    blurb: Skeleton principle — ~/.koad-io/ ships generic runtime only; kingdom-specific work lives in ~/.forge/ and ~/.<entity>/
    location: ~/.koad-io/KOAD_IO.md
  - name: koad-io-lighthouse
    blurb: KOAD_IO.md — the kingdom orientation file loaded first by every entity in every harness
    location: ~/.koad-io/KOAD_IO.md
  - name: koad-io-version-pin
    blurb: KOAD_IO_VERSION file written to every entity dir at gestation — records the framework SHA the entity was born at
    location: ~/.koad-io/commands/gestate/command.sh
  - name: entity-no-args-hook
    blurb: The "just type the entity name" door — resolves work dir, injects CWD PRIMER, delegates to harness default
    location: ~/.koad-io/hooks/executed-without-arguments.sh
  - name: cwd-primer-injection
    blurb: Auto-prepend of $CWD/PRIMER.md to PROMPT when an entity is invoked inside a project folder
    location: ~/.koad-io/hooks/executed-without-arguments.sh
  - name: entity-upstart-hook
    blurb: Boot-time daemon and desktop launcher; lock-guarded so only one copy runs per upstart
    location: ~/.koad-io/hooks/entity-upstart.sh
relates-to:
  - ~/.koad-io/KOAD_IO.md
  - ~/.koad-io/commands/PRIMER.md
  - ~/.koad-io/daemon/PRIMER.md
  - ~/.koad-io/hooks/PRIMER.md
  - ~/.livy/features/INDEX.md
entities:
  - vulcan
  - juno
  - livy
last-walked: 2026-05-10
as-of: a176654204bedb918d3342206b9ae5e226687616
---

# ~/.koad-io/ — The Framework

> The skeleton every kingdom inherits. Ships clean: runtime, commands, cascade, daemon, hooks, helpers. Nothing kingdom-specific.

`~/.koad-io/` is the koad:io framework root. Clone it and you get structure, not someone else's business. Business — products, services, editorial voice, storefronts — lives in overlays: `~/.forge/` (business machinery) and `~/.<entity>/` (identity + scope).

## The three-layer architecture

```
~/.koad-io/          ← Framework: CLI tools, commands, skeletons, daemon, hooks
~/.<entity>/         ← Entity: identity, keys, memories, commands, trust bonds
~/.forge/            ← Business overlay: websites, services, forge packages
```

The framework provides runtime. The entity provides identity. The forge provides the kingdom's actual products.

## The cascade is load-bearing

Every command runs through the entity launcher (`<entity> <cmd> [args]`). The launcher fires the env cascade before `command.sh` executes:

```
~/.koad-io/.env       ← Framework defaults
~/.<entity>/.env      ← Entity overrides
./commands/.env       ← Command-local overrides
```

By the time a command runs, every variable — ports, bind addresses, database URLs, domain names, settings paths, screen names — is already resolved. Running a tool directly (skipping the launcher) breaks this. The cascade is the contract.

## Top-level inventory

| Path | Role | Walk status |
|------|------|-------------|
| `bin/` | Launchers + CLI tools | not-yet-walked |
| `commands/` | Framework command set | documented |
| `daemon/` | Kingdom backbone (Meteor, dev-mode, never built) | documented |
| `harness/` | Role primers + startup | documented |
| `helpers/` | Sourced utilities (emit, discovery, ask, spinner) | documented |
| `hooks/` | Framework lifecycle hooks | documented |
| `me/` | Sovereign identity root | not-yet-walked |
| `modules/` | Shared Node.js module (@koad-io/node) | documented |
| `packages/` | Framework Meteor packages | documented |
| `plugins/` | Harness extensions | not-yet-walked |
| `primitives/` | Trigger/tickler/worker/party primitives | not-yet-walked |
| `skeletons/` | Starter templates | documented |
| `training/` | Master training layer | documented |
| `kingdoms/` | Cross-kingdom index | not-yet-walked |
| `onboarding/` | Newcomer orientation | not-yet-walked |
| `documentation/` | Kingdom model docs | not-yet-walked |
| `config/` | Shared configuration (model prices, opencode) | not-yet-walked |
| `assets/` | Brand assets (logo, icon, splash) | not-yet-walked |
| `desktop/` | Desktop widget (Electron) | not-yet-walked |
| `archive/` | Archived emissions + flights (JSONL) | not-yet-walked |
| `emissions/` | Live emission bus | not-yet-walked |
| `messages/` | Async message inbox per entity | not-yet-walked |
| `git-hooks/` | Optional git post-commit hooks | not-yet-walked |
| `patches/` | Upstream dependency patches | not-yet-walked |
| `passenger/` | Per-entity passenger.json metadata | not-yet-walked |

## Key files at the root

| File | Purpose |
|------|---------|
| `KOAD_IO.md` | Kingdom lighthouse — loaded first by every entity, every harness |
| `.env` | Framework defaults — base of the cascade |
| `CHANGELOG.md` | Framework changelog |
| `LICENSE` / `KINGDOM-LICENSE` | AGPL-3.0 + kingdom license |
| `philosophy.md` | The principles behind the framework design |
| `README.md` | Framework overview (public-facing) |
| `PRIMER.md` | This file — agent orientation |

## Subfolders with their own PRIMERs

- `commands/PRIMER.md` — full command inventory, `.gitignore` whitelist pattern, command shape contract
- `daemon/PRIMER.md` — daemon architecture, guardrails, dev-mode lifecycle, `MONGO_URL=false`
- `helpers/PRIMER.md` — emit.sh/py, discovery.sh, ask.sh usage patterns
- `hooks/PRIMER.md` — framework hook details: executed-without-arguments, entity-upstart, CWD PRIMER injection; three-tier cascade explained; drift note on orchestrator hooks living in juno not here
- `training/PRIMER.md` — graduation ladder for lessons; four documented subfolders (cascade, layout, pluggable-indexers, sovereign-services)

## What goes here vs. forge

**Framework (`~/.koad-io/`):** Commands, hooks, and helpers that any kingdom needs from day one. Generic shapes — not specific to koad's products.

**Forge (`~/.forge/`):** Commands, hooks, packages, and services that are koad's business. Things that assume the forge is present, or that reference specific websites, services, or products.

**Entity dir (`~/.<entity>/`):** Things that belong to exactly one entity — identity, memories, trust bonds, entity-specific commands.

When in doubt: would a fresh operator cloning koad:io (not koad's kingdom) need this? If yes, it belongs here. If no, it lives in forge or an entity dir.

---

*Livy walked this folder; top-level inventory updated 2026-05-10. modules/ now documented. Child folders still marked `not-yet-walked` await their own PRIMER flights.*
