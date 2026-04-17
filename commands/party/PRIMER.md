<!-- SPDX-License-Identifier: CC0-1.0 -->

# PRIMER — `~/.koad-io/commands/party/`

> Party-line session management — health checks and protocol enforcement for multi-entity collaboration sessions.

## What this does

`party` provides sub-commands for managing party-line sessions: collaborative opencode sessions where multiple entities take turns responding. The `check` sub-command audits session health and flags protocol violations.

## Sub-commands

| Sub-command | Purpose |
|-------------|---------|
| `check/command.sh` | Audit party session for protocol violations (unsigned contributions, missing sign-out, malformed provenance) |

## Invocation

```bash
cd ~/Workbench/some-project
<entity> party check              # Audit the active party session for violations
```

## What `party check` examines

- Infrastructure: presence of `.env`, valid `KOAD_IO_PARTY_SESSION`, party directory structure
- Protocol: entity contributions must be signed with full provenance (host/user/model)
- Sign-out: contributions must end with `--- <entity> out ---`

Violations are logged to `.koad-io/parties/<name>/poopers.log`. Exit 0 = clean; exit 1 = violations found.

## What it expects

- Must be run from a project directory with a party session active (`.env` with `KOAD_IO_PARTY_SESSION`)
- Party session started with `<entity> spawn party <name>`

## Notes

- Use `<entity> respond "message"` to participate in a session (see `respond/` command).
- Use `<entity> spawn party <name>` to start a new party session.
