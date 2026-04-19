#!/usr/bin/env bash
# SPDX-License-Identifier: 0BSD
# status entities — all entities detected by the daemon
#
# Usage:
#   juno status entities               All entities
#   juno status entities --json        Raw API JSON
#   juno status entities --role=X      Filter by role

set -euo pipefail

_JSON="" _ROLE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --json) _JSON=1; shift ;;
    --role=*) _ROLE="${1#--role=}"; shift ;;
    -h|--help) sed -n '3,9p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) shift ;;
  esac
done

_DAEMON_URL="${KOAD_IO_DAEMON_URL:-http://10.10.10.10:28282}"
_Q=""
[ -n "$_ROLE" ] && _Q="?role=$_ROLE"

if ! _raw=$(curl -sSf --max-time 3 "$_DAEMON_URL/api/entities${_Q}" 2>&1); then
  echo "status entities: daemon unreachable at $_DAEMON_URL" >&2
  exit 2
fi

if [ -n "$_JSON" ]; then
  printf '%s\n' "$_raw"
  exit 0
fi

command -v jq >/dev/null 2>&1 || { echo "status entities: jq required" >&2; exit 69; }

_R=$'\033[0m'; _b=$'\033[1m'; _dim=$'\033[2m'; _c=$'\033[0;36m'
_count=$(echo "$_raw" | jq -r '.count // 0')
printf '%sentities%s  %s%s detected%s\n\n' "$_b" "$_R" "$_dim" "$_count" "$_R"

echo "$_raw" | jq -r '.entities[] | "\(.handle)\t\(.role // "-")\t\(.tagline // "-")"' | \
  sort | while IFS=$'\t' read -r _h _r _t; do
    printf '  %s%-16s%s %s%-14s%s %s%s%s\n' "$_c" "$_h" "$_R" "$_dim" "$_r" "$_R" "$_dim" "$_t" "$_R"
  done

# shellcheck source=/dev/null
source "$HOME/.koad-io/helpers/discovery.sh" 2>/dev/null && _koad_io_hint
