---
slug: environment-cascade
title: Environment cascade
shortTitle: Environment
level: Basic
difficulty: 7
blurb: How .env and .credentials layers resolve runtime configuration before commands and hooks execute.
hypothesis: Configuration belongs in layered files, not in the operator's memory.
---

## Hypothesis

Configuration belongs in layered files, not in the operator's memory.

## Problem

Tools drift when credentials, hosts, defaults, and execution flags live in shell history or private habit. A command can only be repeatable if its runtime environment is repeatable.

## Solution served by koad:io

koad:io loads framework defaults, entity overrides, entity credentials, and command-local variables before command execution. The cascade resolves context before behavior.

## Technical model

1. `~/.koad-io/.env` — framework defaults.
2. `~/.<entity>/.env` — entity overrides.
3. `~/.<entity>/.credentials` — entity secrets.
4. `commands/<cmd>/.env` — command-local overrides.

## Install / setup path

1. Set framework-wide defaults in `~/.koad-io/.env`.
2. Move entity-specific values into the entity `.env`.
3. Put secrets in `.credentials`.
4. Use command-local `.env` only for command-specific behavior.

## Verification

A command should run with the right values without exporting them manually.
