# koad-io kingdom

Permissioned proxy for `/kingdom/` — goals, projects, and forge.

## Usage

```
koad-io kingdom goal list [--horizon=<level>]
koad-io kingdom goal show <slug>
koad-io kingdom goal context <slug> [--update]
koad-io kingdom goal status <slug> <state>
koad-io kingdom goal create <slug>

koad-io kingdom project list [--horizon=<level>]
koad-io kingdom project show <slug>
koad-io kingdom project context <slug> [--update]
koad-io kingdom project status <slug> <state>
koad-io kingdom project create <slug>

koad-io kingdom tree [--horizon=<level>]
koad-io kingdom link <project> <goal>
koad-io kingdom acl <slug> [--add <cid> | --remove <cid>]

koad-io kingdom forge [clone|list|setup|...]
```

## Files

| Path | Purpose |
|------|---------|
| `command.sh` | Bash router — subcommand dispatch |
| `fm.py` | Python frontmatter parser (no deps) |
| `README.md` | This file |

## Build status

Per Juno's spec (`~/.juno/briefs/2026-07-23-kingdom-tooling.md`):

| Step | Status |
|------|--------|
| 1. Scaffold command structure | ✅ goal list, project list, tree |
| 2. Read commands (show, context) | ✅ |
| 3. Lifecycle (status transitions) | ✅ |
| 4. Create (with CID check) | ⬜ scaffold works, GPG gate pending |
| 5. Context updates | ✅ stdin pipe |
| 6. Daemon integration | ⬜ future |

## Deployed

2026-07-23 by Vulcan per Juno brief.
