#!/usr/bin/env bash
# PRIMITIVE: emission-stream-log
# KIND: trigger
# TRIGGER: {"type":["error","warning"]}
# EVENT: any
# DEBOUNCE: 3
#
# Purpose: Auditor role stream logger. Records error and warning emissions to a
#          dated daily log file for later grep and audit analysis. Files are
#          stored at ~/.entity/streams/<YYYY-MM-DD>.log
#
# Idempotent: log append is naturally idempotent. Debounce=3 reduces flood risk.
# No emit calls — pure file output, no side effects on the emission bus.
#
# Env vars available from daemon trigger runner:
#   EMISSION_ENTITY  — entity that emitted
#   EMISSION_BODY    — body text
#   EMISSION_ID      — emission _id
#   EMISSION_TYPE    — "error" or "warning" (matches trigger selector)
#   ENTITY           — the entity this script runs as

set -euo pipefail

if [ -z "${EMISSION_ENTITY:-}" ] || [ -z "${EMISSION_BODY:-}" ]; then
  exit 0
fi

STREAMS_DIR="$HOME/streams"
mkdir -p "$STREAMS_DIR"

DATE_TAG="$(date +%Y-%m-%d)"
LOG_FILE="$STREAMS_DIR/${DATE_TAG}.log"

printf '[%s] type=%-7s entity=%-20s id=%s body=%s\n' \
  "$(date -Iseconds)" \
  "${EMISSION_TYPE:-unknown}" \
  "${EMISSION_ENTITY}" \
  "${EMISSION_ID:-unknown}" \
  "${EMISSION_BODY}" \
  >> "$LOG_FILE"
