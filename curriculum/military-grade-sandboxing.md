---
slug: military-grade-sandboxing
title: Military-grade sandboxing via bond gating
shortTitle: Sandboxing
level: Advanced
difficulty: 70
blurb: How deny-by-default tool, path, and delegation controls turn AI execution into a bounded operational sandbox.
hypothesis: Sandboxing is credible only when the runtime can deny before execution.
---

## Hypothesis

Sandboxing is credible only when the runtime can deny before execution.

## Problem

AI safety is often described in policy language: the model is instructed not to read secrets, not to write outside scope, not to call dangerous tools, and not to exceed its role.

That is not sandboxing. That is a request. A real sandbox must constrain execution even when a prompt, model, operator mistake, or tool proposal attempts to cross the boundary.

## Solution served by koad:io

koad:io uses trust bonds and the bond gate to enforce runtime boundaries. The entity only sees or executes tools that its active bonds grant. Read, write, exec, dispatch, browser, web, DDP, and other lanes can be scoped independently.

"Military-grade" here means a posture: deny by default, explicit grants, auditable relationships, and failure before execution. It is not a certification claim.

## Technical model

- Trust bonds define who may ask what of whom.
- Tool lanes constrain read, write, exec, network, browser, dispatch, and typed kingdom tools.
- The bond gate checks each action before execution.
- Secret-bearing files remain protected even when read/write paths are broad.
- Refusal is structural, not conversational.

## Install / setup path

1. Define the entity's role and non-role.
2. Grant the smallest useful read/write/exec lanes.
3. Add only the typed tools needed for the mission.
4. Attempt an out-of-scope read, write, exec, and dispatch.
5. Record the block evidence as part of the deployment test.

## Verification

The system should block unauthorized action before execution, produce an inspectable denial, and require a new signed grant before the entity can cross the boundary.
