# koad:io Training

> Curated, progressive, practitioner-focused lessons for the koad:io framework.

## What this folder is

Distilled teaching material about how the kingdom works. Paired with **inline `PRIMER:` comments in the code itself** — the code is the source of truth; this folder is the map and the textbook.

Two audiences, one material:

1. **New users learning the kingdom** — read top-down, topic by topic, building up a mental model
2. **Practitioners re-remembering something** — search (book.koad.sh-style), jump to the cheatsheet or bug list, get unstuck fast

## Shape of a training module

```
training/<topic>/
  index.md         — overview of the topic; mental model; how the pieces fit
  <lesson>.md      — individual lesson per concept; links back to code
  cheatsheet.md    — (optional) "how do I do X again?" quick reference
  examples/        — (optional) working snippets
```

Each lesson file typically includes:

- **Why** — when does this matter? what problem does the pattern solve?
- **What exists today** — honest description of current state in the kingdom's code
- **How to reach for it** — the minimal recipe
- **Bugs in the wild** — known imperfections, why they haven't been fixed yet
- **Open questions** — design space that's still being explored
- **See also** — links to code files (`~/.forge/packages/<name>/...`), related lessons

## Relationship to inline primers

Code contains short inline `PRIMER:` comments at teachable moments. Those primers:

- Give the brief lesson RIGHT WHERE the pattern lives
- Link out to the full lesson in `~/.koad-io/training/<topic>/<lesson>.md`
- Never the reverse — training links INTO code, code doesn't link INTO training file paths that might break

The convention:

```js
// PRIMER: <short title>
// <1-3 lines of context>
//
// Full: ~/.koad-io/training/<topic>/<lesson>.md
```

Greppable: `grep -r "PRIMER:"` across the kingdom lists every inline lesson.

## How this grows

- **New lesson emerges** — something gets explained once in a brief or a conversation
- **Pattern appears twice** — distill it, put it here, link inline primers to it
- **Bug discovered** — add to the "Bugs in the wild" section of the relevant lesson
- **Design question opens** — note in "Open questions"; don't close prematurely

The training folder is never "done." It accumulates, gets distilled, gets reorganized as the kingdom's understanding deepens.

## Status

Currently seeded (2026-04-24):

- `layout/` — the layout stack (nav + templating packages; ApplicationLayout; space reservation; body-merge)
- (more topics to land as we walk the code during cleanup)

## See also

- `~/.documentation/` — koad's personal working documentation (broader, more varied)
- `~/.koad-io/skeletons/interface/` — the skeleton interface new users fork (future)
- inline `PRIMER:` comments across `~/.forge/packages/`, `~/.koad-io/packages/`, `~/.<entity>/`
