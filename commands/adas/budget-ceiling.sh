#!/bin/bash
# adas budget-ceiling — emit ceiling state for current token consumption
#
# VESTA-SPEC-107 §4: Budget-Ceiling Behavior
#   80% → warn (log to flight report)
#   95% → begin wrapping up, do not start new legs
#   100% → stop, commit with [budget ceiling] note, emit partial report
#
# Usage:
#   adas budget-ceiling --consumed <N> --total <N>
#
# Exits:
#   0 — below 80%, no action
#   1 — 80–94%: warn (prints "WARN: budget 80% ceiling reached")
#   2 — 95–99%: wrap-up (prints "WRAP: budget 95% ceiling — complete current leg, do not start new legs")
#   3 — 100%+:  stop   (prints "STOP: budget ceiling hit — commit work and halt")
#
# The caller is responsible for reading exit code and acting accordingly.

set -euo pipefail

CONSUMED=""
TOTAL=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --consumed) CONSUMED="${2:-}"; shift 2 ;;
    --total)    TOTAL="${2:-}";    shift 2 ;;
    *) echo "budget-ceiling: unknown flag: $1" >&2; exit 4 ;;
  esac
done

if [[ -z "$CONSUMED" || -z "$TOTAL" ]]; then
  echo "usage: adas budget-ceiling --consumed <N> --total <N>" >&2
  exit 4
fi

if [[ ! "$CONSUMED" =~ ^[0-9]+$ || ! "$TOTAL" =~ ^[0-9]+$ ]]; then
  echo "budget-ceiling: consumed and total must be integers" >&2
  exit 4
fi

if [[ "$TOTAL" -eq 0 ]]; then
  # No ceiling — unconstrained dispatch
  exit 0
fi

# Compute percentage using integer arithmetic (× 100 to avoid floats)
PCT=$(( (CONSUMED * 100) / TOTAL ))

if [[ "$PCT" -ge 100 ]]; then
  echo "STOP: budget ceiling hit — ${CONSUMED}/${TOTAL} tokens consumed (${PCT}%). Commit completed work with note: [budget ceiling — ${CONSUMED}/${TOTAL} tokens]. Emit partial flight report with budget_ceiling_hit: true."
  exit 3
elif [[ "$PCT" -ge 95 ]]; then
  echo "WRAP: budget 95% ceiling — ${CONSUMED}/${TOTAL} tokens consumed (${PCT}%). Complete current leg only. Do not start new legs."
  exit 2
elif [[ "$PCT" -ge 80 ]]; then
  echo "WARN: budget 80% ceiling reached — ${CONSUMED}/${TOTAL} tokens consumed (${PCT}%). Log: budget_warning: 80% ceiling reached"
  exit 1
else
  # Below 80% — no action
  exit 0
fi
