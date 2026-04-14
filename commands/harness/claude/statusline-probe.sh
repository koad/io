#!/usr/bin/env bash
# SPDX-License-Identifier: 0BSD
#
# statusline-probe — koad:io statusline for Claude Code (discovery phase)
#
# Placement:
#   ~/.koad-io/commands/harness/claude/statusline-probe.sh
#
# Wiring (one or both):
#   ~/.claude/settings.json        — applies to every claude session koad runs
#   ~/.<entity>/settings.json      — applies when CLAUDE_CONFIG_DIR=~/.<entity>
#                                    (set by 'harness/claude' for rooted entities
#                                    or by KOAD_IO_ROOM for portable rooms)
#
# Shape:
#   {
#     "statusLine": {
#       "type": "command",
#       "command": "/home/koad/.koad-io/commands/harness/claude/statusline-probe.sh"
#     }
#   }
#
# What this does:
#   1. Reads the JSON payload Claude Code pipes on stdin (per-turn session state)
#   2. Writes the raw payload + surrounding env to the entity's state/ dir
#      for offline inspection (this is the "probe" part — we don't yet know
#      what fields Claude exposes in its statusline hook payload; capturing
#      it lets us design the real display without guessing)
#   3. Appends a one-line log entry so we can verify it fires every turn
#   4. Emits a minimal one-line status to stdout with whatever we could
#      extract — entity identity + brand tag + best-effort model/cost/context
#
# Constraints:
#   - Must be FAST (runs every turn; >200ms visibly lags the TUI)
#   - Must NOT crash (exit 0 on any error; emit *something* to stdout)
#   - Must be defensive about env (works with or without $ENTITY/$ENTITY_DIR)
#   - Must work on wonderland (Linux) and fourty4/flowbie (macOS)
#
# Once the payload shape is known from the probe dumps, a sibling
# statusline.sh takes over as the display surface and this script stays
# as a debug tool.

set +e  # never crash — always return a line
umask 077  # state files are per-user

# --- Read stdin payload ---------------------------------------------------
# Claude Code pipes a JSON object on stdin. Capture everything.
# Time-box the read so a stuck pipe can't hang the TUI.

PAYLOAD=""
if [ ! -t 0 ]; then
  PAYLOAD="$(timeout 1s cat 2>/dev/null || true)"
fi

# --- Resolve entity + host -----------------------------------------------

_entity="${ENTITY:-unscoped}"
_host="${ENTITY_HOST:-$(hostname -s 2>/dev/null || hostname 2>/dev/null || echo unknown)}"

# If $ENTITY isn't set but CLAUDE_CONFIG_DIR points inside a ~/.<entity>
# directory, derive the entity name from the path. This covers the case
# where claude was launched via 'harness/claude' (which sets CLAUDE_CONFIG_DIR
# but may not re-export ENTITY in the claude child process).

if [ "$_entity" = "unscoped" ] && [ -n "$CLAUDE_CONFIG_DIR" ]; then
  case "$CLAUDE_CONFIG_DIR" in
    "$HOME"/.*)
      _candidate="${CLAUDE_CONFIG_DIR#$HOME/.}"
      _candidate="${_candidate%%/*}"
      [ -n "$_candidate" ] && _entity="$_candidate"
      ;;
  esac
fi

# --- Resolve state dir ----------------------------------------------------
# If $ENTITY_DIR is set and writable, use it. Otherwise fall back to
# CLAUDE_CONFIG_DIR (rooted entities) or /tmp (unscoped).

if [ -n "$ENTITY_DIR" ] && [ -d "$ENTITY_DIR" ] && [ -w "$ENTITY_DIR" ]; then
  _state_dir="$ENTITY_DIR/state"
elif [ -n "$CLAUDE_CONFIG_DIR" ] && [ -d "$CLAUDE_CONFIG_DIR" ] && [ -w "$CLAUDE_CONFIG_DIR" ]; then
  _state_dir="$CLAUDE_CONFIG_DIR/state"
else
  _state_dir="/tmp/koad-io-probe-${USER:-$(id -un 2>/dev/null || echo user)}"
fi

mkdir -p "$_state_dir" 2>/dev/null

_ts="$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo unknown)"
_payload_file="$_state_dir/statusline-probe-payload.json"
_log_file="$_state_dir/statusline-probe.log"

# --- Write envelope + payload to disk ------------------------------------
# Envelope wraps the raw Claude payload with entity-side context so we can
# see not just what Claude sent, but what the entity env looked like when
# the statusline fired. If jq is available, round-trip the payload through
# it for pretty-printing; otherwise emit as-is.

_payload_for_file="${PAYLOAD:-null}"
if [ -z "$PAYLOAD" ]; then
  _payload_for_file="null"
fi

{
  printf '{\n'
  printf '  "probe_ts": "%s",\n' "$_ts"
  printf '  "entity": "%s",\n' "$_entity"
  printf '  "host": "%s",\n' "$_host"
  printf '  "pid": %d,\n' "$$"
  printf '  "env": {\n'
  printf '    "CLAUDE_CONFIG_DIR": "%s",\n' "${CLAUDE_CONFIG_DIR:-}"
  printf '    "ENTITY": "%s",\n' "${ENTITY:-}"
  printf '    "ENTITY_DIR": "%s",\n' "${ENTITY_DIR:-}"
  printf '    "ENTITY_HOST": "%s",\n' "${ENTITY_HOST:-}"
  printf '    "KOAD_IO_ROOTED": "%s",\n' "${KOAD_IO_ROOTED:-}"
  printf '    "KOAD_IO_ROOM": "%s",\n' "${KOAD_IO_ROOM:-}"
  printf '    "KOAD_IO_DIR": "%s",\n' "${KOAD_IO_DIR:-}"
  printf '    "PWD": "%s",\n' "${PWD:-}"
  printf '    "USER": "%s"\n' "${USER:-}"
  printf '  },\n'
  printf '  "payload_bytes": %d,\n' "${#PAYLOAD}"
  printf '  "payload": %s\n' "$_payload_for_file"
  printf '}\n'
} > "$_payload_file" 2>/dev/null

# Rolling log: one line per fire, useful for confirming the statusline
# is actually being invoked and at what cadence. Cap at 500 lines so it
# can never run away.

printf '%s  %-12s  %-12s  %5d bytes  pid=%d\n' \
  "$_ts" "$_entity" "$_host" "${#PAYLOAD}" "$$" >> "$_log_file" 2>/dev/null

if [ -f "$_log_file" ]; then
  _lines=$(wc -l < "$_log_file" 2>/dev/null || echo 0)
  if [ "${_lines:-0}" -gt 500 ]; then
    tail -n 400 "$_log_file" > "$_log_file.tmp" 2>/dev/null && \
      mv "$_log_file.tmp" "$_log_file" 2>/dev/null
  fi
fi

# --- Best-effort field extraction ----------------------------------------
# We don't yet know the real field names — try a bunch of candidates.
# All extraction is optional; missing fields render as '-'.

_model="-"
_cost="-"
_ctx_pct="-"
_field_count=0

if [ -n "$PAYLOAD" ] && command -v jq >/dev/null 2>&1; then
  _field_count=$(printf '%s' "$PAYLOAD" \
    | jq -r 'if type=="object" then (keys|length) else 0 end' 2>/dev/null)
  _field_count="${_field_count:-0}"

  _model=$(printf '%s' "$PAYLOAD" | jq -r '
    .model.display_name
    // .model.id
    // .model
    // "-"
  ' 2>/dev/null)
  [ -z "$_model" ] && _model="-"

  _cost_raw=$(printf '%s' "$PAYLOAD" | jq -r '
    .cost.total_cost_usd
    // .cost.total_cost
    // .total_cost_usd
    // empty
  ' 2>/dev/null)
  if [ -n "$_cost_raw" ]; then
    _cost=$(printf '$%.2f' "$_cost_raw" 2>/dev/null || echo "\$$_cost_raw")
  fi

  # Context usage — we don't know the field name, probe several candidates
  _ctx_raw=$(printf '%s' "$PAYLOAD" | jq -r '
    .context.used_tokens
    // .context.total_tokens
    // .usage.input_tokens
    // .total_tokens
    // empty
  ' 2>/dev/null)
  if [ -n "$_ctx_raw" ] && [ "$_ctx_raw" != "null" ]; then
    # Assume 200k window for now; real value comes from model metadata
    _ctx_pct=$(awk -v t="$_ctx_raw" 'BEGIN{printf "%d%%", (t/200000)*100}' 2>/dev/null)
  fi
fi

# --- Short model name (strip claude- prefix for display) -----------------

case "$_model" in
  claude-*) _model_short="${_model#claude-}" ;;
  *)        _model_short="$_model" ;;
esac

# --- Emit the status line ------------------------------------------------
# Format: ◊ koad:io · entity@host · model · ctx · cost · probe Nf/Mb
#
# The "probe Nf/Mb" suffix is temporary — once the payload shape is known,
# it goes away and a clean line replaces it. The leading ◊ and "koad:io"
# brand tag stay permanently.
#
# ANSI: dim the probe suffix so it visually reads as debug/WIP.

_line="◊ koad:io · ${_entity}@${_host} · ${_model_short}"
[ "$_ctx_pct" != "-" ] && _line="${_line} · ctx ${_ctx_pct}"
[ "$_cost"    != "-" ] && _line="${_line} · ${_cost}"
_line="${_line} $(printf '\033[2m')probe ${_field_count}f/${#PAYLOAD}b$(printf '\033[0m')"

printf '%s' "$_line"
exit 0
