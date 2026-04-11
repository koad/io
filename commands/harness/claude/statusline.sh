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
# No dim variants — koad's preference. Separators and "quiet" segments use
# plain white instead of \033[2m dim.

_R=$'\033[0m'          # reset
_B=$'\033[1m'          # bold
_SEP_C=$'\033[37m'     # separator color (plain white)
_FB=$'\033[1;37m'      # bold white
_FC=$'\033[1;36m'      # bright cyan (brand-tag fallback glyph color)
_FM=$'\033[1;35m'      # bright magenta
_FL=$'\033[1;34m'      # bright blue
_FY=$'\033[33m'        # yellow
_FG=$'\033[32m'        # green
_FR=$'\033[31m'        # red
_FW=$'\033[37m'        # white

# Backgrounds (used to flash row 2 as the context window fills).
_BG_Y=$'\033[43m'      # yellow background
_BG_R=$'\033[41m'      # red background

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

# Context-pressure background for row 2. Auto-compact triggers around ~85%,
# and it's expensive (and disruptive) when it lands mid-task. We flash
# yellow well before then and red when compact is imminent, so koad has
# visual warning to checkpoint or wind down before the harness blows it up.
#   >= 77%  → red background  (compact is very close)
#   >= 68%  → yellow background (time to think about ending the task)
#   else    → no background
ctx_bg() {
  local p="$1"
  p="${p%\%}"
  p="${p%.*}"
  [ -z "$p" ] && return
  if   [ "$p" -ge 77 ] 2>/dev/null; then printf '%s' "$_BG_R"
  elif [ "$p" -ge 68 ] 2>/dev/null; then printf '%s' "$_BG_Y"
  fi
}

# --- Entity outfit → glyph color -----------------------------------------
# Outfit lives in $ENTITY_DIR/passenger.json under .outfit.{h,s} (VESTA-063).
# Convert hue/sat (+ fixed brightness) to 24-bit truecolor so the ◊ brand
# glyph IS the entity's outfit color. Falls back to bright cyan if no
# outfit is set or jq/passenger is unavailable.

hsv_to_ansi() {
  # $1=hue (0-360), $2=sat (0-100), $3=val (0-100)
  awk -v h="$1" -v s="$2" -v v="$3" 'BEGIN{
    s=s/100; v=v/100;
    c=v*s; x=c*(1-((h/60)%2<0?-((h/60)%2):(h/60)%2 - 0));
    # The above mod is tricky in awk; use a manual fractional abs.
    hh=h/60; f=hh-int(hh/2)*2; if(f<0)f=-f; if(f>1)f=2-f;
    x=c*f; m=v-c;
    if      (h<60)  {r=c; g=x; b=0}
    else if (h<120) {r=x; g=c; b=0}
    else if (h<180) {r=0; g=c; b=x}
    else if (h<240) {r=0; g=x; b=c}
    else if (h<300) {r=x; g=0; b=c}
    else            {r=c; g=0; b=x}
    printf "\033[38;2;%d;%d;%dm", (r+m)*255, (g+m)*255, (b+m)*255
  }'
}

_entity_color=""
_entity_dir_for_outfit="${ENTITY_DIR:-}"
if [ -z "$_entity_dir_for_outfit" ] && [ -n "$CLAUDE_CONFIG_DIR" ] && [ -d "$CLAUDE_CONFIG_DIR" ]; then
  _entity_dir_for_outfit="$CLAUDE_CONFIG_DIR"
fi
if [ -n "$_entity_dir_for_outfit" ] && [ -r "$_entity_dir_for_outfit/passenger.json" ] && command -v jq >/dev/null 2>&1; then
  # Only emit a hue if one is actually set — otherwise the array collapses
  # and we'd accidentally colorize the glyph with the saturation default.
  _h=$(jq -r '.outfit.h // .outfit.hue // empty' "$_entity_dir_for_outfit/passenger.json" 2>/dev/null)
  _s=$(jq -r '.outfit.s // .outfit.saturation // 70'   "$_entity_dir_for_outfit/passenger.json" 2>/dev/null)
  if [ -n "$_h" ] && [ "$_h" != "null" ]; then
    _entity_color="$(hsv_to_ansi "$_h" "${_s:-70}" 95)"
  fi
fi
[ -z "$_entity_color" ] && _entity_color="$_FC"

# --- Sensor: tee payload to entity state (rooted entities only) ----------
# The framework statusline runs for every entity that wires it in
# settings.json. Roaming entities fire in arbitrary $CWDs that aren't the
# entity's sessions in any locational sense — recording their payloads
# would pollute state with unrelated sessions koad happens to run in other
# directories. Rooted entities (KOAD_IO_ROOTED=true in their .env) always
# open claude in $ENTITY_DIR, so a statusline firing there is definitively
# the entity's own session, and the sensor captures meaningful self-
# awareness data (context%, spend, 5h+7d rate limits, cost breakdown).
#
# Display still renders for everyone. Only the tee-to-state step is gated.
# Path is XDG-compliant: ~/.<entity>/.local/state/harness/last-payload.json
# Atomic tmp+rename so consumers never read a truncated file.
#
# See ~/.juno/memories (feedback_statusline_sensor_gating) for the rule.

if [ -n "$PAYLOAD" ] && [ -n "$_entity_dir_for_outfit" ] \
   && grep -Eq '^[[:space:]]*KOAD_IO_ROOTED[[:space:]]*=[[:space:]]*"?true"?[[:space:]]*$' \
        "$_entity_dir_for_outfit/.env" 2>/dev/null; then
  _sensor_dir="$_entity_dir_for_outfit/.local/state/harness"
  if mkdir -p "$_sensor_dir" 2>/dev/null; then
    _sensor_tmp="$_sensor_dir/.last-payload.json.tmp.$$"
    if printf '%s' "$PAYLOAD" > "$_sensor_tmp" 2>/dev/null; then
      mv -f "$_sensor_tmp" "$_sensor_dir/last-payload.json" 2>/dev/null \
        || rm -f "$_sensor_tmp" 2>/dev/null
    fi
  fi
fi

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

_sep="${_SEP_C} · ${_R}"

# Row 1 — identity and brand (always prominent). The ◊ glyph wears the
# entity's outfit color (hsv from passenger.json → truecolor), so the
# brand tag visually IS the entity.
_brand="${_entity_color}◊${_R} ${_FB}koad:io${_R}"
_ident="${_FM}${_entity}${_R}${_FW}@${_R}${_FL}${_host}${_R}"
_model_seg="${_FY}${_model_short}${_R}"
_version_seg=""
[ -n "$_cc_version" ] && _version_seg="${_FW}v${_cc_version}${_R}"

# Timestamp — YYYY:MM:DD:HH:MM:SS local time. Always visible; anchors
# the per-turn capture moment (statusline refreshes every turn).
_ts_now="$(date '+%Y:%m:%d:%H:%M:%S' 2>/dev/null)"
_ts_seg=""
[ -n "$_ts_now" ] && _ts_seg="${_FW}${_ts_now}${_R}"

# Row 2 — session telemetry
_ctx_seg=""
if [ -n "$_ctx_pct" ]; then
  _c=$(pct_color "$_ctx_pct")
  _ctx_seg="${_FW}ctx${_R} ${_c}${_ctx_pct}%${_R}"
fi

_cost_seg=""
[ -n "$_cost_display" ] && _cost_seg="${_FW}${_cost_display}${_R}"

_5h_seg=""
if [ -n "$_5h_pct" ]; then
  _c=$(pct_color "$_5h_pct")
  _5h_seg="${_FW}5h${_R} ${_c}${_5h_pct}%${_R}"
fi

_7d_seg=""
if [ -n "$_7d_pct" ]; then
  _c=$(pct_color "$_7d_pct")
  _7d_seg="${_FW}7d${_R} ${_c}${_7d_pct}%${_R}"
fi

_time_seg=""
[ -n "$_time_display" ] && _time_seg="${_FW}${_time_display}${_R}"

_diff_seg=""
if [ -n "$_lines_add" ] && [ -n "$_lines_del" ]; then
  if [ "${_lines_add:-0}" -gt 0 ] 2>/dev/null || [ "${_lines_del:-0}" -gt 0 ] 2>/dev/null; then
    _diff_seg="${_FG}+${_lines_add}${_R}${_FW}/${_R}${_FR}-${_lines_del}${_R}"
  fi
fi

# --- Compose — two rows, each width-adaptive -----------------------------
#
# Row 1 (identity):   brand · entity@host · model [· version at >=110] · timestamp
# Row 2 (telemetry):  ctx% · cost · 5h% [· 7d% at >=95] [· dur at >=115] [· diff at >=135]
#
# Timestamp (YYYY:MM:DD:HH:MM:SS — koad's canonical kingdom format) always
# renders on row 1 when available. It anchors each turn in wall time — the
# statusline refreshes per turn, so this doubles as a per-turn clock.
#
# Thresholds are lower than single-row because each row has its own width
# budget. A 14" zoomed laptop (~90 cols) sees a rich two-row line; wider
# monitors pick up version + 7d + duration + diff cleanly.
#
# Row 3 is reserved for the soft-error channel (harness-warnings.jsonl)
# and renders only when warnings are present.

_row1="${_brand}${_sep}${_ident}${_sep}${_model_seg}"
if [ "$_cols" -ge 110 ] && [ -n "$_version_seg" ]; then
  _row1="${_row1}${_sep}${_version_seg}"
fi
if [ -n "$_ts_seg" ]; then
  _row1="${_row1}${_sep}${_ts_seg}"
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

# Context pressure → row 2 gets a yellow/red background so koad sees the
# warning at a glance before auto-compact lands. Inline resets inside the
# row's segments would wipe the background, so we re-apply it after each
# reset and pad the ends with a space for visual weight.
_row2_bg="$(ctx_bg "$_ctx_pct")"
if [ -n "$_row2_bg" ] && [ -n "$_row2" ]; then
  _row2="${_row2_bg} ${_row2//${_R}/${_R}${_row2_bg}} ${_R}"
fi

# --- Emit (newline-separated rows) ---------------------------------------
# Claude Code renders each \n as a new statusline row. Row 2 omitted if
# nothing populated it (no jq / no payload / first-ever probe).

printf '%s' "$_row1"
if [ -n "$_row2" ]; then
  printf '\n%s' "$_row2"
fi
exit 0
