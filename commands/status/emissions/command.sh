#!/usr/bin/env bash
# SPDX-License-Identifier: 0BSD
# status emissions — recent entity emissions from daemon
#
# Usage:
#   juno status emissions                     Last 10 across kingdom
#   juno status emissions --entity juno       Filter by entity
#   juno status emissions --type warning      Filter by type (notice|warning|error|request)
#   juno status emissions --json              Raw API JSON

set -euo pipefail

_JSON=""; _ENTITY=""; _TYPE=""; _LIMIT=10
while [ $# -gt 0 ]; do
  case "$1" in
    --json)   _JSON=1; shift ;;
    --entity) _ENTITY="$2"; shift 2 ;;
    --type)   _TYPE="$2"; shift 2 ;;
    --limit)  _LIMIT="$2"; shift 2 ;;
    -h|--help) sed -n '3,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) shift ;;
  esac
done

_DAEMON_URL="${KOAD_IO_DAEMON_URL:-http://10.10.10.10:28282}"

_path="/api/emissions?limit=$_LIMIT"
[ -n "$_ENTITY" ] && _path="$_path&entity=$_ENTITY"
[ -n "$_TYPE" ] && _path="$_path&type=$_TYPE"

_R=$'\033[0m'; _b=$'\033[1m'; _dim=$'\033[2m'
_c=$'\033[0;36m'; _y=$'\033[0;33m'; _r=$'\033[0;31m'; _bl=$'\033[0;34m'

if ! _raw=$(curl -sSf --max-time 3 "$_DAEMON_URL$_path" 2>&1); then
  echo "status emissions: daemon unreachable at $_DAEMON_URL" >&2
  exit 2
fi

if [ -n "$_JSON" ]; then
  printf '%s\n' "$_raw"
  exit 0
fi

command -v jq >/dev/null 2>&1 || { echo "status emissions: jq required" >&2; exit 69; }

_count=$(echo "$_raw" | jq -r '.count // 0')

printf '%semissions%s  %s%s most recent' "$_b" "$_R" "$_dim" "$_count"
[ -n "$_ENTITY" ] && printf ' · entity=%s' "$_ENTITY"
[ -n "$_TYPE" ] && printf ' · type=%s' "$_TYPE"
printf '%s\n\n' "$_R"

if [ "$_count" = "0" ]; then
  printf '  %snone%s\n' "$_dim" "$_R"
  exit 0
fi

_now=$(date +%s)

echo "$_raw" | jq -r '
  .emissions[] | [
    .timestamp,
    .entity,
    .type,
    .body
  ] | @tsv' | while IFS=$'\t' read -r _ts _entity _type _body_text; do

  # Age
  _age_fmt=""
  if [ -n "$_ts" ]; then
    _ts_s=$(date -d "$_ts" +%s 2>/dev/null || echo "$_now")
    _age=$((_now - _ts_s))
    if [ "$_age" -lt 60 ]; then _age_fmt="${_age}s"
    elif [ "$_age" -lt 3600 ]; then _age_fmt="$((_age/60))m"
    elif [ "$_age" -lt 86400 ]; then _age_fmt="$((_age/3600))h"
    else _age_fmt="$((_age/86400))d"
    fi
  fi

  _c_type="$_dim"
  case "$_type" in
    warning) _c_type="$_y" ;;
    error)   _c_type="$_r" ;;
    request) _c_type="$_c" ;;
    notice)  _c_type="$_bl" ;;
  esac

  printf '  %s%5s ago%s  %s%-10s%s  %s[%-7s]%s  %s\n' \
    "$_dim" "$_age_fmt" "$_R" \
    "$_c" "$_entity" "$_R" \
    "$_c_type" "$_type" "$_R" \
    "$(echo "$_body_text" | head -c 100)"
done

# Self-documenting footer — lists subs/flags on TTY, silent when piped.
# shellcheck source=/dev/null
source "$HOME/.koad-io/helpers/discovery.sh" 2>/dev/null && _koad_io_hint
