---
type: primer
folder: ~/.koad-io/training/
parents:
  - ~/.koad-io/
children:
  - path: cascade/
    blurb: Graduated lesson — end-to-end env cascade walkthrough
    status: documented
  - path: layout/
    blurb: Topical syllabus — how a koad:io app composes visual presence from packages
    status: documented
  - path: pluggable-indexers/
    blurb: Graduated tutorial — declare a JSONL indexer and subscribe from a Meteor consumer
    status: documented
  - path: sovereign-services/
    blurb: Graduated tutorial — standalone Node/MCP/JSONL service pattern (dance-hall reference)
    status: documented
features:
  - name: training-graduation-ladder
    blurb: Local-first lesson discipline — write in the package, graduate here when proven broadly applicable
    location: ~/.koad-io/training/PRIMER.md
  - name: training-distributed-architecture
    blurb: Training lives where the code it teaches lives — three-tier hierarchy (master / package / entity)
    location: ~/.koad-io/training/PRIMER.md, finding-training.md
  - name: training-finding-lessons
    blurb: Three search methods — grep PRIMER:, find training/ dirs, kingdom search --where
    location: ~/.koad-io/training/finding-training.md
  - name: training-inline-primer-convention
    blurb: PRIMER: comment block pattern — inline teachable moment with relative link to nearest lesson
    location: ~/.koad-io/training/PRIMER.md
  - name: training-cascade-lesson
    blurb: Graduated reference — complete env cascade walkthrough with worked example and known gaps
    location: ~/.koad-io/training/cascade/index.md
  - name: training-layout-syllabus
    blurb: Topical syllabus — four compositional cells, lesson index, cross-package open questions for the layout topic
    location: ~/.koad-io/training/layout/index.md
  - name: training-pluggable-indexers-tutorial
    blurb: Step-by-step tutorial — YAML declaration, reload trigger, DDP subscription (Path A / Path B), live update loop
    location: ~/.koad-io/training/pluggable-indexers/index.md
  - name: training-sovereign-service-pattern
    blurb: Architectural pattern — five-concern standalone Express+MCP+JSONL service with daemon projection; dance-hall is the reference
    location: ~/.koad-io/training/sovereign-services/index.md
relates-to:
  - ~/.koad-io/PRIMER.md
  - ~/.koad-io/KOAD_IO.md
  - ~/.livy/features/INDEX.md
entities:
  - livy
  - vulcan
last-walked: 2026-05-10
as-of: 27c7c83fe12793f6998f954b5e53ce19a9c87ff3
---

# koad:io Training

> Curated, progressive, practitioner-focused lessons for the koad:io framework.

## What this folder is

The kingdom's **master training** — entry-level teachings, topical syllabi, and distilled lessons that have graduated up from package-level training.

It has three complementary roles:

### 1. Entry point

A new user or entity arrives and needs to orient. The entry training teaches them:
- **Where training lives in this kingdom** (hint: everywhere — this folder is one of many)
- **How to find it** (search for `training/` folders across packages, entities, forge)
- **How primers work** (inline `PRIMER:` comments link to nearby lessons)

See: [`finding-training.md`](./finding-training.md)

### 2. Topical syllabi

Main topics — `layout/`, `router/`, `collections/`, `session/`, `navigation/`, `identity/`, `bonds/`, etc. — each one an index page that:
- Gives a mental model for the topic
- Maps the pieces (which packages, which files, which patterns)
- Lists the lessons that live in those packages
- Names the cross-package open questions

### 3. Distillation layer

Lessons that started in a specific package's `training/` folder and, over time, proved canonical enough to **graduate** here. Same pattern as commands: local first → promoted when proven.

## The graduation ladder

```
Raw teaching
    <package>/training/<lesson>.md            ← first articulation; lives with the code
         |
         |  (mature, proven, broadly applicable)
         ↓
    ~/.koad-io/training/<topic>/<lesson>.md   ← graduated; canonical, progressively-readable
```

Rule of thumb:
- **Start local.** Write lessons inside the package whose code they explain.
- **Graduate deliberately.** When a lesson is used across multiple packages OR reaches pedagogical maturity, lift it here with a link back to where it came from.
- **Don't pre-distill.** Raw lessons in a package's training/ folder are valuable even before graduation. The package remains the source of truth until explicitly graduated.

## Layout on disk

```
~/.koad-io/training/                       ← master (this folder)
    PRIMER.md                               (this file)
    finding-training.md                     (entry meta-lesson — how to find training)
    <topic>/
        index.md                            (topical syllabus — overview + pointers)
        <lesson>.md                         (graduated lesson — canonical form)

~/.forge/packages/<pkg>/training/          ← package-local (lives with code)
~/.koad-io/packages/<pkg>/training/        ← same for framework packages
~/.<entity>/training/                      ← entity-local when relevant

(any folder in the kingdom may have a training/ subfolder)
```

## Inline primer convention (in the code itself)

At the teachable moment in a file, add a short comment pointing to the nearest training:

```js
// PRIMER: <short title>
// <1-3 lines of context>
//
// Full: training/<lesson>.md           ← relative to package root
```

HTML:

```html
<!--
  PRIMER: <short title>
  ...
  Full: ../training/<lesson>.md          ← relative from this file
-->
```

Relative paths mean the primer travels with the code regardless of cascade position.

## Lesson structure

Whether local or graduated, a lesson is typically:

- **Why** — when does this matter? what problem does the pattern solve?
- **Mechanism** — what actually happens under the hood
- **How to reach for it** — minimal recipe
- **Bugs in the wild** — known imperfections, why they haven't been fixed yet
- **Open questions** — design space still being worked out
- **See also** — links to code, related lessons, syllabus topics

Be honest about imperfections. A lesson that names the bug is more useful than one that pretends the code is clean.

## Syllabus structure

The `<topic>/index.md` at this level is:

- **Topic overview** — the mental model
- **Compositional matrix** (if the topic spans multiple packages)
- **Lesson index** — pointers to per-package lessons AND graduated lessons here
- **Cross-package open questions**
- **Related topics** — cross-links to other syllabi
- **Key files** — canonical code locations

## How this grows

- Audit walks the code → find a teachable moment → add inline PRIMER + local lesson in package's `training/`
- Enough lessons in a topic → syllabus index at master level
- Lesson reaches maturity → graduate to master; update inline PRIMER to link to graduated version
- New user needs → meta-lesson here addresses it

No fixed taxonomy. Topics emerge from the work. Graduation happens when it's earned.

## See also

- [`finding-training.md`](./finding-training.md) — entry meta-lesson
- `~/.documentation/` — koad's broader personal manual, published at book.koad.sh
- `~/.koad-io/skeletons/` — the skeleton set users fork

---

*Livy walked this folder 2026-05-10. All four child subfolders documented.*
