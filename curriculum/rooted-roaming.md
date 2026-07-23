---
slug: rooted-roaming
title: Rooted vs roaming
shortTitle: Rooted/roaming
level: Basic
difficulty: 11
blurb: How an entity decides whether it works from its own office or from the caller's current directory.
hypothesis: Place is part of context; the same entity can be fixed or sent somewhere.
---

## Hypothesis

Place is part of context; the same entity can be fixed or sent somewhere.

## Problem

Some work belongs in an entity's own office. Other work belongs in the project directory where the operator invoked the entity. Confusing the two creates wrong reads, wrong writes, and wrong assumptions.

## Solution served by koad:io

`KOAD_IO_ROOTED=true` makes an entity work from its home directory. Without it, the entity roams and works from the caller's CWD.

## Technical model

- Rooted: `HARNESS_WORK_DIR=~/.<entity>`.
- Roaming: `HARNESS_WORK_DIR=$CWD`.
- `CALL_DIR` preserves the original invocation directory.

## Install / setup path

1. Decide whether the entity is an office worker or project visitor.
2. Set or unset `KOAD_IO_ROOTED` in the entity `.env`.
3. Invoke from a project directory and inspect workdir.

## Verification

The harness should start in the intended directory every time.
