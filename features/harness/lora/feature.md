---
title: Habits — standing rules injected into the system prompt
status: landed
origin: 2026-11-09 — koad + vulcan
---

# Habits — the system prompt as a conditioning layer

**Intent.** An entity can carry short standing rules that are present from its
first turn, without paying the full method text of a skill into every session.

**We know it works when.** A session for an entity with a `habits/` folder
contains a `## Habits` section before `## Pre-emptive Primitives`, holding each
habit's body and none of its frontmatter — and a session for an entity without
the folder contains an enable instruction naming the path, what it would do, the
three steps to turn it on, and the `entity-habits` curriculum note.

**Not this.** Not a sweep of an application's features (that is the
feature-discovery skill, run interactively). Not a project-scoped rule — those
belong in the project's `PRIMER.md`. Not a replacement for skills: a habit states
a default, a skill holds a method, and a habit that needs sections and worked
examples is a skill with a wrong extension.

**Open questions.** Should the enable instruction be emitted for every absent
folder the framework knows about, or is habits the only one worth its lines?
Should a habit ever be scoped to a working directory rather than an entity?

**Status note.** Landed 2026-11-09 in `harness/startup.sh` (commit `cb44c25`),
verified in both directions against `ENTITY=vulcan` (habits present) and
`ENTITY=juno` (absent, no folder on disk). The first habit is
`~/.vulcan/habits/feature-discovery.md`.

---

## Why this is filed under `lora/`

The assembled system prompt *is* the entity's conditioning layer. Weights do not
change at session start; a short, dense set of standing directives shapes every
turn the model then takes. That is the same job a low-rank adaptation does, and
it is why the harness's conditioning surface is filed here rather than under a
tooling or config category.

Habits are the part of that layer an entity writes about itself. Everything else
in the assembly — identity, primitives, daemon state, flights — is produced *for*
the entity by the framework. A habit is the entity's own standing instruction,
one screen at a time, and it is the cheapest place in the system to change what
an entity does by default.

## The three states startup.sh renders

| Folder | What the session gets |
|---|---|
| absent | an enable instruction — what the folder is, the steps, the curriculum link |
| present, no habit files | the same instruction, said as *empty* rather than *missing* |
| present with habits | `## Habits`, then each body, frontmatter stripped |

The absent case is deliberately not silent. A capability nobody knows exists is
a capability that does not exist; the instruction is how the framework teaches
its own features to an entity that has not used them yet.
