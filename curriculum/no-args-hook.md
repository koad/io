---
slug: no-args-hook
title: The no-args hook
shortTitle: No-args hook
level: Basic
difficulty: 9
blurb: How simply typing an entity name delegates to the default harness through executed-without-arguments.sh.
hypothesis: The smallest door into the kingdom should still load the full cascade.
---

## Hypothesis

The smallest door into the kingdom should still load the full cascade.

## Problem

A bare entity invocation should not be a dead end. If the operator types `juno`, the system should know the default way to wake that entity.

## Solution served by koad:io

When no command arguments are provided, `koad-io` executes `executed-without-arguments.sh`. That hook resolves rooted/roaming workdir, injects project PRIMER context, and delegates to the default harness.

## Technical model

- Hook waterfall: entity hook → CWD hook → framework hook.
- Framework hook: `~/.koad-io/hooks/executed-without-arguments.sh`.
- Default target: `harness default`.

## Install / setup path

1. Ensure the entity launcher exists.
2. Set entity default harness values in `.env`.
3. Run the entity with no arguments.
4. Confirm it starts the expected harness from the expected workdir.

## Verification

`juno` alone should open Juno's default work surface.
