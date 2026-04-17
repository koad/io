# PRIMER: config/

## What is this directory?

Framework-level configuration files for tooling that spans multiple entities. Currently holds configuration for AI coding tools that operate across the kingdom.

## What does it contain?

- `opencode.jsonc` — Configuration for the OpenCode AI agent runtime. This is the framework-level config; individual entities have their own `opencode/opencode.jsonc` in their entity directory.

## Who works here?

Juno and Vulcan maintain these files when framework-wide tool behavior needs tuning. Entity-specific config lives in each entity's own directory — this config only belongs here when it affects all entities or the framework as a whole.

## What to know before touching anything?

Changes here affect every entity that inherits the framework config. The cascade order means entity-level `opencode.jsonc` files override this one — check whether the change you need belongs at the framework level or entity level before editing here. If in doubt, make the change in the specific entity's config first, then promote it here if it should apply everywhere.
