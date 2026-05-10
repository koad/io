---
type: primer
folder: ~/.koad-io/skeletons/
parents:
  - ~/.koad-io/
children:
  - path: bare/
    blurb: Minimal koad:io Meteor app — bare src/ structure, random port, entity-launcher start convention
    status: documented
  - path: entity/
    blurb: Entity command overlays — currently ships the control/q questions-queue command set (SPEC-165)
    status: documented
  - path: garden/
    blurb: Garden Protocol skeleton (SPEC-119) — embeds doors/devices/projects/control into any entity dir
    status: documented
  - path: interface/
    blurb: Admin PWA skeleton — Meteor app with role-gated accordion nav; bound to KOAD_IO_ZEROTEIR_INTERFACE
    status: documented
  - path: lighthouse/
    blurb: Public backend skeleton — headless keyserver and MCP workflow daemon for internet-facing deployment
    status: documented
  - path: meteor/
    blurb: Meteor deployment scripts — dev-config.json + per-machine run/deploy scripts; not tracked in koad-io repo (own git)
    status: documented
  - path: mo-money/
    blurb: Autonomous business agent skeleton — lean hypothesis validation with AI delegation and human finance control; own repo
    status: documented
  - path: seed/
    blurb: Seed Protocol skeleton (SPEC-120) — local operator workspace for a Hetzner VPS seed deployment
    status: documented
  - path: workspace/
    blurb: Coder workspace skeleton — Terraform + Dockerfile flavours (koad-io, v8ng, sandstorm); own repo
    status: documented
features:
  - name: skeleton-spawn-convention
    blurb: The control/install + skeleton/ two-folder layout shared by bare, garden, seed, workspace — installs copy skeleton/ into target
    location: ~/.koad-io/skeletons/bare/control/install
  - name: skeleton-pre-post-install-hooks
    blurb: pre-install validates preconditions, control/install does the copy, post-install wires the entity (env vars, launchers, screen sessions)
    location: ~/.koad-io/skeletons/bare/control/
  - name: entity-questions-queue-commands
    blurb: Six control/q sub-commands (file, list, ack, answer, cancel, resume) copied into entities by gestate — implements SPEC-165 questions queue
    location: ~/.koad-io/skeletons/entity/commands/control/q/
relates-to:
  - ~/.koad-io/PRIMER.md
  - ~/.koad-io/commands/PRIMER.md
  - ~/.livy/features/framework-gestate-command.md
  - ~/.vesta/specs/VESTA-SPEC-066.md
  - ~/.vesta/specs/VESTA-SPEC-119.md
  - ~/.vesta/specs/VESTA-SPEC-120.md
  - ~/.vesta/specs/VESTA-SPEC-165.md
entities:
  - vulcan
  - juno
  - livy
last-walked: 2026-05-10
as-of: 935d9bafac762cb2a900396cafc0a32d8ea835f3
---

# ~/.koad-io/skeletons/ — Project Templates

> Each subfolder is a reusable starting point for a new project type. Spawn one into an empty directory and you get a wired, running project without building the scaffolding yourself.

Skeletons eliminate the from-scratch setup cost for common project types: Meteor apps, deployed VPS seeds, entity gardens, Coder workspaces, and autonomous business agents. They are the kingdom's repeatable infrastructure.

## The spawn convention

Two skeletons use the `control/install` + `skeleton/` two-folder layout:

```
<skeleton>/
  control/
    pre-install    — validates env, checks preconditions
    install        — copies skeleton/ into target dir, wires .env
    post-install   — runs entity-specific post-setup (launchers, certs, screen)
  skeleton/        — the actual files copied into the target
  README.md        — full usage and reference
```

The others (meteor, mo-money, workspace) ship their template files directly and may have their own install conventions.

## Skeletons at a glance

| Skeleton | What spawns | Key spec |
|----------|-------------|----------|
| `bare/` | Minimal koad:io Meteor app with entity-launcher conventions | SPEC-066 |
| `entity/` | Command overlays for new entities (questions-queue commands) | SPEC-165 |
| `garden/` | Doors + devices + projects + control into an entity dir | SPEC-119 |
| `interface/` | Admin PWA (role-gated accordion nav, Meteor) | — |
| `lighthouse/` | Public-internet backend daemon (keyserver + MCP) | — |
| `meteor/` | Deployment scripts for an existing Meteor app | — |
| `mo-money/` | Autonomous business agent workspace | — |
| `seed/` | Local operator workspace for a Hetzner VPS seed | SPEC-120 |
| `workspace/` | Coder workspace templates (koad-io, v8ng, sandstorm flavours) | — |

## Which skeletons are in this repo?

The `.gitignore` in this folder is an allowlist. Only `bare/`, `entity/`, `garden/`, `interface/`, `lighthouse/`, and `seed/` are tracked here. `meteor/`, `mo-money/`, and `workspace/` each have their own git repos (cloned here locally):

- `meteor/` — koad/io-meteor-scripts (no remote found; local only)
- `mo-money/` — `git@github.com:koad/io-skeleton-mo-money.git`
- `workspace/` — `git@github.com:koad/io-workspace-skeleton.git`

## The entity command overlay pattern

`entity/` is different from the other skeletons: it does not spawn a project but rather overlays command files into a freshly gestated entity dir. Currently it ships the full `control/q/` questions-queue command suite (SPEC-165):

```
entity/commands/control/q/
  file/command.sh    — file a blocking question to another entity
  list/command.sh    — list questions; --incoming for session-start scan
  ack/command.sh     — acknowledge a question receipt
  answer/command.sh  — provide a resolution
  cancel/command.sh  — cancel an outstanding question
  resume/command.sh  — resume a flight that was blocked on a question
```

All six delegate to `control.js` in the receiving entity's `control/app/bin/`. The skeleton ensures every new entity is born with the question-queue surface without the gestate command needing to know the implementation details.

## Idempotency is required

Garden and seed control scripts are explicitly idempotent — running install a second time on an existing dir exits cleanly. Bare's install is not idempotent by design (it calls `meteor create`, which would conflict on a pre-existing src/).

## What edited skeletons do (and don't) affect

Editing a skeleton changes what future spawns receive. Already-spawned projects are not retroactively updated — they keep whatever shape they had at spawn time. If a skeleton change is important enough to back-apply, that is a Vulcan task done on the existing project dirs.

---

*Livy walked this folder 2026-05-10. All nine skeletons documented. Three external repos noted.*
