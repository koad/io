---
slug: helpers-discovery
title: Helpers and discovery
shortTitle: Helpers
level: Moderate
difficulty: 38
blurb: How shared shell helpers and self-documenting command footers make the system learnable in-flow.
hypothesis: Tools should reveal nearby structure while you use them.
---

## Hypothesis

Tools should reveal nearby structure while you use them.

## Problem

A command system becomes hard to learn if every capability is hidden in documentation or tribal memory.

## Solution served by koad:io

Shared helpers provide reusable shell behavior. The discovery helper prints sibling subcommands and recognized flags so exploration happens in-flow.

## Technical model

- `helpers/discovery.sh` renders subcommands and flags.
- `helpers/emit.sh`, `ask.sh`, and search helpers standardize common operations.
- Quiet flags keep scripted output clean.

## Install / setup path

1. Source the helper from a command.
2. Call `_koad_io_hint` at the end.
3. Run the command in a TTY and inspect the footer.

## Verification

The command should show nearby affordances without opening docs.
