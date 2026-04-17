<!-- SPDX-License-Identifier: CC0-1.0 -->

# PRIMER — `~/.koad-io/commands/spawn/`

> Spawn processes, agents, and party sessions — deploy a skeleton, launch a Claude Code subagent, or start a party-line session.

## What this does

`spawn` routes to one of three sub-commands depending on the first argument:

- **Bare invocation** (`spawn <skeleton>`): Copies a skeleton from `~/.koad-io/skeletons/<skeleton>/` into the current directory, running pre-install, install, and post-install control scripts if present.
- **`spawn agent`**: Launches a Claude Code subagent in a new terminal or the current shell.
- **`spawn party`**: Starts a new party-line opencode session in the current directory.

## Invocation

```bash
<entity> spawn <skeleton>                  # Deploy a skeleton to the current directory
<entity> spawn agent <name>                # Spawn a Claude Code subagent
<entity> spawn agent <name> --detach       # Spawn in a new gnome-terminal
<entity> spawn agent list                  # List running subagents
<entity> spawn agent kill <name>           # Kill a named subagent
<entity> spawn party <name> [topic]        # Start a party-line session
```

## What it expects

- Skeleton spawn: `~/.koad-io/skeletons/<name>/` must exist
- Agent spawn: `claude` on PATH; `SPAWN_TERMINAL` env var (default: gnome-terminal)
- Party spawn: opencode installed; working directory for the session

## Notes

- Skeletons run `control/pre-install`, `control/install`, `control/post-install` if present — check the skeleton for side effects before deploying.
- After spawning a party, use `<entity> respond "message"` to participate.
- Agent spawn state is stored in `$SPAWN_DIR` (default: `~/.<entity>/subagents/`).
