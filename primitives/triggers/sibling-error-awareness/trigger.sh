#!/usr/bin/env bash
# PRIMITIVE: sibling-error-awareness
# KIND: trigger
# TRIGGER: {"type":"error"}
# EVENT: any
# DEBOUNCE: 5
#
# Purpose: Log errors from other entities to this entity's sibling-errors stream.
#          Universal — every entity gets this. Low-noise: log append only, no escalation.
#          Provides kingdom-wide situational awareness without inter-entity alerting.
#
# Env vars available from daemon trigger runner:
#   EMISSION_ENTITY  — entity that emitted the error
#   EMISSION_BODY    — body text of the emission
#   EMISSION_ID      — emission _id
#   EMISSION_TYPE    — should be "error" (matches trigger selector)
#   ENTITY           — the entity this script runs as (the owning entity)

set -euo pipefail

# Skip errors from this entity itself — only watch siblings
if [ "${EMISSION_ENTITY:-}" = "${ENTITY:-}" ]; then
  exit 0
fi

# Require both vars to be non-empty before logging
if [ -z "${EMISSION_ENTITY:-}" ] || [ -z "${EMISSION_BODY:-}" ]; then
  exit 0
fi

LOG_DIR="$ENTITY_DIR/streams"
mkdir -p "$LOG_DIR"

LOG_FILE="$LOG_DIR/sibling-errors.log"

printf '[%s] entity=%s id=%s body=%s\n' \
  "$(date -Iseconds)" \
  "${EMISSION_ENTITY}" \
  "${EMISSION_ID:-unknown}" \
  "${EMISSION_BODY}" \
  >> "$LOG_FILE"
