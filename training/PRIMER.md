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
