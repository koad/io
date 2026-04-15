#!/bin/bash
# adas flight-report-fields — emit token_budget fields for flight reports
#
# VESTA-SPEC-107 §5.1: Flight Report Fields
# When a token_budget: was present in the originating flight plan, the flight
# report must carry these fields. This script emits them in the correct format.
#
# Usage:
#   adas flight-report-fields \
#     --budget <N>              token_budget total from the flight plan
#     --consumed <N>            actual tokens consumed
#     --model-ceiling <tier>    model_ceiling from the flight plan
#     [--ceiling-hit]           flag: budget ceiling was reached
#
# Output (stdout): YAML block for appending to a flight report
#
# Example output:
#   token_budget:      50000
#   tokens_consumed:   48230
#   budget_remaining:  1770
#   budget_ceiling_hit: false
#   model_ceiling:     mid

set -euo pipefail

BUDGET=""
CONSUMED=""
MODEL_CEILING="frontier"
CEILING_HIT="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --budget)        BUDGET="${2:-}";         shift 2 ;;
    --consumed)      CONSUMED="${2:-}";       shift 2 ;;
    --model-ceiling) MODEL_CEILING="${2:-}";  shift 2 ;;
    --ceiling-hit)   CEILING_HIT="true";      shift   ;;
    *) echo "flight-report-fields: unknown flag: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$BUDGET" || -z "$CONSUMED" ]]; then
  echo "usage: adas flight-report-fields --budget <N> --consumed <N> [options]" >&2
  exit 2
fi

REMAINING=$(( BUDGET - CONSUMED ))
if [[ "$REMAINING" -lt 0 ]]; then REMAINING=0; fi

printf 'token_budget:      %s\n' "$BUDGET"
printf 'tokens_consumed:   %s\n' "$CONSUMED"
printf 'budget_remaining:  %s\n' "$REMAINING"
printf 'budget_ceiling_hit: %s\n' "$CEILING_HIT"
printf 'model_ceiling:     %s\n' "$MODEL_CEILING"
