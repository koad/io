#!/usr/bin/env bash
#
# statusline — koad:io Claude Code statusline
#
# Kingdom-aware. Starship-inspired. Adaptive-width. Colored.
# Reads the JSON payload Claude Code pipes on stdin, emits one ANSI-colored
# line of entity identity + brand + session telemetry.
#
# Placement:
#   ~/.koad-io/commands/harness/claude/statusline.sh
#
# Wiring (in settings.json):
#   {
#     "statusLine": {
#       "type": "command",
#       "command": "/home/koad/.koad-io/commands/harness/claude/statusline.sh"
#     }
#   }
#
# Companion: statusline-probe.sh in the same directory captures raw
# payloads to ~/.<entity>/state/ for debugging. Use when adding new
# segments or diagnosing payload shape changes across Claude Code
# versions.
#
# Exposed payload fields (Claude Code 2.1.x):
#   .model.{id, display_name}
#   .cost.{total_cost_usd, total_duration_ms, total_api_duration_ms,
#          total_lines_added, total_lines_removed}
#   .context_window.{used_percentage, remaining_percentage,
#                    context_window_size, current_usage.*}
#   .rate_limits.{five_hour, seven_day}.{used_percentage, resets_at}
#   .version, .output_style.name, .cwd, .workspace.*
#   .session_id, .transcript_path, .exceeds_200k_tokens

set +e
umask 077

# --- Read stdin payload ---------------------------------------------------

PAYLOAD=""
[ ! -t 0 ] && PAYLOAD="$(timeout 1s cat 2>/dev/null || true)"

# --- ANSI colors ----------------------------------------------------------

_R=$'\033[0m'          # reset
_B=$'\033[1m'          # bold
_D=$'\033[2m'          # dim
_FB=$'\033[1;37m'      # bold white
_FC=$'\033[1;36m'      # bright cyan
_FM=$'\033[1;35m'      # bright magenta
_FL=$'\033[1;34m'      # bright blue
_FY=$'\033[33m'        # yellow
_FG=$'\033[32m'        # green
_FR=$'\033[31m'        # red
_FW=$'\033[37m'        # white
_FDIM=$'\033[2;37m'    # dim white

# Graduated color by percentage: <60 green, 60-84 yellow, 85+ red
pct_color() {
  local p="$1"
  p="${p%\%}"
  p="${p%.*}"
  [ -z "$p" ] && { printf '%s' "$_FW"; return; }
  if [ "$p" -lt 60 ] 2>/dev/null; then printf '%s' "$_FG"
  elif [ "$p" -lt 85 ] 2>/dev/null; then printf '%s' "$_FY"
  else printf '%s' "$_FR"
  fi
}

# --- Entity + host resolution --------------------------------------------

_entity="${ENTITY:-unscoped}"
_host="${ENTITY_HOST:-$(hostname -s 2>/dev/null || hostname 2>/dev/null || echo ?)}"

# If $ENTITY wasn't exported, derive from CLAUDE_CONFIG_DIR path
if [ "$_entity" = "unscoped" ] && [ -n "$CLAUDE_CONFIG_DIR" ]; then
  case "$CLAUDE_CONFIG_DIR" in
    "$HOME"/.*)
      _cand="${CLAUDE_CONFIG_DIR#$HOME/.}"
      _cand="${_cand%%/*}"
      [ -n "$_cand" ] && _entity="$_cand"
      ;;
  esac
fi

# --- Terminal width detection --------------------------------------------
# Claude Code doesn't pipe COLUMNS to the statusline hook. Fall back to
# tput and default to a reasonable narrow baseline if nothing works.

_cols="${COLUMNS:-0}"
[ "$_cols" -eq 0 ] && _cols="$(tput cols 2>/dev/null || echo 0)"
[ "$_cols" -eq 0 ] && _cols=80

# --- Parse payload in one jq call ----------------------------------------

_model_display=""
_cost_usd=""
_ctx_pct=""
_5h_pct=""
_7d_pct=""
_dur_ms=""
_api_ms=""
_lines_add=""
_lines_del=""
_cc_version=""

if [ -n "$PAYLOAD" ] && command -v jq >/dev/null 2>&1; then
  # Tab-separated single-call extraction; avoids per-field jq invocations.
  _line_tsv=$(printf '%s' "$PAYLOAD" | jq -r '[
    (.model.display_name // .model.id // ""),
    (.cost.total_cost_usd // ""),
    (.context_window.used_percentage // ""),
    (.rate_limits.five_hour.used_percentage // ""),
    (.rate_limits.seven_day.used_percentage // ""),
    (.cost.total_duration_ms // ""),
    (.cost.total_api_duration_ms // ""),
    (.cost.total_lines_added // ""),
    (.cost.total_lines_removed // ""),
    (.version // "")
  ] | @tsv' 2>/dev/null)

  IFS=$'\t' read -r _model_display _cost_usd _ctx_pct _5h_pct _7d_pct _dur_ms _api_ms _lines_add _lines_del _cc_version <<<"$_line_tsv"
fi

# --- Model short name (opus / sonnet / haiku) ----------------------------

_model_short="$_model_display"
case "$_model_short" in
  *Opus*|*opus*)     _model_short="opus" ;;
  *Sonnet*|*sonnet*) _model_short="sonnet" ;;
  *Haiku*|*haiku*)   _model_short="haiku" ;;
  claude-*)          _model_short="${_model_short#claude-}" ;;
esac
[ -z "$_model_short" ] && _model_short="?"

# --- Cost display --------------------------------------------------------

_cost_display=""
if [ -n "$_cost_usd" ]; then
  _cost_display=$(awk -v c="$_cost_usd" 'BEGIN{printf "$%.2f", c}' 2>/dev/null)
fi

# --- Duration display (humanized) ----------------------------------------

humanize_ms() {
  local ms="$1"
  [ -z "$ms" ] || [ "$ms" = "0" ] && return
  local sec
  sec=$(awk -v m="$ms" 'BEGIN{printf "%d", m/1000}' 2>/dev/null)
  [ -z "$sec" ] || [ "$sec" -lt 1 ] 2>/dev/null && return
  if [ "$sec" -lt 60 ]; then
    printf '%ds' "$sec"
  elif [ "$sec" -lt 3600 ]; then
    printf '%dm' "$((sec / 60))"
  else
    printf '%dh%dm' "$((sec / 3600))" "$(((sec % 3600) / 60))"
  fi
}

_dur_display="$(humanize_ms "$_dur_ms")"
_api_display="$(humanize_ms "$_api_ms")"
# Combined "api/wall" form: 13m/56m
_time_display=""
if [ -n "$_dur_display" ] && [ -n "$_api_display" ]; then
  _time_display="${_api_display}/${_dur_display}"
elif [ -n "$_dur_display" ]; then
  _time_display="$_dur_display"
fi

# --- Build segments (each colored, separator-free) -----------------------

_sep="${_D} · ${_R}"

# Row 1 — identity and brand (always prominent)
_brand="${_FC}◊${_R} ${_FB}koad:io${_R}"
_ident="${_FM}${_entity}${_R}${_D}@${_R}${_FL}${_host}${_R}"
_model_seg="${_FY}${_model_short}${_R}"
_version_seg=""
[ -n "$_cc_version" ] && _version_seg="${_D}v${_cc_version}${_R}"

# Row 2 — session telemetry
_ctx_seg=""
if [ -n "$_ctx_pct" ]; then
  _c=$(pct_color "$_ctx_pct")
  _ctx_seg="${_D}ctx${_R} ${_c}${_ctx_pct}%${_R}"
fi

_cost_seg=""
[ -n "$_cost_display" ] && _cost_seg="${_FDIM}${_cost_display}${_R}"

_5h_seg=""
if [ -n "$_5h_pct" ]; then
  _c=$(pct_color "$_5h_pct")
  _5h_seg="${_D}5h${_R} ${_c}${_5h_pct}%${_R}"
fi

_7d_seg=""
if [ -n "$_7d_pct" ]; then
  _c=$(pct_color "$_7d_pct")
  _7d_seg="${_D}7d${_R} ${_c}${_7d_pct}%${_R}"
fi

_time_seg=""
[ -n "$_time_display" ] && _time_seg="${_FDIM}${_time_display}${_R}"

_diff_seg=""
if [ -n "$_lines_add" ] && [ -n "$_lines_del" ]; then
  if [ "${_lines_add:-0}" -gt 0 ] 2>/dev/null || [ "${_lines_del:-0}" -gt 0 ] 2>/dev/null; then
    _diff_seg="${_FG}+${_lines_add}${_R}${_D}/${_R}${_FR}-${_lines_del}${_R}"
  fi
fi

# --- Compose — two rows, each width-adaptive -----------------------------
#
# Row 1 (identity):   brand · entity@host · model [· version at >=100]
# Row 2 (telemetry):  ctx% · cost · 5h% [· 7d% at >=95] [· dur at >=115] [· diff at >=135]
#
# Thresholds are lower than single-row because each row has its own width
# budget. A 14" zoomed laptop (~90 cols) sees a rich two-row line; wider
# monitors pick up version + 7d + duration + diff cleanly.
#
# Row 3 is reserved for the soft-error channel (harness-warnings.jsonl)
# and renders only when warnings are present.

_row1="${_brand}${_sep}${_ident}${_sep}${_model_seg}"
if [ "$_cols" -ge 100 ] && [ -n "$_version_seg" ]; then
  _row1="${_row1}${_sep}${_version_seg}"
fi

_row2=""
[ -n "$_ctx_seg"  ] && _row2="${_ctx_seg}"
if [ -n "$_cost_seg" ]; then
  [ -n "$_row2" ] && _row2="${_row2}${_sep}${_cost_seg}" || _row2="${_cost_seg}"
fi
if [ -n "$_5h_seg" ]; then
  [ -n "$_row2" ] && _row2="${_row2}${_sep}${_5h_seg}" || _row2="${_5h_seg}"
fi
if [ "$_cols" -ge 95 ] && [ -n "$_7d_seg" ]; then
  _row2="${_row2}${_sep}${_7d_seg}"
fi
if [ "$_cols" -ge 115 ] && [ -n "$_time_seg" ]; then
  _row2="${_row2}${_sep}${_time_seg}"
fi
if [ "$_cols" -ge 135 ] && [ -n "$_diff_seg" ]; then
  _row2="${_row2}${_sep}${_diff_seg}"
fi

# --- Emit (newline-separated rows) ---------------------------------------
# Claude Code renders each \n as a new statusline row. Row 2 omitted if
# nothing populated it (no jq / no payload / first-ever probe).

printf '%s' "$_row1"
if [ -n "$_row2" ]; then
  printf '\n%s' "$_row2"
fi
exit 0
