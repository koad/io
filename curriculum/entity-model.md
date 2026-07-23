---
slug: entity-model
title: Entity model
shortTitle: Entities
level: Basic
difficulty: 18
blurb: How a role-bound AI worker becomes a directory with identity, memory, skills, commands, bonds, and history.
hypothesis: An AI worker should be a named operating unit, not just a prompt.
---

## Hypothesis

An AI worker should be a named operating unit, not just a prompt.

## Problem

Most agent systems treat identity as configuration. A prompt says what the agent should be, a tool list says what it can do, and a platform account stores the surrounding state.

## Solution served by koad:io

koad:io makes each entity a directory on disk. The directory contains identity, memory, skills, commands, keys, trust bonds, hooks, and git history.

## Technical model

- `ENTITY.md` declares role, authority, and boundaries.
- Memories preserve durable context.
- Skills load reusable work patterns.
- Commands expose capabilities.
- Trust bonds constrain delegation and tool access.

## Install / setup path

1. Name one role that should persist across sessions.
2. Create an entity directory.
3. Write `ENTITY.md` with what the entity does and does not do.
4. Add starter memories and skills where they change future behavior.
5. Commit the initialized entity state.

## Verification

The entity should start a new session and recover role, scope, context, and allowed tools without re-explanation.
