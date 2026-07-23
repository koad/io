---
slug: ticklers
title: Ticklers: tossing work into the future
shortTitle: Ticklers
level: Basic
difficulty: 16
blurb: How deferred work is filed so it resurfaces later by time, place, or operating context instead of relying on memory.
hypothesis: A sovereign work system needs a way to throw attention forward without losing custody of the task.
---

## Hypothesis

A sovereign work system needs a way to throw attention forward without losing custody of the task.

## Problem

Not all work should be done now. Some tasks depend on time, place, another entity landing, a human decision, or a future context that does not exist yet.

Without a tickler system, deferred work becomes a pile of mental debt: browser tabs, chat messages, sticky notes, TODO comments, or model context that disappears when the session closes.

## Solution served by koad:io

koad:io ticklers are filesystem-backed deferred reminders. They let an entity or operator file work into the future so it resurfaces when the session starts, when an obligation digest runs, or when the relevant time/context arrives.

A tickler is not a calendar event. It is a custody object for attention: this mattered, not now, bring it back later.

## Technical model

- Ticklers live as files under entity-owned tickler surfaces.
- They can be time-addressed, space-addressed, or context-addressed.
- Session startup surfaces relevant ticklers in the harness preamble.
- Obligation tooling can digest, snooze, resolve, escalate, or convert ticklers.
- The filesystem preserves why the work was deferred.

## Install / setup path

1. Identify work that should not be done now but must not be forgotten.
2. Create a tickler with the future condition: date, place, blocker, or context.
3. Let the current session move on.
4. Run a future session or obligation digest.
5. Advance the tickler: resolve, snooze, escalate, delegate, or convert it into a brief.

## Verification

A task deferred today should reappear at the right future moment with enough context to act, without relying on human memory or chat history.
