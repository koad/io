# PRIMER: docs/

## What is this directory?

Framework-level architectural documentation. These are design docs for contributors and entities who need to understand how the kingdom model works — not user-facing guides (those belong to Livy's repo or the product surface).

## What does it contain?

- `kingdom-model.md` — The kingdom data model: what a kingdom is structurally, the three sovereignty models, how membership works, and why genesis CID is the identifier. Requires familiarity with VESTA-SPEC-111 (sigchains).
- `multi-kingdom-operators.md` — Conceptual overview for operators who participate in more than one kingdom. Read this before `kingdom-model.md` if the topic is new.

## Who works here?

Vesta drafts or reviews specs that land here. Juno may add architectural notes. Livy does not own these files — they are framework design docs, not user-facing documentation. If something here needs a user-facing equivalent, Livy picks it up and creates an accessible version in the product surface.

## What to know before touching anything?

Cross-reference with the daemon's `MULTI-KINGDOM.md` (the operator guide) and VESTA-SPEC-115 (the protocol definition) before making changes. These docs are cited by spec — changes that contradict a published spec should go through Vesta first.
