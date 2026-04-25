#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# emit note — append a timeline note to the active emission
#
# Notes are push-only (never replaced). Each call appends to the notes[]
# array on the emission document. Use this to record key observations,
# decisions, or events as work proceeds. The storefront renders notes as
# an ordered timeline alongside the current status_line.
#
# Usage:
#   koad-io emit note "root cause: stale cache in build layer"
#   koad-io emit note "confirmed fix on staging, moving to prod"
#
# Flags:
#   --quiet    Suppress stdout confirmation
#
# Requires:
#   KOAD_IO_EMISSION_ID  — _id of the open emission to update
#   KOAD_IO_EMIT=1       — emission gate (silently no-ops if unset)

set -euo pipefail

_EMIT_PY="${HOME}/.koad-io/helpers/emit.py"

# --- flags ---
QUIET=false
TEXT=""

for _arg in "$@"; do
  case "$_arg" in
    --quiet) QUIET=true ;;
    --*)     ;; # ignore unknown flags
    *)       [ -z "$TEXT" ] && TEXT="$_arg" ;;
  esac
done
unset _arg

# --- gate checks ---
if [ -z "${KOAD_IO_EMISSION_ID:-}" ]; then
  echo "emit note: KOAD_IO_EMISSION_ID is not set" >&2
  echo "  Set it to the _id of an open emission before calling this command." >&2
  exit 1
fi

if [ -z "$TEXT" ]; then
  echo "emit note: text argument is required" >&2
  echo "  Usage: koad-io emit note \"observation or decision to record\"" >&2
  exit 1
fi

# --- emit ---
python3 "$_EMIT_PY" note "$TEXT" --id "$KOAD_IO_EMISSION_ID" 2>/dev/null || true

if [ "$QUIET" = false ]; then
  echo "emit note: ${TEXT}"
fi

source "${HOME}/.koad-io/helpers/discovery.sh" 2>/dev/null && _koad_io_hint
