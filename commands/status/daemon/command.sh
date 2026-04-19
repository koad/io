#!/usr/bin/env bash
# SPDX-License-Identifier: 0BSD
# status daemon — health check on the daemon itself
#
# Usage:
#   juno status daemon          Health summary
#   juno status daemon --json   Raw API payload

set -euo pipefail

_JSON=""
while [ $# -gt 0 ]; do
  case "$1" in
    --json) _JSON=1; shift ;;
    -h|--help)
      sed -n '3,8p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) shift ;;
  esac
done

_DAEMON_URL="${KOAD_IO_DAEMON_URL:-http://10.10.10.10:28282}"

_R=$'\033[0m'; _b=$'\033[1m'; _dim=$'\033[2m'
_g=$'\033[0;32m'; _r=$'\033[0;31m'

if ! _raw=$(curl -sSf --max-time 3 "$_DAEMON_URL/api/health" 2>&1); then
  printf '  %sdaemon%s     %sUNREACHABLE%s  %sat %s%s\n' \
    "$_dim" "$_R" "$_r" "$_R" "$_dim" "$_DAEMON_URL" "$_R"
  exit 2
fi

if [ -n "$_JSON" ]; then
  printf '%s\n' "$_raw"
  exit 0
fi

command -v jq >/dev/null 2>&1 || { echo "status daemon: jq required" >&2; exit 69; }

printf '%sdaemon%s  %s%s%s\n\n' "$_b" "$_R" "$_dim" "$_DAEMON_URL" "$_R"

_host=$(echo "$_raw" | jq -r '.hostname')
_pid=$(echo "$_raw" | jq -r '.pid')
_node=$(echo "$_raw" | jq -r '.node')
_uptime=$(echo "$_raw" | jq -r '.uptime_s')
_time=$(echo "$_raw" | jq -r '.time')

_up_fmt=""
if [ "$_uptime" -lt 60 ]; then _up_fmt="${_uptime}s"
elif [ "$_uptime" -lt 3600 ]; then _up_fmt="$((_uptime/60))m"
elif [ "$_uptime" -lt 86400 ]; then _up_fmt="$((_uptime/3600))h$(((_uptime%3600)/60))m"
else _up_fmt="$((_uptime/86400))d$(((_uptime%86400)/3600))h"
fi

_status=$(echo "$_raw" | jq -r '.status')
_ready=$(echo "$_raw" | jq -r '.ready // false')

if [ "$_ready" = "true" ]; then
  printf '  %sstatus%s     %sok%s\n' "$_dim" "$_R" "$_g" "$_R"
else
  printf '  %sstatus%s     %sstarting%s\n' "$_dim" "$_R" "$_r" "$_R"
fi
printf '  %shost%s       %s\n'     "$_dim" "$_R" "$_host"
printf '  %suptime%s     %s\n'     "$_dim" "$_R" "$_up_fmt"
printf '  %spid%s        %s\n'     "$_dim" "$_R" "$_pid"
printf '  %snode%s       %s\n'     "$_dim" "$_R" "$_node"
printf '  %stime%s       %s\n'     "$_dim" "$_R" "$_time"

_indexer_count=$(echo "$_raw" | jq '.indexers | length')
if [ "$_indexer_count" -gt 0 ] 2>/dev/null; then
  echo
  printf '  %sindexers%s\n' "$_dim" "$_R"
  echo "$_raw" | jq -r '.indexers | to_entries[] | "\(.key)\t\(.value)"' | while IFS=$'\t' read -r _k _v; do
    printf '    %s%-14s%s %s%s%s\n' "$_dim" "$_k" "$_R" "$_g" "$_v" "$_R"
  done
fi

echo
printf '  %scollections%s\n' "$_dim" "$_R"
echo "$_raw" | jq -r '.counts | to_entries[] | "    \(.key)\t\(.value)"' | while IFS=$'\t' read -r _k _v; do
  printf '    %s%-12s%s %s%s%s\n' "$_dim" "$_k" "$_R" "$_b" "$_v" "$_R"
done

# Self-documenting footer — lists subs/flags on TTY, silent when piped.
# shellcheck source=/dev/null
source "$HOME/.koad-io/helpers/discovery.sh" 2>/dev/null && _koad_io_hint
