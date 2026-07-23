---
slug: messages-ticklers
title: Messages, ticklers, and obligations
shortTitle: Obligations
level: Advanced
difficulty: 65
blurb: How async messages, deferred ticklers, and obligation digests keep work from disappearing between sessions.
hypothesis: Attention is a resource; the system must remember what is hanging.
---

## Hypothesis

Attention is a resource; the system must remember what is hanging.

## Problem

Work disappears when it lives only in chat, memory, or a model context window. Deferred responsibilities need durable surfaces.

## Solution served by koad:io

Messages, ticklers, and obligation digests keep asynchronous work visible across sessions and entities.

## Technical model

- Messages: async inbox files per entity.
- Ticklers: deferred reminders by time or space.
- Obligation digest: unified view of followups, questions, stale items, and blocked work.

## Install / setup path

1. Send an entity message.
2. Create a tickler for later.
3. Run obligation digest.
4. Advance or resolve the item.

## Verification

A deferred item should resurface without relying on human memory.
