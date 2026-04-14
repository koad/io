#!/usr/bin/env bash
# SPDX-License-Identifier: 0BSD
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

_5h_resets=""
_7d_resets=""
_payload_cwd=""

if [ -n "$PAYLOAD" ] && command -v jq >/dev/null 2>&1; then
  # Tab-separated single-call extraction; avoids per-field jq invocations.
  _line_tsv=$(printf '%s' "$PAYLOAD" | jq -r '[
    (.model.display_name // .model.id // ""),
    (.cost.total_cost_usd // ""),
    (.context_window.used_percentage // ""),
    (.rate_limits.five_hour.used_percentage // ""),
    (.rate_limits.seven_day.used_percentage // ""),
    (.rate_limits.five_hour.resets_at // ""),
    (.rate_limits.seven_day.resets_at // ""),
    (.cwd // .workspace.current_dir // "")
  ] | @tsv' 2>/dev/null)

  IFS=$'\t' read -r _model_display _cost_usd _ctx_pct _5h_pct _7d_pct _5h_resets _7d_resets _payload_cwd <<<"$_line_tsv"
fi
[ -z "$_payload_cwd" ] && _payload_cwd="$PWD"

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

# --- Rows 1 + 2: delegate to starship ------------------------------------
#
# koad's kingdom shell prompt (~/.config/starship.toml) renders:
#   Row 1: user on host with entity CWD       (muted "on"/"with" connectors)
#   Row 2: origin-url 🌱branch 📝×N 🏎️💨×M ... (git-state emoji glyphs)
#   Row 3: YY:MM:DD:HH:MM:SS ◊ provider model ctx cost  (entity ribbon)
#
# We reuse starship verbatim for rows 1 and 2 so the Claude Code statusline
# is visually identical to what koad sees at the shell — same identity
# tuple, same muted connectors, same emoji git state, same truncation,
# same colors. STARSHIP_SHELL=plain tells starship to skip zsh/bash prompt
# escape markers so the ANSI we get is directly emittable.
#
# Row 3 is ours: entity-colored-colon timestamp + entity ◊ glyph in the
# entity's outfit color (where the shell cursor would sit) + sensor
# telemetry (provider, model, ctx, cost) + optional quota warning when
# any rate limit window is almost full. The stats trail the ◊ like
# typed input, keeping the visual anchor at the cursor position even as
# the harness data scrolls past. Every koad:io entity wearing this
# statusline paints its own identity at that anchor — juno's ◊ is
# magenta-rose, vesta's is its own color, etc.
#
# Fallback: when starship isn't available (or cwd isn't a directory),
# we synthesize a minimal row 1 with the same "user on host with entity
# cwd" grammar manually.

_starship_rows=""
if command -v starship >/dev/null 2>&1 && [ -d "$_payload_cwd" ]; then
  _starship_raw=$(
    cd "$_payload_cwd" 2>/dev/null || exit 0
    ENTITY="${ENTITY:-$_entity}" \
    COLUMNS="$_cols" \
    STARSHIP_SHELL=plain \
      starship prompt 2>/dev/null
  )
  # Drop leading newline (starship's format starts with \n)
  _starship_raw="${_starship_raw#$'\n'}"
  # Drop the final line (starship's own timestamp + ❯ character row) —
  # we replace it with our sensor-enriched row 3.
  _starship_rows=$(printf '%s' "$_starship_raw" | sed '$d')
fi

if [ -z "$_starship_rows" ]; then
  _muted=$'\033[2;37m'
  _bright_user=$'\033[1;97m'
  _display_cwd="${_payload_cwd/#$HOME/~}"
  _starship_rows="${_bright_user}${USER:-koad}${_R} ${_muted}on${_R} ${_bright_user}${_host}${_R} ${_muted}with${_R} ${_bright_user}${_entity}${_R} ${_bright_user}${_display_cwd}${_R}"
fi

# --- Row 3: entity-colored timestamp + sensor + quota-if-close + ◊ -------

_sep="${_SEP_C} · ${_R}"

# Timestamp — kingdom format YY:MM:DD:HH:MM:SS, matching starship's
# time_format. Colons pick up the entity's outfit color so the separator
# IS the identity; digits stay in default white. Each ':' becomes a
# reset → entity-color → ':' → reset → white sequence so the next digit
# starts clean.
_ts_now="$(date '+%y:%m:%d:%H:%M:%S' 2>/dev/null)"
_ts_colored=""
if [ -n "$_ts_now" ]; then
  _colon="${_R}${_entity_color}:${_R}${_FW}"
  _ts_colored="${_FW}${_ts_now//:/$_colon}${_R}"
fi

# Provider — read from entity .env if not already in process env.
# For Claude Code this is effectively always "anthropic" but the hook
# is framework-shared; opencode-dispatched sessions wiring the same
# script will get their correct provider.
_provider="${ENTITY_DEFAULT_PROVIDER:-}"
if [ -z "$_provider" ] && [ -n "$_entity_dir_for_outfit" ] && [ -r "$_entity_dir_for_outfit/.env" ]; then
  _prov_line=$(grep -E '^[[:space:]]*ENTITY_DEFAULT_PROVIDER[[:space:]]*=' "$_entity_dir_for_outfit/.env" 2>/dev/null | tail -1)
  if [ -n "$_prov_line" ]; then
    _prov_val="${_prov_line#*=}"
    _prov_val="${_prov_val#\"}"; _prov_val="${_prov_val%\"}"
    _prov_val="${_prov_val#\'}"; _prov_val="${_prov_val%\'}"
    _provider="$_prov_val"
  fi
fi
[ -z "$_provider" ] && _provider="anthropic"

_provider_seg="${_FB}${_provider}${_R} ${_FB}${_model_short}${_R}"

_ctx_seg=""
if [ -n "$_ctx_pct" ]; then
  _c=$(pct_color "$_ctx_pct")
  _ctx_seg="${_FW}ctx${_R} ${_c}${_ctx_pct}%${_R}"
fi

_cost_seg=""
[ -n "$_cost_display" ] && _cost_seg="${_FB}${_cost_display}${_R}"

# Quota warning — shown only when a window is >= 75% used. Pairs the
# percentage with a countdown to reset, because "87%" alone doesn't
# say whether to slow down or burn through (it depends on how long
# until the window dies). Both windows shown if both are close;
# neither shown if both are comfortable.
_now_epoch=$(date +%s 2>/dev/null || echo 0)

fmt_countdown() {
  local epoch="$1"
  [ -z "$epoch" ] || [ "$epoch" = "0" ] && return
  local delta=$(( epoch - _now_epoch ))
  [ "$delta" -le 0 ] && return
  local mins=$(( delta / 60 ))
  if [ "$mins" -ge 1440 ]; then
    printf '%dd%dh' "$(( mins / 1440 ))" "$(( (mins % 1440) / 60 ))"
  elif [ "$mins" -ge 60 ]; then
    printf '%dh%dm' "$(( mins / 60 ))" "$(( mins % 60 ))"
  else
    printf '%dm' "$mins"
  fi
}

quota_seg() {
  local label="$1" pct="$2" resets="$3"
  [ -z "$pct" ] && return
  local pint="${pct%.*}"
  [ -z "$pint" ] && return
  [ "$pint" -lt 75 ] 2>/dev/null && return
  local c
  c=$(pct_color "$pct")
  local cd
  cd=$(fmt_countdown "$resets")
  if [ -n "$cd" ]; then
    printf '%s%s %s%%%s %s⏳%s%s' "$c" "$label" "$pint" "$_R" "$_FW" "$cd" "$_R"
  else
    printf '%s%s %s%%%s' "$c" "$label" "$pint" "$_R"
  fi
}

_5h_quota=$(quota_seg "5h" "$_5h_pct" "$_5h_resets")
_7d_quota=$(quota_seg "7d" "$_7d_pct" "$_7d_resets")

_quota_all=""
if [ -n "$_5h_quota" ]; then _quota_all="$_5h_quota"; fi
if [ -n "$_7d_quota" ]; then
  if [ -n "$_quota_all" ]; then
    _quota_all="${_quota_all}${_sep}${_7d_quota}"
  else
    _quota_all="$_7d_quota"
  fi
fi

# Entity glyph + entity color — replaces bash's green ❯ with the entity's
# ◊ in the entity's outfit color. Every entity wearing a koad:io statusline
# paints its own identity at the cursor anchor.
_char_glyph="${_entity_color}◊${_R}"

# Compose row 3: timestamp ◊ provider+model · ctx · cost [· quota]
_row3=""
append_row3() {
  local seg="$1"
  [ -z "$seg" ] && return
  if [ -z "$_row3" ]; then
    _row3="$seg"
  else
    _row3="${_row3}${_sep}${seg}"
  fi
}
# Stats first (provider · ctx · cost · quota), then prepend
# "timestamp ◊ " so the ◊ sits where bash would leave the cursor and
# the stats trail after like typed input.
append_row3 "$_provider_seg"
append_row3 "$_ctx_seg"
append_row3 "$_cost_seg"
append_row3 "$_quota_all"
if [ -n "$_ts_colored" ]; then
  if [ -n "$_row3" ]; then
    _row3="${_ts_colored} ${_char_glyph} ${_row3}"
  else
    _row3="${_ts_colored} ${_char_glyph}"
  fi
fi

# --- Emit ----------------------------------------------------------------
# Starship rows first (1 or 2 of them, depending on git context), then
# a newline, then our sensor row 3. Claude Code renders each \n as a
# new statusline row.

printf '%s\n%s' "$_starship_rows" "$_row3"
exit 0
