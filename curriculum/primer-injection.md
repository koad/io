---
slug: primer-injection
title: PRIMER injection
shortTitle: PRIMERs
level: Basic
difficulty: 12
blurb: How a project PRIMER.md is injected before harness delegation so sessions wake up oriented.
hypothesis: A directory can explain itself before the entity starts working.
---

## Hypothesis

A directory can explain itself before the entity starts working.

## Problem

Project context often lives in a human's memory. When an entity enters a project, it needs local rules, architecture notes, and intent before it acts.

## Solution served by koad:io

If the caller's directory has a `PRIMER.md`, the no-args hook injects it into the prompt or exposes it for the harness to load.

## Technical model

- `CALL_DIR/PRIMER.md` is detected automatically.
- The entity's own PRIMER is not double-injected when rooted.
- Leaf harnesses consume the resulting prompt/context.

## Install / setup path

1. Add `PRIMER.md` to a project root.
2. Invoke an entity from that directory.
3. Verify the session starts with project context.

## Verification

The entity should know local project facts before opening files.
