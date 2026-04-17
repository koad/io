<!-- SPDX-License-Identifier: CC0-1.0 -->

# PRIMER — `~/.koad-io/commands/outfit/`

> Read and write an entity's visual outfit — hue, saturation, and appearance settings stored in `passenger.json`.

## What this does

`outfit` manages the visual identity layer of an entity. Outfit data lives in `$DATADIR/passenger.json` under the `outfit` key. Sub-commands read, set individual fields, and extract outfit state.

## Sub-commands

| Sub-command | Purpose |
|-------------|---------|
| `show/command.sh` | Print current outfit fields from `passenger.json` |
| `set/hue/command.sh` | Set the hue value |
| `set/saturation/command.sh` | Set the saturation value |
| `extract/command.sh` | Extract outfit state (for export or templating) |

## Invocation

```bash
<entity> outfit show                 # Print current outfit
<entity> outfit set hue 240          # Set hue
<entity> outfit set saturation 80    # Set saturation
```

## What it expects

- `$DATADIR/passenger.json` — must exist with an `outfit` key
- `python3` — used by `show` to parse JSON
- `assert/datadir` sourced — workspace `.env` must be valid

## Schema

See `SCHEMA.md` in this directory for the full outfit field reference.

## Notes

- Outfit fields are part of the passenger profile — they drive UI rendering for the entity's public-facing appearance.
- Exit 64 if `passenger.json` is missing.
