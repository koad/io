---
slug: entity-habits
title: Entity habits
shortTitle: Habits
level: Basic
difficulty: 22
blurb: How short always-on rules in an entity's habits/ folder are injected into the assembled system prompt every session, and why a default behaviour cannot depend on the model remembering to look it up.
hypothesis: A default behaviour should not depend on the model remembering to look it up.
---

## Hypothesis

A default behaviour should not depend on the model remembering to look it up.

## Problem

Skills are a **pull** mechanism. A skill is loaded only when the situation
matches its declared description — and the matching is performed by the same
thing that would need the skill. So the failure mode is structural: the skill
that was needed is never loaded, and the entity never learns that it exists.

The kingdom's answer so far has been to write better `when_to_use` lines. That
helps at the margin and cannot fix the case where the trigger is *"any time you
are directed to build"* — which is most of the work.

## Solution served by koad:io

An entity may keep `~/.<entity>/habits/`. Every Markdown file in it is injected
into the assembled system prompt at session start, before the first turn.

- A **skill** is a method, read when the situation matches.
- A **habit** is a rule, already present, and applies whether or not anyone
  matched anything.

The folder is the switch. Its absence is not an error and not silence: the
session preamble names the folder, says what it would do, gives the steps to
enable it, and links this note.

## Technical model

- `~/.koad-io/harness/startup.sh` resolves `$ENTITY_DIR/habits` and emits a
  `## Habits` section before `## Pre-emptive Primitives`.
- `README.md` is skipped by name, so a folder can document itself.
- A leading YAML frontmatter block is stripped before injection; metadata never
  reaches the prompt.
- A habit over 4KB is still injected but warns on stderr — a habit large enough
  to need a warning is usually a skill wearing the wrong hat.
- When the folder is absent or empty, startup.sh emits an enable-instruction
  block instead: what the folder is for, the three steps, and a link here.
- A habit is per entity, not per project. Project-scoped rules belong in that
  project's `PRIMER.md`; the habit is what travels with the entity.

### Why this is filed under `features/harness/lora/`

The assembled system prompt is the entity's conditioning layer. The weights do
not change; a short, dense set of standing directives shapes every turn — the
same idea a low-rank adaptation encodes. Habits are written into that layer
deliberately, one screen at a time, which is why the framework's own feature map
files this under `harness/lora` rather than under a tooling category.

## Install / setup path

Enabling habits is administrative. There is no code change.

1. `mkdir -p ~/.<entity>/habits`
2. Add one `.md` per habit: frontmatter with `name:` and `when:`, then the rule
   itself, in under a screen.
3. Start a new session. Every habit file is injected automatically.

The framework feature is documented at
`~/.koad-io/features/harness/lora/feature.md`.

## Verification

- An entity **with** habits gets a `## Habits` section before
  `## Pre-emptive Primitives`, containing each habit's body and none of its
  frontmatter.
- An entity **without** the folder gets an enable-instruction block naming the
  path, the effect, the steps, and this note — and no `## Habits` content.
- `grep -c '^## Habits'` against the assembled prompt is 1 or 0, never a partial
  render.
