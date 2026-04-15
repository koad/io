#!/bin/bash
# adas memory-pass-report — emit memory_pass: instrumentation block for flight reports
#
# VESTA-SPEC-103 §11.5 + VESTA-SPEC-107 §5.1
# Emits the YAML instrumentation block that ADAS loops must include in their flight reports.
# This feeds Copia's cost tracking.
#
# Usage:
#   adas memory-pass-report \
#     --consumed <N>          tokens consumed during this memory pass
#     --budget <N>            token ceiling for this pass (0 = unconstrained)
#     --files-read <N>        number of memory files read
#     --files-archived <N>    number of memory files archived
#     --files-merged <N>      number of memory files merged
#     [--ceiling-hit]         flag: ceiling was reached during this pass
#
# Output (stdout): YAML block ready to append to a flight report
#
# Example output:
#   memory_pass:
#     tokens_consumed: 4200
#     budget_ceiling: 20000
#     files_read: 18
#     files_archived: 3
#     files_merged: 1
#     budget_ceiling_hit: false

set -euo pipefail

CONSUMED=""
BUDGET="0"
FILES_READ="0"
FILES_ARCHIVED="0"
FILES_MERGED="0"
CEILING_HIT="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --consumed)       CONSUMED="${2:-}";       shift 2 ;;
    --budget)         BUDGET="${2:-0}";        shift 2 ;;
    --files-read)     FILES_READ="${2:-0}";    shift 2 ;;
    --files-archived) FILES_ARCHIVED="${2:-0}"; shift 2 ;;
    --files-merged)   FILES_MERGED="${2:-0}";  shift 2 ;;
    --ceiling-hit)    CEILING_HIT="true";      shift   ;;
    *) echo "memory-pass-report: unknown flag: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$CONSUMED" ]]; then
  echo "usage: adas memory-pass-report --consumed <N> [options]" >&2
  exit 2
fi

printf 'memory_pass:\n'
printf '  tokens_consumed: %s\n' "$CONSUMED"
printf '  budget_ceiling: %s\n' "$BUDGET"
printf '  files_read: %s\n' "$FILES_READ"
printf '  files_archived: %s\n' "$FILES_ARCHIVED"
printf '  files_merged: %s\n' "$FILES_MERGED"
printf '  budget_ceiling_hit: %s\n' "$CEILING_HIT"
