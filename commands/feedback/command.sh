#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# feedback — drop a system observation for Salus and Janus to review
#
# Writes a timestamped markdown file to ~/.forge/feedback/ and fires a
# feedback.filed emission. Salus and Janus pick these up via standing
# watchers or `search feedback`.
#
# Usage:
#   koad-io feedback "dirty working trees blocking heals again"
#   juno feedback "observed drift in juno color registry"
#   koad-io feedback --severity warn "bond gate completion gap"
#
# File lands at:
#   ~/.forge/feedback/<UTC-timestamp>-<from>-<slug>.md
#
# Emission:
#   type: feedback.filed
#   meta.payload: { from, slug, path, severity }
#
# Severity:
#   info   (default) — observation, note, low urgency
#   warn   — something degrading, should be looked at soon
#   error  — broken, needs immediate attention

set -euo pipefail

_EMIT_PY="${HOME}/.koad-io/helpers/emit.py"

# --- flags + args ---
QUIET=false
SEVERITY=info
POSITIONAL=()

for _arg in "$@"; do
  case "$_arg" in
    --quiet)              QUIET=true ;;
    --severity=*)         SEVERITY="${_arg#--severity=}" ;;
    --severity)           ;; # next arg consumed below
    --warn)               SEVERITY=warn ;;
    --error)              SEVERITY=error ;;
    --*)                  ;; # ignore unknown flags
    *)                    POSITIONAL+=("$_arg") ;;
  esac
done
unset _arg

# Handle --severity <value> (space form)
for _i in "${!POSITIONAL[@]}"; do
  if [[ "${POSITIONAL[$_i]}" == "--severity" ]]; then
    # Next positional is the value, if it exists and isn't part of body
    _next=$((_i + 1))
    if [[ ${#POSITIONAL[@]} -gt $_next ]]; then
      case "${POSITIONAL[$_next]}" in
        info|warn|error)
          SEVERITY="${POSITIONAL[$_next]}"
          unset "POSITIONAL[$_i]"
          unset "POSITIONAL[$_next]"
          ;;
      esac
    fi
    break
  fi
done
# Rebuild POSITIONAL without gaps
POSITIONAL=("${POSITIONAL[@]}")

# --- validate ---
if [ "${#POSITIONAL[@]}" -lt 1 ]; then
  echo "koad-io feedback: body required" >&2
  echo "  Usage: koad-io feedback [--severity info|warn|error] <body...>" >&2
  echo "  Example: koad-io feedback \"dirty working trees again\"" >&2
  echo "  Short:   koad-io feedback --warn \"something degrading\"" >&2
  exit 1
fi

BODY="${POSITIONAL[*]}"

# --- resolve sender ---
FROM="${ENTITY:-}"
if [ -z "$FROM" ]; then
  FROM="${USER:-unknown}"
fi

# --- slug from first ~6 words of body ---
SLUG=$(echo "$BODY" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9[:space:]-]//g' | tr -s '[:space:]' '\n' | grep -v '^$' | head -6 | paste -sd '-' - | cut -c1-70)
[ -z "$SLUG" ] && SLUG="feedback"

# --- timestamp ---
TIMESTAMP=$(date -u +"%Y%m%dT%H%M%SZ")
ISO_TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# --- file path ---
FILENAME="${TIMESTAMP}-${FROM}-${SLUG}.md"
FEEDBACK_DIR="${HOME}/.forge/feedback"
mkdir -p "$FEEDBACK_DIR"
FILE_PATH="${FEEDBACK_DIR}/${FILENAME}"

# --- write ---
cat > "$FILE_PATH" <<FEOF
---
from: ${FROM}
severity: ${SEVERITY}
timestamp: ${ISO_TS}
status: open
---

${BODY}
FEOF

# --- emit ---
META_JSON=$(jq -n \
  --arg from "$FROM" \
  --arg slug "$SLUG" \
  --arg path "$FILE_PATH" \
  --arg severity "$SEVERITY" \
  '{payload: {from: $from, slug: $slug, path: $path, severity: $severity}}')

python3 "$_EMIT_PY" emit feedback.filed "${FROM}: ${BODY:0:120}" --meta "$META_JSON" 2>/dev/null || true

# --- output ---
if [ "$QUIET" = false ]; then
  echo "$FILE_PATH"
fi

exit 0
