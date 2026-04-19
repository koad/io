#!/usr/bin/env bash
# SPDX-License-Identifier: 0BSD
# status passengers — entity index the daemon has learned from the filesystem
#
# Usage:
#   juno status passengers             All entities
#   juno status passengers --json      Raw API JSON

set -euo pipefail

_JSON=""
while [ $# -gt 0 ]; do
  case "$1" in
    --json) _JSON=1; shift ;;
    -h|--help) sed -n '3,7p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) shift ;;
  esac
done

_DAEMON_URL="${KOAD_IO_DAEMON_URL:-http://10.10.10.10:28282}"
_R=$'\033[0m'; _b=$'\033[1m'; _dim=$'\033[2m'; _c=$'\033[0;36m'

if ! _raw=$(curl -sSf --max-time 3 "$_DAEMON_URL/api/passengers" 2>&1); then
  echo "status passengers: daemon unreachable at $_DAEMON_URL" >&2
  exit 2
fi

if [ -n "$_JSON" ]; then
  printf '%s\n' "$_raw"
  exit 0
fi

command -v jq >/dev/null 2>&1 || { echo "status passengers: jq required" >&2; exit 69; }

_count=$(echo "$_raw" | jq -r '.count // 0')
printf '%spassengers%s  %s%s entities indexed%s\n\n' "$_b" "$_R" "$_dim" "$_count" "$_R"

# 4 columns
_names=$(echo "$_raw" | jq -r '.passengers[].handle' | sort)
echo "$_names" | awk '
  { a[NR]=$0 }
  END {
    n=NR
    cols=4
    rows=int((n + cols - 1) / cols)
    for (r=1; r<=rows; r++) {
      line="  "
      for (c=0; c<cols; c++) {
        i = r + c*rows
        if (i <= n) line = line sprintf("\033[0;36m%-14s\033[0m", a[i])
      }
      print line
    }
  }
'
