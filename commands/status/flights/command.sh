#!/usr/bin/env bash
# SPDX-License-Identifier: 0BSD
# status flights — list flights from daemon telemetry
#
# Usage:
#   juno status flights                   Active flights (flying + stale)
#   juno status flights --all             All flights, newest first
#   juno status flights --entity vulcan   Filter by entity
#   juno status flights --json            Raw API JSON

set -euo pipefail

_JSON=""; _ENTITY=""; _ALL=""
while [ $# -gt 0 ]; do
  case "$1" in
    --json)   _JSON=1; shift ;;
    --entity) _ENTITY="$2"; shift 2 ;;
    --all)    _ALL=1; shift ;;
    -h|--help) sed -n '3,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) shift ;;
  esac
done

_DAEMON_URL="${KOAD_IO_DAEMON_URL:-http://10.10.10.10:28282}"

# Build URL
_path="/api/flights/active"
if [ -n "$_ALL" ]; then
  _path="/api/flights?limit=50"
  [ -n "$_ENTITY" ] && _path="$_path&entity=$_ENTITY"
elif [ -n "$_ENTITY" ]; then
  # Active + entity filter — fall back to /api/flights with status filter
  _path="/api/flights?status=flying&entity=$_ENTITY"
fi

_R=$'\033[0m'; _b=$'\033[1m'; _dim=$'\033[2m'
_c=$'\033[0;36m'; _y=$'\033[0;33m'; _g=$'\033[0;32m'; _r=$'\033[0;31m'

if ! _raw=$(curl -sSf --max-time 3 "$_DAEMON_URL$_path" 2>&1); then
  echo "status flights: daemon unreachable at $_DAEMON_URL" >&2
  exit 2
fi

if [ -n "$_JSON" ]; then
  printf '%s\n' "$_raw"
  exit 0
fi

command -v jq >/dev/null 2>&1 || { echo "status flights: jq required" >&2; exit 69; }

_count=$(echo "$_raw" | jq -r '.count // 0')
_label="active"
[ -n "$_ALL" ] && _label="recent"

printf '%sflights%s  %s%s (%s)%s\n\n' "$_b" "$_R" "$_dim" "$_label" "$_count" "$_R"

if [ "$_count" = "0" ]; then
  printf '  %snone%s\n' "$_dim" "$_R"
  exit 0
fi

# Now = seconds since epoch for elapsed calc
_now=$(date +%s)

echo "$_raw" | jq -r '
  .flights[] | [
    .entity,
    (.briefSlug // "?"),
    .status,
    (.started // ""),
    (.host // ""),
    (.model // "")
  ] | @tsv' | while IFS=$'\t' read -r _entity _slug _status _started _host _model; do

  # Elapsed
  _elapsed_fmt=""
  if [ -n "$_started" ]; then
    _started_s=$(date -d "$_started" +%s 2>/dev/null || echo "$_now")
    _el=$((_now - _started_s))
    if [ "$_el" -lt 60 ]; then _elapsed_fmt="${_el}s"
    elif [ "$_el" -lt 3600 ]; then _elapsed_fmt="$((_el/60))m"
    elif [ "$_el" -lt 86400 ]; then _elapsed_fmt="$((_el/3600))h$(((_el%3600)/60))m"
    else _elapsed_fmt="$((_el/86400))d"
    fi
  fi

  # Status color
  _c_st="$_dim"
  case "$_status" in
    flying) _c_st="$_g" ;;
    stale)  _c_st="$_r" ;;
    landed) _c_st="$_dim" ;;
  esac

  printf '  %s%-10s%s %s%-40s%s %s[%s]%s %s%7s%s' \
    "$_c" "$_entity" "$_R" \
    "$_y" "$(echo "$_slug" | head -c 40)" "$_R" \
    "$_c_st" "$_status" "$_R" \
    "$_dim" "$_elapsed_fmt" "$_R"

  if [ -n "$_host" ]; then
    printf '  %s@%s%s' "$_dim" "$_host" "$_R"
  fi
  if [ -n "$_model" ]; then
    printf '  %s%s%s' "$_dim" "$_model" "$_R"
  fi
  echo
done
