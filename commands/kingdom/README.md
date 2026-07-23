# koad-io kingdom

Permissioned proxy for `/kingdom/` — goals, projects, and forge.

## Usage

```
koad-io kingdom goal list [--horizon=<level>]
koad-io kingdom goal show <slug>
koad-io kingdom goal context <slug> [--update] [--commit]
koad-io kingdom goal status <slug> <state> [--commit]
koad-io kingdom goal create <slug>

koad-io kingdom project list [--horizon=<level>]
koad-io kingdom project show <slug>
koad-io kingdom project context <slug> [--update] [--commit]
koad-io kingdom project status <slug> <state> [--commit]
koad-io kingdom project create <slug>

koad-io kingdom commit <slug> [-m <message>]
koad-io kingdom tree [--horizon=<level>]
koad-io kingdom link <project> <goal>
koad-io kingdom acl <slug> [--add <cid> | --remove <cid>]

koad-io kingdom forge [clone|list|setup|...]

koad-io kingdom contacts list
koad-io kingdom contacts show <handle>
koad-io kingdom contacts add <url> [--org=<org>]
koad-io kingdom contacts sync <handle>

koad-io kingdom calendar list [--date=<ISO>] [--month=<YYYY-MM>]
koad-io kingdom calendar show <slug> [--date=<ISO>]
koad-io kingdom calendar add <date> <title> [--time=<HH:MM>] [--duration=<N>h] [--kind=<type>] [--project=<slug>]
koad-io kingdom calendar done <slug> [--date=<ISO>]
koad-io kingdom calendar cancel <slug> [--date=<ISO>]
```

## Files

| Path | Purpose |
|------|---------|
| `command.sh` | Bash router — subcommand dispatch (goals, projects, contacts, forge) |
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
| 7. Contacts list | ✅ |
| 8. Contacts show | ✅ CID via generate cid |
| 9. Contacts add | ✅ clone + forge mirror |
| 10. Contacts sync | ✅ pull origin + push forge |
| 11. Calendar list | ✅ date and month views |
| 12. Calendar show | ✅ frontmatter + body |
| 13. Calendar add | ✅ with slug derivation, auto-dirs |
| 14. Calendar done | ✅ status transition |
| 15. Calendar cancel | ✅ status transition |

## Deployed

2026-07-23 by Vulcan per Juno brief.
