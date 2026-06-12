#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# harness/codex — launch an entity through OpenAI Codex CLI
#
# Upstream: https://github.com/openai/codex
# Package:  @openai/codex (npm)
#
# Usage: <entity> harness codex [<model>] [prompt]
#
# Examples:
#   sibyl harness codex
#   sibyl harness codex o4-mini "summarize briefs"
#   sibyl harness codex --oss                        # local via ollama
#   vesta harness codex -p "one-shot task"
#
# Invariants:
#   - --no-context-files NOT available in codex; relies on -c instructions=...
#     for system prompt injection
#   - Do not let kingdom/entity CODEX_HOME cascade pin codex's data dir;
#     codex should use its own default (~/.codex/) unless KOAD_IO_CODEX_HOME
#     is set. Avoids name collisions with kingdom dirs (commands/, agents/).
#   - Do not use generic KOAD_IO_DEFAULT_PROVIDER/MODEL; those may be
#     opencode defaults. codex gets its own cascade (ENTITY_CODEX_* →
#     KOAD_IO_CODEX_* → built-in default).
#   - KOAD_IO_ROOTED honored for cwd selection
#   - interactive: codex [prompt]; one-shot: codex exec <prompt>

set -e
ENTITY_DIR="$HOME/.$ENTITY"

# --- Emission helpers -----------------------------------------------------

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
  echo "Error: \$ENTITY is not set. Invoke via an entity launcher (e.g. 'sibyl harness codex ...')." >&2
  exit 64
fi

if [ -z "$ENTITY_DIR" ] || [ ! -d "$ENTITY_DIR" ]; then
  echo "Error: ~/.$ENTITY not set or not a directory" >&2
  exit 64
fi

CODEX_BIN="${CODEX_BIN:-codex}"

if ! command -v "$CODEX_BIN" >/dev/null 2>&1; then
  echo "Error: '$CODEX_BIN' not found on PATH." >&2
  echo "  Install: npm install -g @openai/codex" >&2
  echo "  Upstream: https://github.com/openai/codex" >&2
  exit 69
fi

# --- Argument parsing -----------------------------------------------------

CONTINUE_FLAG=""
OSS_FLAG=""
LOCAL_PROVIDER=""
EXTRA_FLAGS=()
POSITIONAL=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --continue|-c) CONTINUE_FLAG="resume --last"; shift ;;
    --oss)         OSS_FLAG="--oss"; shift ;;
    --local-provider)   LOCAL_PROVIDER="$2"; shift 2 ;;
    --local-provider=*) LOCAL_PROVIDER="${1#*=}"; shift ;;
    --prompt|-p)
      _prompt_flag="$1"
      shift
      if [ $# -eq 0 ]; then
        echo "Error: $_prompt_flag requires a prompt argument." >&2
        exit 64
      fi
      # Gather everything after -p as the prompt (matches pi harness pattern).
      PROMPT="${PROMPT:-$*}"
      break
      ;;
    --prompt=*) PROMPT="${PROMPT:-${1#*=}}"; shift ;;
    --) shift; POSITIONAL+=("$@"); break ;;
    -*) EXTRA_FLAGS+=("$1"); shift ;;
    *) POSITIONAL+=("$1"); shift ;;
  esac
done
set -- "${POSITIONAL[@]}"
unset POSITIONAL _prompt_flag

MODEL="${1:-${ENTITY_CODEX_MODEL:-${KOAD_IO_CODEX_MODEL:-gpt-5.1-codex}}}"
[ $# -gt 0 ] && shift

if [ -z "$PROMPT" ] && [ ! -t 0 ]; then
  PROMPT="$(cat)"
fi
PROMPT="${PROMPT:-$*}"

# --- codex data dir -------------------------------------------------------
#
# Default: let codex use ~/.codex/ (its native default).
# Opt-in pinning via KOAD_IO_CODEX_HOME — set per-entity or globally when
# the right format for hooks/config is understood. Until then, no
# entity isolation, no auto-written config.

if [ -n "${KOAD_IO_CODEX_HOME:-}" ]; then
  export CODEX_HOME="$KOAD_IO_CODEX_HOME"
else
  unset CODEX_HOME
fi

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
# The EXIT trap always fires because we never `exec` codex — codex runs as a
# child process (same discipline as the pi harness).

_harness_pid_dir="$ENTITY_DIR/.local/state/harness"
_harness_pid_file="$_harness_pid_dir/harness.pid"
mkdir -p "$_harness_pid_dir" 2>/dev/null
echo $$ > "$_harness_pid_file" 2>/dev/null

export HARNESS_PID=$$
# Canonical session identity — stable for this harness wrapper's lifetime.
export HARNESS_SESSION_ID="${ENTITY}-${HARNESS_PID}"
# Spirit — who's at the keyboard. Defaults to $USER until sovereign-login is wired.
export KOAD_IO_SPIRIT="${KOAD_IO_SPIRIT:-${USER:-unknown}}"

# Emission ID persists across resume (same as pi harness)
export HARNESS_EMISSION_ID_FILE="$_harness_pid_dir/emission.id"

_mode="interactive"
[ -n "$PROMPT" ] && _mode="one-shot"
_emit_type="session"
[ -n "$PROMPT" ] && _emit_type="flight"

# Session dir — codex uses ~/.codex/ natively; we expose the harness state dir
# so daemon scanners know where to look. dispatch-control.json lands here after exec.
_sessions_dir="$_harness_pid_dir/sessions"
mkdir -p "$_sessions_dir" 2>/dev/null
export KOAD_IO_HARNESS_SESSIONS_DIR="$_sessions_dir"

_dispatch_control_file="$_harness_pid_dir/dispatch-control.json"

_emit_meta="{\"harness\":\"codex\",\"model\":\"$MODEL\",\"pid\":$$,\"spirit\":\"$KOAD_IO_SPIRIT\",\"host\":\"$(hostname -s)\",\"cwd\":\"$WORK_DIR\",\"sessionDir\":\"$_sessions_dir\"}"

if [ -f "$HARNESS_EMISSION_ID_FILE" ] && [ -n "$CONTINUE_FLAG" ]; then
  koad_io_emit_resume "resumed: codex $MODEL ($_mode)" "$_emit_meta"
else
  koad_io_emit_open "$_emit_type" "harness opened: codex $MODEL ($_mode)" "$_emit_meta"
fi

_codex_on_exit() {
  local rc=$?
  rm -f "$_harness_pid_file" 2>/dev/null
  [ -n "$_mcp_session_file" ] && rm -f "$_mcp_session_file" 2>/dev/null
  [ -n "$_codex_exit_emitted" ] && return
  _codex_exit_emitted=1
  if [ "$rc" -eq 0 ]; then
    koad_io_emit_close "harness closed: codex $MODEL ($_mode, clean exit)"
  elif [ "$rc" -eq 130 ]; then
    koad_io_emit_close "harness closed: codex $MODEL ($_mode, interrupted)"
  else
    koad_io_emit_close "harness closed: codex $MODEL ($_mode, exit $rc)"
  fi
}
trap _codex_on_exit EXIT

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
{"sessionId":"${_mcp_token}","entity":"${ENTITY}","harness":"codex","host":"$(hostname -s)","pid":$$,"cwd":"${WORK_DIR}","createdAt":"$(date -u +%Y-%m-%dT%H:%M:%SZ)"}
MCPEOF
  export KOAD_IO_MCP_SESSION_TOKEN="$_mcp_token"
  echo "mcp_token     : ${_mcp_token:0:12}... (session file written)"
else
  echo "mcp_token     : uuid generation unavailable, MCP auth skipped" >&2
fi
unset _mcp_token _mcp_sess_dir

# --- Announce -------------------------------------------------------------

echo
echo "harness       : codex (@openai/codex)"
echo "entity        : $ENTITY"
echo "home          : ~/.$ENTITY"
if [ -n "$CODEX_HOME" ]; then
  echo "codex_home    : $CODEX_HOME  (caller-provided)"
else
  echo "codex_home    : (codex default ~/.codex/)"
fi
echo "work_dir      : $WORK_DIR"
echo "model         : $MODEL"
echo "session_id    : $HARNESS_SESSION_ID"
[ -n "$OSS_FLAG" ] && echo "provider      : local (${LOCAL_PROVIDER:-ollama})"
if [ -n "$PROMPT" ]; then
  echo "mode          : one-shot (exec)"
  echo "prompt        : $PROMPT"
elif [ -n "$CONTINUE_FLAG" ]; then
  echo "mode          : resume --last"
else
  echo "mode          : interactive"
fi
echo

# --- Build flags ----------------------------------------------------------

BASE_FLAGS=(-m "$MODEL" -C "$WORK_DIR")
[ -n "$OSS_FLAG" ] && BASE_FLAGS+=("$OSS_FLAG")
[ -n "$LOCAL_PROVIDER" ] && BASE_FLAGS+=(--local-provider "$LOCAL_PROVIDER")
[ -n "$SYSTEM_PROMPT" ] && BASE_FLAGS+=(-c "instructions=\"$SYSTEM_PROMPT\"")
BASE_FLAGS+=("${EXTRA_FLAGS[@]+"${EXTRA_FLAGS[@]}"}")

# --- Exec -----------------------------------------------------------------
#
# One-shot flow: write session start timestamp → exec → query sqlite for
# process_uuid → write dispatch-control.json. Codex has no RPC mode, so we
# bracket the exec with timestamps and query after.
#
# Interactive / resume: exec directly; no dispatch-control.json written (no
# single session to capture).

if [ -n "$PROMPT" ]; then
  # Record timestamp just before exec so we can scope the sqlite query
  _session_start_ts="$(date +%s%N 2>/dev/null || echo 0)"

  # Write initial dispatch-control.json before exec (session scanner can see it)
  if [ -n "$_dispatch_control_file" ]; then
    jq -n \
      --arg harnessSessionId "$HARNESS_SESSION_ID" \
      --arg entity "$ENTITY" \
      --arg model "$MODEL" \
      --arg startedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
      --arg codexSessionDb "$HOME/.codex/logs_2.sqlite" \
      '{harnessSessionId: $harnessSessionId, entity: $entity, harness: "codex", model: $model, startedAt: $startedAt, codexSessionDb: $codexSessionDb, codexProcessUuid: null}' \
      > "${_dispatch_control_file}.tmp.$$" && mv "${_dispatch_control_file}.tmp.$$" "$_dispatch_control_file"
  fi
  export _DISPATCH_CONTROL_FILE="$_dispatch_control_file"
  export MODEL

  koad_io_emit_update "one-shot dispatch started"
  # `--` marks end-of-options so a PROMPT that starts with `---` (e.g. a
  # markdown file with YAML frontmatter) is not reinterpreted by codex's
  # clap parser as an option terminator with a malformed value.
  "$CODEX_BIN" exec "${BASE_FLAGS[@]}" -- "$PROMPT"
  _exec_rc=$?

  # After exec: query sqlite for process_uuid from this run
  python3 "$SCRIPT_DIR/capture_codex_session.py" 2>/dev/null || true
  export _session_start_ts

  koad_io_emit_update "one-shot dispatch complete"
  exit $_exec_rc

elif [ -n "$CONTINUE_FLAG" ]; then
  "$CODEX_BIN" resume --last "${BASE_FLAGS[@]}"
else
  "$CODEX_BIN" "${BASE_FLAGS[@]}"
fi
