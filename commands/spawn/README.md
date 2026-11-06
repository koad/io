---
title: spawn
scope: forge-command
doc-debt: complete
---

# `spawn` Command

Deploy a skeleton into a declared target directory.

## Overview

| Trigger | What it does |
|---------|--------------|
| `spawn <skeleton-name>` | Copies a skeleton into the current directory (`$PWD`), runs its control scripts |
| `spawn <skeleton-name> --into <path>` | Same, into `<path>` — created if it does not exist |
| `spawn list` | Lists the skeleton roots and what they carry |

## Where it writes, and why that is not "wherever you happen to stand"

The **write root** is `--into <path>` or `$PWD`. Nothing else. An inherited `DATADIR`
never decides it (VESTA-SPEC-243 §2.6) — `DATADIR` is exported for the skeleton's own
control scripts only after the target has been verified. The **search root** for
skeletons stays CWD; the two are separate on purpose (§2.1).

## The target must be declared

A target is accepted **iff** it is empty, or its `./.env` declares it a koad:io project
with `KOAD_IO_TYPE` or `KOAD_IO_APP_NAME`. Three consequences that are the whole rule:

- an existing `.env` alone is **not** a declaration (the framework root has one);
- nothing walks upward — standing in `src/` of a real project is not a claim about `src/`;
- dotfiles count as content — a directory holding only `.git/` is not empty.

The framework root, `~/.forge`, `/kingdom`, `$HOME`, skeleton trees, and an identity
home's root or its 19 reserved subtrees (`id/`, `keyring/`, `trust/`, `memories/`, …)
are refused unconditionally — no flag reaches them. Every refusal exits **64** and
names the rule it applied.

## Skeleton Spawn

```bash
<entity> spawn <skeleton>                  # into $PWD
<entity> spawn <skeleton> --into ~/dev/app # into a named directory
```

Looks up the first match across `${CWD}/skeletons/`, the entity's `skeletons/`,
`~/.forge/skeletons/` and `~/.koad-io/skeletons/`, then:

1. Prints what the merge will do — `will overwrite N existing paths` (§2.8)
2. Runs `control/pre-install` if present
3. Runs `control/install` if present
4. Copies `skeleton/` contents into the target
5. Runs `control/post-install` if present

Control scripts are optional. Check a skeleton's `control/` folder before deploying — scripts may have side effects (package installs, git init, etc.).

**A target's `.env` is never overwritten by a payload.** If both carry one, the
payload's copy lands as `.env.skeleton` and the fact is reported (§2.8 M1).

### Example

```bash
juno spawn bare                            # deploy `bare` into the current directory
juno spawn bare --into ~/work/thing        # deploy it into ~/work/thing
```

## Overrides

`--force` (or `SPAWN_ALLOW_HOSTILE=1` for scripts) overrides the declaration refusal
and **nothing else**: it prints what it will overwrite, then proceeds. It never
reaches a protected root and it does not silence the announcement (§2.5).

## Retired sub-commands (2026-10-26)

`spawn agent` and `spawn party` are gone, both superseded:

  spawn agent   launched an interactive Claude Code subagent in gnome-terminal,
                tracked under ~/.alice/subagents/<name>/. `dispatch` replaced it —
                a durable flight with a record, instead of a terminal window that
                may or may not still be running.
  spawn party   started a multi-entity party-line by writing
                .koad-io/parties/<name>/PRIMER.md as a beacon and setting the
                active party in .env. `channel` replaced it — same idea (rooms,
                conch passing, turn log) with a real append-only record.

Neither was a koad:io primitive: one was Claude-specific and terminal-specific,
the other was an earlier implementation of something the kingdom now has.
