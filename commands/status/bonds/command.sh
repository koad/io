#!/usr/bin/env bash
# SPDX-License-Identifier: 0BSD
# status bonds — trust bond index from the daemon
#
# Usage:
#   juno status bonds                  All entities' bonds
#   juno status bonds --entity=X       Filter to one entity
#   juno status bonds --json           Raw API JSON

set -euo pipefail

_JSON="" _ENTITY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --json) _JSON=1; shift ;;
    --entity=*) _ENTITY="${1#--entity=}"; shift ;;
    -h|--help) sed -n '3,9p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) shift ;;
  esac
done

_DAEMON_URL="${KOAD_IO_DAEMON_URL:-http://10.10.10.10:28282}"
_Q=""
[ -n "$_ENTITY" ] && _Q="?entity=$_ENTITY"

if ! _raw=$(curl -sSf --max-time 3 "$_DAEMON_URL/api/bonds${_Q}" 2>&1); then
  echo "status bonds: daemon unreachable at $_DAEMON_URL" >&2
  exit 2
fi

if [ -n "$_JSON" ]; then
  printf '%s\n' "$_raw"
  exit 0
fi

command -v jq >/dev/null 2>&1 || { echo "status bonds: jq required" >&2; exit 69; }

_R=$'\033[0m'; _b=$'\033[1m'; _dim=$'\033[2m'; _c=$'\033[0;36m'; _y=$'\033[0;33m'
_count=$(echo "$_raw" | jq -r '.count // 0')
_xcount=$(echo "$_raw" | jq -r '.crossKingdom.count // 0')
printf '%sbonds%s  %s%s entities indexed, %s cross-kingdom%s\n\n' "$_b" "$_R" "$_dim" "$_count" "$_xcount" "$_R"

echo "$_raw" | jq -r '.bonds[] | "\(.handle)\t\(.count)"' | \
  sort | while IFS=$'\t' read -r _h _c; do
    printf '  %s%-16s%s %s%s bond(s)%s\n' "$_c" "$_h" "$_R" "$_dim" "$_c" "$_R"
  done

if [ "$_xcount" -gt 0 ]; then
  echo
  printf '  %scross-kingdom%s\n' "$_y" "$_R"
  echo "$_raw" | jq -r '.crossKingdom.bonds[] | "  \(.fromEntity) → \(.toEntity // "?") [\(.bondType // "unknown")]"'
fi

# shellcheck source=/dev/null
source "$HOME/.koad-io/helpers/discovery.sh" 2>/dev/null && _koad_io_hint
