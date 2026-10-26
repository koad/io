---
title: spawn
scope: forge-command
doc-debt: complete
---

# `spawn` Command

Deploy a skeleton into the current directory.

## Overview

`spawn` deploys a skeleton into the current directory:

| Trigger | What it does |
|---------|--------------|
| `spawn <skeleton-name>` | Copies a skeleton from `~/.koad-io/skeletons/` into cwd, runs its control scripts |

## Skeleton Spawn

```bash
<entity> spawn <skeleton>
```

Looks up `~/.koad-io/skeletons/<skeleton>/` and:

1. Runs `control/pre-install` if present
2. Runs `control/install` if present
3. Copies `skeleton/` contents into the current directory
4. Runs `control/post-install` if present

Control scripts are optional. Check a skeleton's `control/` folder before deploying — scripts may have side effects (package installs, git init, etc.).

### Example

```bash
juno spawn bare
```

Deploys the `bare` skeleton from `~/.koad-io/skeletons/bare/` into the current directory.

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
