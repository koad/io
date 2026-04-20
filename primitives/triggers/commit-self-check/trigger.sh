#!/usr/bin/env bash
# PRIMITIVE: commit-self-check
# KIND: trigger
# TRIGGER: {"entity":"$ENTITY","bodyMatch":"committed|pushed"}
# EVENT: update
# DEBOUNCE: 5
#
# Purpose: Engineer role authorship guard. When this entity emits an update
#          containing "committed" or "pushed", verify the last git commit in
#          the entity's home dir was authored by the entity. If the author
#          name does not match, emit a warning so the authorship bleed is
#          visible in the emissions feed.
#
# Roles: engineer only
#
# Note: The trigger selector body match ("committed|pushed") is a hint to the
#       daemon's trigger runner — exact matching semantics are daemon-side.
#       This script does a secondary check against git log directly.
#
# Env vars available from daemon trigger runner:
#   EMISSION_ENTITY  — should match ENTITY for this trigger
#   ENTITY           — canonical entity handle (e.g. "vulcan")
#   GIT_AUTHOR_NAME  — expected author name from .env

set -euo pipefail

if [ -z "${ENTITY:-}" ]; then
  exit 0
fi

# Derive entity home dir: ~/.entity
ENTITY_HOME="$HOME"

# Only check if entity home is a git repo
if ! git -C "$ENTITY_HOME" rev-parse --git-dir >/dev/null 2>&1; then
  exit 0
fi

LAST_AUTHOR="$(git -C "$ENTITY_HOME" log -1 --format='%an' 2>/dev/null || true)"

if [ -z "$LAST_AUTHOR" ]; then
  exit 0
fi

# Case-insensitive comparison: ENTITY may be "vulcan", author "Vulcan"
ENTITY_LOWER="$(printf '%s' "${ENTITY}" | tr '[:upper:]' '[:lower:]')"
AUTHOR_LOWER="$(printf '%s' "${LAST_AUTHOR}" | tr '[:upper:]' '[:lower:]')"

if [ "$AUTHOR_LOWER" != "$ENTITY_LOWER" ]; then
  source "$HOME/.koad-io/helpers/emit.sh" 2>/dev/null || exit 0
  koad_io_emit warning "commit-self-check: last commit authored by '${LAST_AUTHOR}', expected '${ENTITY}' — possible authorship bleed"
fi
