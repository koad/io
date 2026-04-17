<!-- SPDX-License-Identifier: CC0-1.0 -->

# PRIMER — `~/.koad-io/commands/configure/`

> Interactive configuration menu for koad:io infrastructure — kingdoms, daemons, and databases.

## What this does

`configure` launches a `whiptail` TUI menu that routes to the appropriate configuration sub-command. It covers kingdom setup (seed and node), daemon service management, and MongoDB configuration.

## Invocation

```bash
<entity> configure           # Launch interactive configuration menu
```

## Sub-commands

| Sub-command | Purpose |
|-------------|---------|
| `daemon/command.sh` | Manage daemon services (IPFS, Netbird, etc.) |
| `kingdom/seed/command.sh` | Stand up a new kingdom controller (first VPS) |
| `kingdom/node/command.sh` | Generate cloud-init for a node joining an existing kingdom |
| `mongo/command.sh` | Configure MongoDB (placeholder — not yet implemented) |

## What it expects

- `whiptail` must be installed: `sudo apt-get install whiptail`
- Appropriate permissions to configure system services (daemon setup may require sudo)

## Notes

- MongoDB configuration is not yet implemented — the menu entry shows a "not available" dialog.
- The menu loops back after each action until you choose "exit".
- This command is primarily for kingdom operators standing up new infrastructure.
