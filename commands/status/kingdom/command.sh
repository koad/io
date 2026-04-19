#!/usr/bin/env bash
# SPDX-License-Identifier: 0BSD
# status kingdom — wider operational picture
#
# Combines daemon telemetry with filesystem state via the `search` tool.
# More expensive than plain `status` — walks every entity's briefs/. Use
# this as a Monday-morning view or after-hours check-in.
#
# Usage:
#   juno status kingdom              Full picture
#   juno status kingdom --json       Daemon parts as JSON (fs parts still text)

set -euo pipefail

_JSON=""
while [ $# -gt 0 ]; do
  case "$1" in
    --json) _JSON=1; shift ;;
    -h|--help) sed -n '3,13p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) shift ;;
  esac
done

_SELF_DIR="$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")"
_STATUS_DIR="$(dirname "$_SELF_DIR")"

_R=$'\033[0m'; _b=$'\033[1m'; _dim=$'\033[2m'

# Section 1: daemon snapshot
if [ -n "$_JSON" ]; then
  "$_STATUS_DIR/daemon/command.sh" --json
  "$_STATUS_DIR/flights/command.sh" --json
  exit 0
fi

printf '%s══ kingdom ══%s\n\n' "$_b" "$_R"

"$_STATUS_DIR/daemon/command.sh" || true
echo

"$_STATUS_DIR/flights/command.sh" || true
echo

# Section 2: filesystem atlas — delegate to search tool
if command -v search >/dev/null 2>&1 || [ -x "$HOME/.koad-io/bin/search" ]; then
  _search_bin="${HOME}/.koad-io/bin/search"
  printf '%satlas%s  %s(frontmattered work across the kingdom)%s\n' "$_b" "$_R" "$_dim" "$_R"
  # Summary of --atlas only (the last two lines of the tool: "— summary —" + counts)
  "$_search_bin" --atlas 2>/dev/null | tail -3 | sed 's/^/  /'
  echo
fi

# Section 3: stale open loops via search
if [ -x "$HOME/.koad-io/bin/search" ]; then
  _stale_out=$("$HOME/.koad-io/bin/search" --stale 7 2>/dev/null || true)
  _stale_count=$(echo "$_stale_out" | grep -cE "untouched$" || true)
  if [ "$_stale_count" -gt 0 ] 2>/dev/null; then
    printf '%sstale%s      %s%s items untouched >7 days (status not done)%s\n' \
      "$_b" "$_R" "$_dim" "$_stale_count" "$_R"
    printf '  %srun: search --stale 7%s\n' "$_dim" "$_R"
  fi
fi
