#!/usr/bin/env bash
# SPDX-License-Identifier: 0BSD
# status alerts — active alerts and notifications from entity watchers
#
# Usage:
#   juno status alerts                 All entities
#   juno status alerts --entity=X      Filter to one entity
#   juno status alerts --json          Raw API JSON

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

if ! _raw=$(curl -sSf --max-time 3 "$_DAEMON_URL/api/alerts${_Q}" 2>&1); then
  echo "status alerts: daemon unreachable at $_DAEMON_URL" >&2
  exit 2
fi

if [ -n "$_JSON" ]; then
  printf '%s\n' "$_raw"
  exit 0
fi

command -v jq >/dev/null 2>&1 || { echo "status alerts: jq required" >&2; exit 69; }

_R=$'\033[0m'; _b=$'\033[1m'; _dim=$'\033[2m'; _c=$'\033[0;36m'; _r=$'\033[0;31m'; _y=$'\033[0;33m'
_count=$(echo "$_raw" | jq -r '.count // 0')
printf '%salerts%s  %s%s active source(s)%s\n\n' "$_b" "$_R" "$_dim" "$_count" "$_R"

if [ "$_count" -eq 0 ]; then
  printf '  %snone%s\n' "$_dim" "$_R"
else
  echo "$_raw" | jq -r '.alerts[] | "\(.entity)\t\(.source)\t\(.items | length)"' | \
    sort | while IFS=$'\t' read -r _h _s _n; do
      printf '  %s%-16s%s %s%-16s%s %s%s item(s)%s\n' "$_c" "$_h" "$_R" "$_y" "$_s" "$_R" "$_dim" "$_n" "$_R"
    done
fi

# shellcheck source=/dev/null
source "$HOME/.koad-io/helpers/discovery.sh" 2>/dev/null && _koad_io_hint
