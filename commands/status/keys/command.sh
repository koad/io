#!/usr/bin/env bash
# SPDX-License-Identifier: 0BSD
# status keys — key presence per entity (filenames only, never contents)
#
# Usage:
#   juno status keys                   All entities
#   juno status keys --entity=X        Filter to one entity
#   juno status keys --json            Raw API JSON

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

if ! _raw=$(curl -sSf --max-time 3 "$_DAEMON_URL/api/keys${_Q}" 2>&1); then
  echo "status keys: daemon unreachable at $_DAEMON_URL" >&2
  exit 2
fi

if [ -n "$_JSON" ]; then
  printf '%s\n' "$_raw"
  exit 0
fi

command -v jq >/dev/null 2>&1 || { echo "status keys: jq required" >&2; exit 69; }

_R=$'\033[0m'; _b=$'\033[1m'; _dim=$'\033[2m'; _c=$'\033[0;36m'
_count=$(echo "$_raw" | jq -r '.count // 0')
printf '%skeys%s  %s%s entities with key inventory%s\n\n' "$_b" "$_R" "$_dim" "$_count" "$_R"

echo "$_raw" | jq -r '.keys[] | "\(.handle)\t\(.count)\t\(.keys | map(.type) | unique | join(", "))"' | \
  sort | while IFS=$'\t' read -r _h _n _types; do
    printf '  %s%-16s%s %s%s key(s)%s  %s[%s]%s\n' "$_c" "$_h" "$_R" "$_dim" "$_n" "$_R" "$_dim" "$_types" "$_R"
  done

# shellcheck source=/dev/null
source "$HOME/.koad-io/helpers/discovery.sh" 2>/dev/null && _koad_io_hint
