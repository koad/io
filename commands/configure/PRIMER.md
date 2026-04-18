<!-- SPDX-License-Identifier: CC0-1.0 -->

# PRIMER — `~/.koad-io/commands/configure/`

> Configuration entry point for koad:io infrastructure — kingdoms and daemons.

## What this does

`configure` routes to the appropriate configuration sub-command. It supports both an interactive `whiptail` TUI and a non-interactive CLI for headless/automated use.

## Invocation

```bash
# Interactive menu (requires whiptail)
<entity> configure

# Non-interactive direct dispatch
<entity> configure kingdom seed [--stdout | --output <path>] [--domain <domain>]
<entity> configure kingdom node [--stdout | --output <path>]
<entity> configure daemon --service <name> --action <install|start|stop|status>

# Env-var-driven (for scripts/CI)
CONFIGURE_SERVICE=ipfs CONFIGURE_ACTION=install <entity> configure daemon
```

## Sub-commands

| Sub-command | Purpose |
|-------------|---------|
| `kingdom/seed` | Generate cloud-init for a new kingdom controller (first VPS) |
| `kingdom/node` | Generate cloud-init for a node joining an existing kingdom |
| `daemon` | Manage daemon services (IPFS, Netbird) — interactive or scripted |

## Output modes (kingdom seed / node)

| Flag | Behaviour |
|------|-----------|
| _(none)_ | Copies to clipboard (xclip or pbcopy); falls back to stdout if neither available |
| `--stdout` | Prints cloud-init to stdout — pipe-friendly |
| `--output <path>` | Writes to a file; keeps the file |
| `--domain <domain>` | Seed only — sets TLS domain and skips certbot if blank |

## Daemon actions (non-interactive)

| Action | Effect |
|--------|--------|
| `install` | Run the service's install script |
| `start` | Bring up the service |
| `stop` | Bring down the service |
| `status` | Print service health |

Available services: `ipfs`, `netbird`

## What it expects

- Interactive mode requires `whiptail`: `sudo apt-get install whiptail`
- Non-interactive daemon actions require `docker`, `docker-compose`, `jq`
- Daemon setup may require sudo for service management

## Notes

- The menu loops back after each action until you choose "exit".
- This command is the kingdom bootstrap story — `configure kingdom seed` + `configure kingdom node` covers the full end-to-end VPS deploy flow.
