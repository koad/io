<!-- SPDX-License-Identifier: CC0-1.0 -->

# PRIMER — `~/.koad-io/commands/generate/`

> Generator utilities — produce derived values and identifiers from entity data.

## What this directory is

`generate/` houses sub-commands that derive or produce new values — currently content IDs from human-readable names.

## Sub-commands

| Sub-command | Purpose |
|-------------|---------|
| `cid/command.sh` | Derive a stable 17-char Content ID from a human name or handle |

## Invocation

```bash
<entity> generate cid "Addison Cameron-Huff"
<entity> generate cid addisoncameronhuff
echo "some string" | <entity> generate cid
```

## What `generate cid` produces

A 17-character Content ID using the same algorithm as `koad.generate.cid()` in the Meteor package (`packages/core/both/global-helpers.js`). The output is byte-identical to the in-app function — safe to use in trust bonds, profile lookups, and sigchain entries.

Normalization: lowercase, strips all non-alphanumeric characters, then SHA-256 mapped through the EASILY_RECOGNIZABLE alphabet.

## Notes

- No external network calls — purely local computation.
- Use `--help` for full usage: `<entity> generate cid --help`
