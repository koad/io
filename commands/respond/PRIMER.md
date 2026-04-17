<!-- SPDX-License-Identifier: CC0-1.0 -->

# PRIMER — `~/.koad-io/commands/respond/`

> Pass the conch — send a message into the active party-line session as the current entity.

## What this does

`respond` takes a message, prepends the entity's identity context and provenance header, and submits it as a turn in the active opencode party session. The entity responds as assistant, the turn ends, and participation is logged to the party's PRIMER.

## Invocation

```bash
cd ~/Workbench/some-project
<entity> respond "build the auth module"
<entity> respond "review protocol compliance"
```

## What it expects

- Working directory must have `.env` with `KOAD_IO_PARTY_SESSION` and `KOAD_IO_PARTY_NAME` set
- `.koad-io/parties/<name>/opencode/` directory must exist (created by `spawn party`)
- `opencode` available at `~/.koad-io/bin/opencode`
- `$ENTITY_DIR/ENTITY.md` — loaded as identity context for the response

## What it produces

- One assistant turn in the party session
- Appends entity name and join timestamp to the party's `PRIMER.md` (first time only)

## Notes

- The message is prefixed with `[PARTY-LINE]` + entity identity + provenance marker.
- Provenance format: `--- <entity> @ <timestamp> | <host>:<user> | <model> ---`
- Entities must sign out: `--- <entity> out ---` at the end of each turn. Protocol violations are tracked by `party check`.
- Start a session with `<entity> spawn party <name>` before calling `respond`.
