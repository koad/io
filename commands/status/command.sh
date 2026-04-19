#!/usr/bin/env bash
# SPDX-License-Identifier: 0BSD
#
# status — kingdom operational pulse via the daemon
#
# Reads the daemon's read-only API and formats human-readable summaries.
# The daemon binds inside the ZeroTier/Netbird walled garden (typically
# 10.10.10.10:28282); this command trusts that posture — no auth.
#
# Usage:
#   juno status                     Overview: daemon + flights + emissions
#   juno status daemon              Daemon self-check (health, counts)
#   juno status flights [--entity X] [--all]
#                                   Active flights (or all with --all)
#   juno status emissions [--entity X] [--type warning]
#                                   Recent emissions (default: last 10)
#   juno status passengers          Entity index the daemon has learned
#   juno status kingdom             Wider picture (flights + atlas + stale)
#
# Common flags:
#   --json                          Raw API JSON, no formatting
#
# Exit codes:
#   0 success
#   2 daemon unreachable
#   64 bad args

set -euo pipefail

# --- Parse ---
_SUB=""
_JSON=""
_ENTITY=""
_TYPE=""
_ALL=""

while [ $# -gt 0 ]; do
  case "$1" in
    --json)    _JSON=1; shift ;;
    --entity)  _ENTITY="$2"; shift 2 ;;
    --type)    _TYPE="$2"; shift 2 ;;
    --all)     _ALL=1; shift ;;
    -h|--help)
      sed -n '3,24p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    --*)       shift ;; # ignore unknown flags upstream
    *)         [ -z "$_SUB" ] && _SUB="$1"; shift ;;
  esac
done

# --- Daemon URL ---
_DAEMON_URL="${KOAD_IO_DAEMON_URL:-http://10.10.10.10:28282}"

# --- Colors ---
_R=$'\033[0m'
_b=$'\033[1m'
_dim=$'\033[2m'
_c=$'\033[0;36m'
_y=$'\033[0;33m'
_g=$'\033[0;32m'
_r=$'\033[0;31m'

# --- Helpers ---

# Reach the daemon; exit 2 if down.
_require_jq() {
  command -v jq >/dev/null 2>&1 || { echo "status: jq required" >&2; exit 69; }
}

_fetch() {
  local _path="$1"
  local _out
  if ! _out=$(curl -sSf --max-time 3 "$_DAEMON_URL$_path" 2>&1); then
    echo "status: daemon unreachable at $_DAEMON_URL ($_out)" >&2
    exit 2
  fi
  printf '%s' "$_out"
}

_fmt_age_s() {
  local s="$1"
  if [ "$s" -lt 60 ]; then printf '%ds' "$s"
  elif [ "$s" -lt 3600 ]; then printf '%dm' $((s/60))
  elif [ "$s" -lt 86400 ]; then printf '%dh%dm' $((s/3600)) $(((s%3600)/60))
  else printf '%dd' $((s/86400))
  fi
}

# NOTE: subcommand dispatch is handled by the framework itself — running
# `juno status daemon` walks into commands/status/daemon/command.sh
# automatically. This top-level file only fires when no subcommand was
# given, or when a positional name didn't match a subfolder.

if [ -n "$_SUB" ]; then
  echo "status: unknown subcommand '$_SUB'" >&2
  echo "available: daemon, flights, emissions, passengers, kingdom" >&2
  exit 64
fi

# ============================================================================
# Overview mode — no subcommand
# ============================================================================

_require_jq

_health="$(_fetch /api/health)"

if [ -n "$_JSON" ]; then
  printf '%s\n' "$_health"
  exit 0
fi

printf '%s── kingdom status ──%s  %s%s%s\n' "$_b" "$_R" "$_dim" "$_DAEMON_URL" "$_R"
echo

# Daemon header
_host=$(echo "$_health" | jq -r '.hostname // "?"')
_uptime=$(echo "$_health" | jq -r '.uptime_s // 0')
_uptime_fmt=$(_fmt_age_s "$_uptime")
_ver=$(echo "$_health" | jq -r '.node // "?"')
_flights_total=$(echo "$_health" | jq -r '.counts.flights // 0')
_emissions_total=$(echo "$_health" | jq -r '.counts.emissions // 0')
_passengers_total=$(echo "$_health" | jq -r '.counts.passengers // 0')

printf '  %sdaemon%s     %s%s%s  %sup %s  node %s  pid %s%s\n' \
  "$_dim" "$_R" "$_b" "$_host" "$_R" \
  "$_dim" "$_uptime_fmt" "$_ver" "$(echo "$_health" | jq -r '.pid')" "$_R"

printf '  %scounts%s     %s%s%s flights  %s%s%s emissions  %s%s%s passengers\n' \
  "$_dim" "$_R" "$_b" "$_flights_total" "$_R" \
  "$_b" "$_emissions_total" "$_R" \
  "$_b" "$_passengers_total" "$_R"

# Active flights
_active="$(_fetch /api/flights/active)"
_active_count=$(echo "$_active" | jq -r '.count // 0')
echo
printf '  %sactive%s     ' "$_dim" "$_R"
if [ "$_active_count" = "0" ]; then
  printf '%sno flights airborne%s\n' "$_dim" "$_R"
else
  printf '%s%s flight%s%s\n' "$_b" "$_active_count" "$([ "$_active_count" != "1" ] && echo s)" "$_R"
  echo "$_active" | jq -r '.flights[] | "  \(.entity)\t\(.briefSlug // "?")\t\(.status)"' | while IFS=$'\t' read -r _e _s _st; do
    _c_st="$_dim"
    [ "$_st" = "stale" ] && _c_st="$_r"
    [ "$_st" = "flying" ] && _c_st="$_g"
    printf '    %s%s%s  %s%s%s  %s[%s]%s\n' \
      "$_c" "$_e" "$_R" "$_y" "$_s" "$_R" "$_c_st" "$_st" "$_R"
  done
fi

# Recent emissions
_em="$(_fetch /api/emissions?limit=5)"
_em_count=$(echo "$_em" | jq -r '.count // 0')
echo
printf '  %srecent%s     ' "$_dim" "$_R"
if [ "$_em_count" = "0" ]; then
  printf '%sno emissions%s\n' "$_dim" "$_R"
else
  printf '%s%s emission%s%s\n' "$_b" "$_em_count" "$([ "$_em_count" != "1" ] && echo s)" "$_R"
  echo "$_em" | jq -r '.emissions[] | "\(.timestamp)\t\(.entity)\t\(.type)\t\(.body)"' | while IFS=$'\t' read -r _ts _e _t _b_text; do
    _c_t="$_dim"
    [ "$_t" = "warning" ] && _c_t="$_y"
    [ "$_t" = "error" ] && _c_t="$_r"
    [ "$_t" = "request" ] && _c_t="$_c"
    printf '    %s%s%s  %s[%s]%s  %s\n' \
      "$_c" "$_e" "$_R" "$_c_t" "$_t" "$_R" "$(echo "$_b_text" | head -c 80)"
  done
fi

echo
printf '%ssubcommands: daemon | flights | emissions | passengers | kingdom%s\n' "$_dim" "$_R"

# Self-documenting footer — lists subs/flags on TTY, silent when piped.
# shellcheck source=/dev/null
source "$HOME/.koad-io/helpers/discovery.sh" 2>/dev/null && _koad_io_hint
