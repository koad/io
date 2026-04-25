#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# emit status — set the current activity headline on the active emission
#
# Replaces the status_line field on the emission each time it is called.
# Use this to narrate what's happening right now. The storefront pane and
# active-flights dashboard render this live via the DDP feed.
#
# Usage:
#   koad-io emit status "diagnosing the failing test"
#   koad-io emit status "tests passing, building release"
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
  echo "emit status: KOAD_IO_EMISSION_ID is not set" >&2
  echo "  Set it to the _id of an open emission before calling this command." >&2
  exit 1
fi

if [ -z "$TEXT" ]; then
  echo "emit status: text argument is required" >&2
  echo "  Usage: koad-io emit status \"what I am doing right now\"" >&2
  exit 1
fi

# --- emit ---
python3 "$_EMIT_PY" status-line "$TEXT" --id "$KOAD_IO_EMISSION_ID" 2>/dev/null || true

if [ "$QUIET" = false ]; then
  echo "emit status: ${TEXT}"
fi

source "${HOME}/.koad-io/helpers/discovery.sh" 2>/dev/null && _koad_io_hint
