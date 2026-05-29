#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# harness/gemini — launch an entity through the Gemini CLI
#
# Upstream: https://github.com/google-gemini/gemini-cli
# Package:  @google/gemini-cli (npm)
#
# Usage: <entity> harness gemini [<model>] [prompt]
#
# Examples:
#   sibyl harness gemini
#   sibyl harness gemini gemini-2.5-pro "summarize briefs"
#   vesta harness gemini -p "one-shot task"
#
# Invariants:
#   - GEMINI_API_KEY must be set (or available via ~/.gemini/settings.json)
#   - --yolo always set in one-shot dispatch mode (auto-approve all actions)
#   - --session-id injects HARNESS_SESSION_ID as the Gemini session UUID
#   - KOAD_IO_ROOTED honored for cwd selection
#   - interactive when no prompt; -p one-shot when prompt present
#   - Session storage: ~/.gemini/history/<project-name>/ where project-name
#     = basename of the working directory (e.g. cwd=/home/koad/.juno → "juno")

set -e

# --- Emission helpers --------------------------------------------------------

if [ -f "$HOME/.koad-io/helpers/emit.sh" ]; then
  source "$HOME/.koad-io/helpers/emit.sh"
else
  koad_io_emit_update() { :; }
  koad_io_emit_open()   { :; }
  koad_io_emit_resume() { :; }
  koad_io_emit_close()  { :; }
fi

# --- Guard rails ----------------------------------------------------------

if [ -z "$ENTITY" ]; then
  echo "Error: \$ENTITY is not set. Invoke via an entity launcher (e.g. 'sibyl harness gemini ...')." >&2
  exit 64
fi

if [ -z "$ENTITY_DIR" ] || [ ! -d "$ENTITY_DIR" ]; then
  echo "Error: \$ENTITY_DIR not set or not a directory: '$ENTITY_DIR'" >&2
  exit 64
fi

GEMINI_BIN="${GEMINI_BIN:-gemini}"

if ! command -v "$GEMINI_BIN" >/dev/null 2>&1; then
  echo "Error: '$GEMINI_BIN' not found on PATH." >&2
  echo "  Install: npm install -g @google/gemini-cli" >&2
  echo "  Upstream: https://github.com/google-gemini/gemini-cli" >&2
  exit 69
fi

# --- API key check --------------------------------------------------------
#
# Gemini requires GEMINI_API_KEY. It may be configured in ~/.gemini/settings.json
# under the auth block (selectedType: gemini-api-key). Warn clearly if missing
# from env — the CLI will fail on first call, not here.

if [ -z "${GEMINI_API_KEY:-}" ]; then
  echo "Warning: GEMINI_API_KEY is not set in the environment." >&2
  echo "  The Gemini CLI may still work if credentials are configured via 'gemini auth'." >&2
  echo "  Check ~/.gemini/settings.json for auth configuration." >&2
fi

# --- Argument parsing -----------------------------------------------------

CONTINUE_FLAG=""
EXTRA_FLAGS=()
POSITIONAL=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --continue|-c)
      CONTINUE_FLAG="-c"
      shift
      ;;
    --prompt|-p)
      _prompt_flag="$1"
      shift
      if [ $# -eq 0 ]; then
        echo "Error: $_prompt_flag requires a prompt argument." >&2
        exit 64
      fi
      # Gather everything after -p/--prompt as the prompt (matches pi harness pattern).
      PROMPT="${PROMPT:-$*}"
      break
      ;;
    --prompt=*)
      PROMPT="${PROMPT:-${1#*=}}"
      shift
      ;;
    --)
      shift
      POSITIONAL+=("$@")
      break
      ;;
    -*)
      EXTRA_FLAGS+=("$1")
      shift
      ;;
    *)
      POSITIONAL+=("$1")
      shift
      ;;
  esac
done
set -- "${POSITIONAL[@]}"
unset POSITIONAL _prompt_flag

MODEL="${1:-${ENTITY_GEMINI_MODEL:-${KOAD_IO_GEMINI_MODEL:-${GEMINI_MODEL:-gemini-2.5-pro}}}}"
[ $# -gt 0 ] && shift

if [ -z "$PROMPT" ] && [ ! -t 0 ]; then
  PROMPT="$(cat)"
fi
PROMPT="${PROMPT:-$*}"

# --- Rooted vs roaming cwd ------------------------------------------------

if [ "${KOAD_IO_ROOTED:-false}" = "true" ]; then
  WORK_DIR="$ENTITY_DIR"
else
  WORK_DIR="${CWD:-$PWD}"
fi

cd "$WORK_DIR"

# --- Working folder guard -------------------------------------------------
# Refuse to start in home dir or any entity/dotfolder dir.
# These harnesses must run in an explicit project working folder.
# Skip when KOAD_IO_ROOTED=true — a rooted entity deliberately operates
# from its entity dir; that is intentional, not accidental.
if [ "${KOAD_IO_ROOTED:-false}" != "true" ]; then
  _work_dir_real="$(cd "$WORK_DIR" 2>/dev/null && pwd -P || echo "$WORK_DIR")"
  _home_real="$(cd "$HOME" 2>/dev/null && pwd -P || echo "$HOME")"
  _forbidden=false
  [ "$_work_dir_real" = "$_home_real" ] && _forbidden=true
  case "$_work_dir_real" in
    "$_home_real"/.*) _forbidden=true ;;
  esac
  if [ "$_forbidden" = "true" ]; then
    echo "Error: WORK_DIR '$WORK_DIR' is a home or entity directory." >&2
    echo "  Agent harnesses must run in an explicit project working folder." >&2
    echo "  Invoke from your project directory or pass an explicit --cwd." >&2
    exit 64
  fi
  unset _work_dir_real _home_real _forbidden
fi

# --- Context assembly (VESTA-SPEC-067) ------------------------------------
# Same startup.sh used by pi/claude harness. Assembles KOAD_IO.md → ENTITY.md
# → role primers → pre-emptive primitives into SYSTEM_PROMPT.

if [ -f "$HOME/.koad-io/harness/startup.sh" ]; then
  koad_io_emit_update "context assembly started"
  SYSTEM_PROMPT="$("$HOME/.koad-io/harness/startup.sh")" || {
    echo "Warning: startup.sh failed (exit $?), proceeding without context assembly" >&2
    koad_io_emit_update "context assembly failed"
  }
  export SYSTEM_PROMPT
  koad_io_emit_update "context assembly complete"
fi

# --- Harness PID + state dir + emissions ----------------------------------
#
# Mirrors the pi harness pattern:
#   - Write harness.pid for orphan detection by session-scanner
#   - Export HARNESS_PID, HARNESS_SESSION_ID, KOAD_IO_SPIRIT
#   - Export HARNESS_EMISSION_ID_FILE for resume support
# The EXIT trap always fires because we never `exec` gemini — gemini runs as a
# child process (same discipline as the pi harness).

_harness_pid_dir="$ENTITY_DIR/.local/state/harness"
_harness_pid_file="$_harness_pid_dir/harness.pid"
mkdir -p "$_harness_pid_dir" 2>/dev/null
echo $$ > "$_harness_pid_file" 2>/dev/null

export HARNESS_PID=$$
# Canonical session identity — inject as Gemini session UUID via --session-id.
# Format: <entity>-<harness-pid>. Unique per gemini instance.
export HARNESS_SESSION_ID="${ENTITY}-${HARNESS_PID}"
# Spirit — who's at the keyboard. Defaults to $USER until sovereign-login is wired.
export KOAD_IO_SPIRIT="${KOAD_IO_SPIRIT:-${USER:-unknown}}"

# Emission ID persists across resume (same as pi harness)
export HARNESS_EMISSION_ID_FILE="$_harness_pid_dir/emission.id"

_mode="interactive"
[ -n "$PROMPT" ] && _mode="one-shot"
_emit_type="session"
[ -n "$PROMPT" ] && _emit_type="flight"

# Session dir — Gemini stores sessions under ~/.gemini/history/<project-name>/
# where project-name = basename of the working directory.
_project_name="$(basename "$WORK_DIR")"
_gemini_session_dir="$HOME/.gemini/history/${_project_name}"

_emit_meta="{\"harness\":\"gemini\",\"model\":\"$MODEL\",\"pid\":$$,\"spirit\":\"$KOAD_IO_SPIRIT\",\"host\":\"$(hostname -s)\",\"cwd\":\"$WORK_DIR\",\"geminiSessionDir\":\"$_gemini_session_dir\"}"

if [ -f "$HARNESS_EMISSION_ID_FILE" ] && [ -n "$CONTINUE_FLAG" ]; then
  koad_io_emit_resume "resumed: gemini $MODEL ($_mode)" "$_emit_meta"
else
  koad_io_emit_open "$_emit_type" "harness opened: gemini $MODEL ($_mode)" "$_emit_meta"
fi

_gemini_gemini_md=""  # path of temp GEMINI.md written by this harness (cleared on exit)

_gemini_on_exit() {
  local rc=$?
  rm -f "$_harness_pid_file" 2>/dev/null
  [ -n "$_mcp_session_file" ] && rm -f "$_mcp_session_file" 2>/dev/null
  [ -n "$_gemini_gemini_md" ] && rm -f "$_gemini_gemini_md" 2>/dev/null
  [ -n "$_gemini_exit_emitted" ] && return
  _gemini_exit_emitted=1
  if [ "$rc" -eq 0 ]; then
    koad_io_emit_close "harness closed: gemini $MODEL ($_mode, clean exit)"
  elif [ "$rc" -eq 130 ]; then
    koad_io_emit_close "harness closed: gemini $MODEL ($_mode, interrupted)"
  else
    koad_io_emit_close "harness closed: gemini $MODEL ($_mode, exit $rc)"
  fi
}
trap _gemini_on_exit EXIT

# --- MCP session token pre-registration (VESTA-SPEC-139) ------------------
#
# Same pattern as the pi harness: pre-generate a UUID, write a session
# file to disk, export as KOAD_IO_MCP_SESSION_TOKEN. The dance-hall auth
# layer (auth.js) resolves Bearer tokens via disk scan on first MCP connect.
# Cleanup on EXIT removes the session file to avoid ghost sessions.

export KOAD_IO_MCP_SESSION_TOKEN=""
_mcp_session_file=""

_mcp_token=""
if [ -r /proc/sys/kernel/random/uuid ]; then
  _mcp_token="$(cat /proc/sys/kernel/random/uuid)"
elif command -v uuidgen >/dev/null 2>&1; then
  _mcp_token="$(uuidgen | tr '[:upper:]' '[:lower:]')"
fi

if [ -n "$_mcp_token" ]; then
  _mcp_sess_dir="$ENTITY_DIR/.local/state/harness/sessions"
  mkdir -p "$_mcp_sess_dir" 2>/dev/null
  _mcp_session_file="$_mcp_sess_dir/${_mcp_token}.json"
  cat > "$_mcp_session_file" <<MCPEOF
{"sessionId":"${_mcp_token}","entity":"${ENTITY}","harness":"gemini","host":"$(hostname -s)","pid":$$,"cwd":"${WORK_DIR}","createdAt":"$(date -u +%Y-%m-%dT%H:%M:%SZ)"}
MCPEOF
  export KOAD_IO_MCP_SESSION_TOKEN="$_mcp_token"
  echo "mcp_token     : ${_mcp_token:0:12}... (session file written)"
else
  echo "mcp_token     : uuid generation unavailable, MCP auth skipped" >&2
fi
unset _mcp_token _mcp_sess_dir

# Write dispatch-control.json with session dir (daemon scanners read this)
_dispatch_control_file="$_harness_pid_dir/dispatch-control.json"
_gemini_session_dir_for_json="$HOME/.gemini/history/${_project_name}"
jq -n \
  --arg geminiSessionDir "$_gemini_session_dir_for_json" \
  --arg harnessSessionId "$HARNESS_SESSION_ID" \
  --arg entity "$ENTITY" \
  --arg model "$MODEL" \
  --arg startedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '{geminiSessionDir: $geminiSessionDir, harnessSessionId: $harnessSessionId, entity: $entity, harness: "gemini", model: $model, startedAt: $startedAt}' \
  > "${_dispatch_control_file}.tmp.$$" && mv "${_dispatch_control_file}.tmp.$$" "$_dispatch_control_file"
export _DISPATCH_CONTROL_FILE="$_dispatch_control_file"
export WORK_DIR
export MODEL

# --- Announce -------------------------------------------------------------

echo
echo "harness       : gemini (@google/gemini-cli)"
echo "entity        : $ENTITY"
echo "entity_dir    : $ENTITY_DIR"
echo "work_dir      : $WORK_DIR"
echo "model         : $MODEL"
echo "session_id    : $HARNESS_SESSION_ID"
echo "session_dir   : $_gemini_session_dir"
if [ -n "$PROMPT" ]; then
  echo "mode          : one-shot (-p)"
  echo "prompt        : $PROMPT"
else
  echo "mode          : interactive"
fi
echo

# --- Base flags -----------------------------------------------------------

BASE_FLAGS=(--model "$MODEL" "${EXTRA_FLAGS[@]+"${EXTRA_FLAGS[@]}"}")

# In one-shot mode, inject our session ID and enable yolo.
# In interactive mode, inject session ID for tracking but skip yolo.
if [ -n "$PROMPT" ]; then
  BASE_FLAGS+=(--session-id "$HARNESS_SESSION_ID" --yolo --output-format stream-json)
else
  BASE_FLAGS+=(--session-id "$HARNESS_SESSION_ID")
  [ -n "$CONTINUE_FLAG" ] && BASE_FLAGS+=(-r latest)
fi

# System prompt injection: Gemini CLI has no --system-prompt flag and does
# not read GEMINI_SYSTEM_PROMPT from the environment. The supported mechanism
# is GEMINI.md in the working directory — Gemini loads it as hierarchical
# context into the system instruction at launch (JIT or up-front depending on
# context.jitContext setting). We write a temp GEMINI.md if one does not
# already exist in WORK_DIR; the EXIT trap removes it so we never leave behind
# a harness-written file in the caller's workspace.
_gemini_gemini_md=""
if [ -n "$SYSTEM_PROMPT" ]; then
  _gemini_md_target="$WORK_DIR/GEMINI.md"
  if [ -f "$_gemini_md_target" ]; then
    echo "system_prompt : GEMINI.md already present in $WORK_DIR — not overwriting" >&2
  else
    printf '%s\n' "$SYSTEM_PROMPT" > "$_gemini_md_target" 2>/dev/null \
      && _gemini_gemini_md="$_gemini_md_target" \
      || echo "Warning: could not write GEMINI.md to $WORK_DIR — system prompt not injected" >&2
  fi
fi

# --- Exec -----------------------------------------------------------------

if [ -n "$PROMPT" ]; then
  koad_io_emit_update "one-shot dispatch started"
  export PROMPT
  python3 "$SCRIPT_DIR/gemini_oneshot_dispatch.py" "$GEMINI_BIN" "${BASE_FLAGS[@]}"
  _exec_rc=$?
  koad_io_emit_update "one-shot dispatch complete"
  exit $_exec_rc
else
  "$GEMINI_BIN" "${BASE_FLAGS[@]}"
fi
