# PRIMER: harness/

## What is this directory?

The AI entity harness — the runtime machinery that assembles context and launches AI agents with a pre-loaded system prompt. This is how koad:io entities wake up already knowing who they are and what they have.

## What does it contain?

- `startup.sh` — The core context assembly script. Runs before the AI session opens. Reads entity identity, lists key directories, cats relevant files, and outputs an assembled system prompt. The AI inherits this rather than discovering it via tool calls. See inline comments for the full design rationale (VESTA-SPEC-067).
- `primers/` — Subdirectory of role-specific primer files loaded by `startup.sh` depending on the entity's role:
  - `primers/engineer/` — Context loaded for engineering entities (Vulcan, etc.)
  - `primers/orchestrator/` — Context loaded for orchestrator entities (Juno, etc.)

## Who works here?

Vulcan maintains `startup.sh`. Juno curates the primer content. This is core infrastructure — changes here affect every entity's startup experience.

## What to know before touching anything?

The harness is the first thing an entity reads. Errors here produce confusing agent behavior that is hard to trace back to the source. The design principle is explicit: front-load the map so the entity wastes no tokens on self-discovery. `startup.sh` is sourced by the `koad-io` launcher — changes take effect on the next entity launch, not mid-session. The `primers/` content is injected contextually based on entity type; adding new role primers requires a corresponding update to `startup.sh` to load them.
