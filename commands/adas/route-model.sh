#!/bin/bash
# adas route-model — resolve the model routing for an ADAS leg
#
# VESTA-SPEC-107 §3.2 + VESTA-SPEC-103 §11.3
# Implements the Hermez-default routing for ADAS memory legs.
# Memory consolidation passes route to local inference by default.
# Cloud frontier requires explicit override via model_ceiling: frontier in the flight plan.
#
# Usage:
#   adas route-model --leg <leg-type> [--ceiling <local|mid|frontier>]
#
# Leg types (from SPEC-107 §3.2):
#   archive_read          → local  (high volume, low complexity, structured data)
#   synthesis             → local  (structured synthesis — DeepSeek-R1 8B sufficient)
#   memory_consolidation  → local  (deterministic operations, Hermez default per SPEC-103 §11.3)
#   conflict_detection    → local  (pattern matching across structured files)
#   floor_verification    → local  (deterministic checks — rule-based)
#   code_write            → mid    (mid-tier sufficient for structured rewriting)
#   eval                  → local  (rule-based or small-model sufficient)
#   coordination          → frontier (complex reasoning, inter-entity trust)
#   final_synthesis       → frontier (inter-entity coordination, external comms)
#
# The --ceiling flag applies the flight plan's model_ceiling constraint.
# If the recommended tier exceeds the ceiling, the ceiling wins.
#
# Output (stdout): resolved tier — local | mid | frontier
# Exit 0 on success; exit 2 on unknown leg or invalid ceiling.

set -euo pipefail

LEG=""
CEILING="frontier"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --leg)     LEG="${2:-}";     shift 2 ;;
    --ceiling) CEILING="${2:-}"; shift 2 ;;
    *) echo "route-model: unknown flag: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$LEG" ]]; then
  echo "usage: adas route-model --leg <leg-type> [--ceiling <local|mid|frontier>]" >&2
  exit 2
fi

# Validate ceiling
case "$CEILING" in
  local|mid|frontier) ;;
  *) echo "route-model: unknown model ceiling: $CEILING (expected: local|mid|frontier)" >&2; exit 2 ;;
esac

# Tier to numeric for comparison
tier_rank() {
  case "$1" in
    local)    echo 0 ;;
    mid)      echo 1 ;;
    frontier) echo 2 ;;
  esac
}

# Default routing per SPEC-107 §3.2 and SPEC-103 §11.3
case "$LEG" in
  archive_read|memory_consolidation|conflict_detection|floor_verification|eval)
    RECOMMENDED="local"
    ;;
  synthesis)
    RECOMMENDED="local"
    ;;
  code_write)
    RECOMMENDED="mid"
    ;;
  coordination|final_synthesis)
    RECOMMENDED="frontier"
    ;;
  *)
    echo "route-model: unknown leg type: $LEG" >&2
    echo "Known legs: archive_read, synthesis, memory_consolidation, conflict_detection, floor_verification, code_write, eval, coordination, final_synthesis" >&2
    exit 2
    ;;
esac

# Apply ceiling constraint: if recommended > ceiling, use ceiling
REC_RANK=$(tier_rank "$RECOMMENDED")
CEIL_RANK=$(tier_rank "$CEILING")

if [[ "$REC_RANK" -gt "$CEIL_RANK" ]]; then
  RESOLVED="$CEILING"
else
  RESOLVED="$RECOMMENDED"
fi

echo "$RESOLVED"
