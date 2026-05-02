#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# emit results — set the results payload on the active emission
#
# Replaces the results field on the emission. Default content type is
# markdown. Call this when a unit of work completes to store the outcome.
# Results survive emission close and are lookup-able after the fact;
# they also render live on the storefront active-flights pane while open.
#
# Usage:
#   koad-io emit results "## Done\n\n- shipped X\n- verified Y"
#   koad-io emit results @/tmp/results.md
#   koad-io emit results @/path/to/report.md --type markdown
#
# The @path form reads the file from disk. Path must be absolute or
# relative to $PWD. The @ prefix is required to distinguish from inline text.
#
# Flags:
#   --type <type>   Content type for the results payload (default: markdown)
#   --quiet         Suppress stdout confirmation
#
# Requires:
#   HARNESS_EMISSION_ID  — _id of the open emission to update
#   KOAD_IO_EMIT=1       — emission gate (silently no-ops if unset)

set -euo pipefail

_EMIT_PY="${HOME}/.koad-io/helpers/emit.py"

# --- flags ---
QUIET=false
RESULTS_TYPE="markdown"
TEXT=""

for _arg in "$@"; do
  case "$_arg" in
    --quiet)   QUIET=true ;;
    --type=*)  RESULTS_TYPE="${_arg#--type=}" ;;
    --type)    ;; # value is next arg — handled below via shift-style parsing
    --*)       ;; # ignore unknown flags
    *)         [ -z "$TEXT" ] && TEXT="$_arg" ;;
  esac
done
unset _arg

# Second pass for --type <value> (space-separated form)
_prev=""
for _arg in "$@"; do
  if [ "$_prev" = "--type" ]; then
    RESULTS_TYPE="$_arg"
  fi
  _prev="$_arg"
done
unset _arg _prev

# --- gate checks ---
if [ -z "${HARNESS_EMISSION_ID:-}" ]; then
  echo "emit results: HARNESS_EMISSION_ID is not set" >&2
  echo "  Set it to the _id of an open emission before calling this command." >&2
  exit 1
fi

if [ -z "$TEXT" ]; then
  echo "emit results: text or @path argument is required" >&2
  echo "  Usage: koad-io emit results \"## markdown content\"" >&2
  echo "         koad-io emit results @/path/to/file.md" >&2
  exit 1
fi

# --- resolve @path ---
PAYLOAD="$TEXT"
if [[ "$TEXT" == @* ]]; then
  _path="${TEXT#@}"
  if [ ! -f "$_path" ]; then
    echo "emit results: file not found: ${_path}" >&2
    exit 1
  fi
  PAYLOAD="$(cat "$_path")"
fi

# --- emit ---
python3 "$_EMIT_PY" results "$PAYLOAD" --id "$HARNESS_EMISSION_ID" --type "$RESULTS_TYPE" 2>/dev/null || true

if [ "$QUIET" = false ]; then
  _preview="${PAYLOAD:0:80}"
  [ "${#PAYLOAD}" -gt 80 ] && _preview="${_preview}..."
  echo "emit results [${RESULTS_TYPE}]: ${_preview}"
fi

source "${HOME}/.koad-io/helpers/discovery.sh" 2>/dev/null && _koad_io_hint
