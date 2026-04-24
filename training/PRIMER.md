# koad:io Training

> Curated, progressive, practitioner-focused lessons for the koad:io framework.

## What this folder is

The kingdom's **syllabus** — a top-level index of training topics, each pointing into the packages where the actual lessons live.

**Actual lesson content lives WITH the package it describes**, not here. That way teaching travels with the code, stays in sync when the code evolves, and belongs to the package's own repo.

## The layering

```
~/.koad-io/training/                      ← syllabus: topics, overviews, cross-package maps
    PRIMER.md                              (this file)
    layout/
        index.md                           ← "Layout is composed of nav + templating…"
                                              links into:
                                                ~/.forge/packages/navigation/training/...
                                                ~/.forge/packages/templating/training/...
    session/
        index.md                           ← "Session is how reactive state works…"
                                              links into:
                                                ~/.koad-io/packages/session/training/...
                                                ~/.forge/packages/templating/training/...

~/.forge/packages/<pkg>/training/         ← per-package lesson content (lives with code)
~/.koad-io/packages/<pkg>/training/       ← same convention for framework packages
~/.<entity>/training/                     ← entities can own lessons too when relevant
```

## Three roles of `training/`

| Location | Role |
|---|---|
| `~/.koad-io/training/<topic>/index.md` | **Syllabus** — topic overview, mental model, map to per-package lessons |
| `<package>/training/<lesson>.md` | **Lesson** — the actual teaching, belongs to the package that demonstrates it |
| Inline `PRIMER:` in code | **Breadcrumb** — short note at the teachable moment, linking to the package's own training |

## Inline primer convention

```js
// PRIMER: <short title>
// <1-3 lines of context>
//
// Full: training/<lesson>.md          ← path relative to package root
```

Or for HTML:

```html
<!--
  PRIMER: <short title>
  ...
  Full: ../training/<lesson>.md        ← relative from the file containing the primer
-->
```

Relative paths inside a package mean the primer travels with the code regardless of where in the cascade the package is installed.

## Lesson structure (what goes in a `<package>/training/<lesson>.md`)

- **Why** — when does this matter?
- **Mechanism** — what actually happens under the hood
- **How to reach for it** — minimal recipe
- **Bugs in the wild** — known imperfections, why they haven't been fixed yet
- **Open questions** — design space still being worked out
- **See also** — links to code (relative), other lessons, related syllabus topics

Be honest about bugs. The lesson is MORE useful if it names the imperfection than if it pretends the code is clean.

## Syllabus structure (what goes in `~/.koad-io/training/<topic>/index.md`)

- **Topic overview** — the mental model, the shape of the concepts
- **Compositional matrix** — if the topic involves multiple packages
- **Lesson index** — pointers to per-package training files
- **Related topics** — cross-links to other syllabi
- **Key files** — canonical code locations that exemplify the topic

## How this grows

- Someone walks through a file, identifies a teachable moment → inline PRIMER + lesson in package's training/
- A new topic emerges spanning multiple packages → syllabus index at `~/.koad-io/training/<topic>/index.md`
- A package is extracted/carved → its `training/` dir travels with it automatically
- A lesson turns out to apply cross-package → migrate to syllabus level OR leave in one package and cross-link

The structure accumulates organically. No pre-designed taxonomy; topics emerge from the work.

## Status

Seeded 2026-04-24:

- `layout/` syllabus (this folder's first topic)
  - `~/.forge/packages/navigation/training/body-merge.md` (first lesson, paired with inline PRIMER in `navigation/client/body.html`)

More lessons land as we walk the code during the audit-and-primer pass.

## See also

- `~/.documentation/` — koad's broader personal manual, published at book.koad.sh
- `~/.koad-io/skeletons/` — the skeleton set users fork
