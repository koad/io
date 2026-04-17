# PRIMER: patches/

## What is this directory?

Patches for third-party tools used in the kingdom. When upstream software needs a modification that cannot wait for an upstream release (or that is too kingdom-specific to contribute upstream), the patch lives here.

## What does it contain?

- `opencode.patch` — A patch for the OpenCode AI agent runtime, applied to make it compatible with or better-integrated into the koad:io environment.

## Who works here?

Vulcan creates and maintains patches. Salus may apply patches during kingdom setup or tool upgrades.

## What to know before touching anything?

Patches in this directory should be treated as technical debt with an expiration date. Each patch should be accompanied by a note on why it exists and what upstream change would make it unnecessary. Before applying `opencode.patch`, verify it is still needed against the current upstream version — patches against stale versions silently fail or corrupt the target. Do not add patches for koad:io's own code; patches are strictly for third-party tools.
