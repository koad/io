---
title: spawn
scope: forge-command
doc-debt: complete
---

# `spawn` Command

Deploy a skeleton into the current directory, launch a Claude Code subagent, or start a multi-entity party-line session.

## Overview

`spawn` routes to one of three modes depending on the first argument:

| Mode | Trigger | What it does |
|------|---------|--------------|
| Skeleton | `spawn <skeleton-name>` | Copies a skeleton from `~/.koad-io/skeletons/` into cwd, runs its control scripts |
| Agent | `spawn agent <name>` | Launches a Claude Code subagent (inline or detached) |
| Party | `spawn party <name> [topic]` | Opens a multi-entity party-line session in cwd via opencode |

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

## Agent Spawn

```bash
<entity> spawn agent <name> [options]
<entity> spawn agent list
<entity> spawn agent kill <name>
<entity> spawn agent log <name>
```

Launches a Claude Code process and tracks it under `~/.alice/subagents/<name>/` (configurable via `SPAWN_DIR`).

### Options

| Flag | Default | Description |
|------|---------|-------------|
| `--detach` | false | Open in a new terminal window instead of the current shell |
| `--model <model>` | `sonnet` | Claude model (`sonnet`, `opus`, `haiku`) |
| `--agent <agent>` | — | Claude agent profile (`Explore`, `Plan`, general-purpose) |
| `--dir <path>` | cwd | Working directory for the subagent |
| `--prompt <text>` | — | Initial prompt (required in inline mode) |

### Modes

**Inline (default):** Runs `claude --print` in the current shell. Requires `--prompt`. Blocks until the agent completes. Use for one-shot tasks.

**Detached (`--detach`):** Opens an interactive `claude` session in a new terminal window. The agent stays live. Use for long-running or interactive work.

### Audit trail

Every agent spawn writes a session log to `.koad-io/spawn-<name>-<timestamp>.log` in the working directory. A combined rolling log (`spawn-<name>.log`) accumulates across sessions. Disable with `SPAWN_AUDIT=false`.

### State files

Each agent gets a directory at `$SPAWN_DIR/<name>/`:

| File | Contents |
|------|----------|
| `info.txt` | Name, session ID, model, workdir, spawn time |
| `pid` | Process ID of the terminal (detached) or claude process |
| `log.txt` | Session output |
| `wrapper.sh` | Ephemeral launch script (detached mode) |

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SPAWN_TERMINAL` | `gnome-terminal` | Terminal emulator for detached mode |
| `SPAWN_TERMINAL_ARGS` | `--` | Args passed before the command to the terminal |
| `SPAWN_SESSION_PREFIX` | `subagent` | Prefix for the Claude session name |
| `CLAUDE_MODEL` | `sonnet` | Default model |
| `CLAUDE_AGENT` | — | Default agent profile |
| `SPAWN_WORKDIR` | cwd | Default working directory |
| `SPAWN_DIR` | `~/.alice/subagents` | Where agent state is stored |
| `SPAWN_AUDIT` | `true` | Enable audit logging |
| `SPAWN_AUDIT_DIR` | `.koad-io` | Audit log subfolder within working directory |
| `SPAWN_AUDIT_COMBINE` | `true` | Append to a per-agent combined log |

Override any of these in `~/.alice/.env` or pass them as environment variables before the command.

### Examples

```bash
# Run a one-shot task inline
alice spawn agent reviewer --prompt "Review the last 3 commits and file any issues"

# Open an interactive session in a new terminal
alice spawn agent builder --detach --dir ~/.forge

# List what's running
alice spawn agent list

# Kill a named agent
alice spawn agent kill reviewer

# Tail a session log
alice spawn agent log builder
```

## Party Spawn

```bash
<entity> spawn party <name> [topic]
```

Starts a multi-entity party-line conversation anchored to the current directory. Uses opencode as the harness. The spawning entity signs the opening entry and exits — the party is seeded, not controlled.

Multiple parties can coexist in one directory; each gets its own subfolder under `.koad-io/parties/<name>/`.

### What it creates

| Path | Contents |
|------|----------|
| `.koad-io/parties/<name>/PRIMER.md` | Beacon file — entity presence indicator for this directory |
| `.koad-io/parties/<name>/session` | opencode session ID |
| `.koad-io/parties/<name>/opencode/opencode.json` | opencode config with entity permissions |
| `.env` | `KOAD_IO_PARTY_SESSION` and `KOAD_IO_PARTY_NAME` set as active party |

### How other entities join

Once a party is started, any entity can participate:

```bash
cd <project-directory>
vulcan respond "build the auth module"
vesta respond "review for spec compliance"
```

The PRIMER.md beacon signals to any entity opened interactively in that folder that a party is active.

### Party-line protocol

Each participant must:
1. Sign their entry: `--- <entity> @ <timestamp> | <host>:<user> | <model> ---`
2. State what they did (specific: files, decisions, commits)
3. Close with: `--- <entity> out ---`
4. Read the thread before acting
5. Stay in their specialty — don't do another entity's job

### Example

```bash
# Juno opens the party
juno spawn party auth-build "build and spec the auth module"

# Then hand it off
vulcan respond "build the session flow"
vesta respond "review the session spec"
```

## Relation to the harness command

`spawn agent` and `spawn party` complement the harness command rather than replace it. The harness command manages the primary entity process (identity, env cascade, daemon binding). `spawn agent` creates subordinate Claude processes for task-scoped work; `spawn party` creates shared opencode sessions for multi-entity collaboration. Neither touches the primary harness process.
