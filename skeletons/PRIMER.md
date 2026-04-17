# PRIMER: skeletons/

## What is this directory?

Project template starters. Each subdirectory is a skeleton — a predefined file and directory structure that can be spawned into a new working directory via the `spawn` command. Skeletons eliminate the from-scratch setup cost for common project types.

## What does it contain?

- `bare/` — Minimal project skeleton, no framework assumptions
- `interface/` — UI application skeleton
- `lighthouse/` — Lighthouse (performance/audit tooling) project skeleton
- `meteor/` — Meteor application starter
- `mo-money/` — Financial/billing application skeleton
- `workspace/` — Multi-package workspace skeleton
- `README.md` — Overview of the skeletons feature and `spawn` usage

Each skeleton may include a `hook.sh` that runs additional setup steps when spawned.

## Who works here?

Vulcan adds and maintains skeletons as new project patterns emerge. Any entity with the `spawn` command can consume them.

## What to know before touching anything?

To use a skeleton:

```bash
cd ~/workbench/my-new-project/
alice spawn meteor
```

The `spawn` command copies the skeleton contents into the current directory and runs `hook.sh` if present. Editing a skeleton changes what all future spawns get — it does not retroactively update already-spawned projects. Skeletons are inherited by child entities at gestation, so structural changes propagate to new entities going forward.
