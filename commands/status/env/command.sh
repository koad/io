#!/usr/bin/env bash
# SPDX-License-Identifier: 0BSD
# status env — entity environment variables (sensitive keys redacted)
#
# Usage:
#   juno status env                    All entities (summary)
#   juno status env --entity=X         One entity's vars
#   juno status env --json             Raw API JSON

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

if ! _raw=$(curl -sSf --max-time 3 "$_DAEMON_URL/api/env${_Q}" 2>&1); then
  echo "status env: daemon unreachable at $_DAEMON_URL" >&2
  exit 2
fi

if [ -n "$_JSON" ]; then
  printf '%s\n' "$_raw"
  exit 0
fi

command -v jq >/dev/null 2>&1 || { echo "status env: jq required" >&2; exit 69; }

_R=$'\033[0m'; _b=$'\033[1m'; _dim=$'\033[2m'; _c=$'\033[0;36m'
_count=$(echo "$_raw" | jq -r '.count // 0')
printf '%senv%s  %s%s entities indexed%s\n\n' "$_b" "$_R" "$_dim" "$_count" "$_R"

if [ -n "$_ENTITY" ]; then
  echo "$_raw" | jq -r '.env[0].vars // {} | to_entries[] | "\(.key)\t\(.value)"' | \
    while IFS=$'\t' read -r _k _v; do
      printf '  %s%-40s%s %s%s%s\n' "$_dim" "$_k" "$_R" "$_c" "$_v" "$_R"
    done
else
  echo "$_raw" | jq -r '.env[] | "\(.handle)\t\(.role // "-")\t\(.harness // "-")"' | \
    sort | while IFS=$'\t' read -r _h _r _ha; do
      printf '  %s%-16s%s %srole=%s%s  %sharness=%s%s\n' "$_c" "$_h" "$_R" "$_dim" "$_r" "$_R" "$_dim" "$_ha" "$_R"
    done
fi

# shellcheck source=/dev/null
source "$HOME/.koad-io/helpers/discovery.sh" 2>/dev/null && _koad_io_hint
