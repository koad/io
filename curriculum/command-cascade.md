---
slug: command-cascade
title: Command cascade
shortTitle: Commands
level: Basic
difficulty: 5
blurb: How repeated work becomes named commands resolved through project, entity, and framework layers.
hypothesis: The first thing to learn is how work becomes a named command.
---

## Hypothesis

The first thing to learn is how work becomes a named command. Once procedures are named, layered, and repeatable, the rest of the system has something stable to operate.

## Problem

Most computer work starts as memory in the operator's head: commands they remember, paths they know, scripts they half-recreate, and decisions they repeat manually.

AI makes this worse when every session invents a one-off procedure. The result may work once, but it does not become part of the operating substrate.

## Solution served by koad:io

koad:io turns repeated work into commands. A command is a named procedure resolved through a cascade: project-local first, then entity-local, then framework-level.

This lets a simple verb inherit place, identity, environment, memory, and authority.

## Technical model

1. Project commands: local procedures specific to the current working directory.
2. Entity commands: reusable procedures owned by the entity using them.
3. Framework commands: stable primitives shared across koad:io.
4. Typed verbs: explicit interface points instead of ad hoc shell fragments.

## Install / setup path

1. Pick one workflow you repeat manually.
2. Create a command folder for it in the narrowest correct scope.
3. Move the procedure into `command.sh`.
4. Run the command from a session and verify it inherits the expected identity and environment.
5. Promote the command only if it proves generic enough for a wider layer.

## Verification

You should be able to replace a remembered manual procedure with one named command that resolves correctly from context.
