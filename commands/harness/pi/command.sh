#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# harness/pi — launch an entity through pi (@earendil-works/pi-coding-agent)
#
# Upstream: https://github.com/earendil-works/pi-mono
# Package:  @earendil-works/pi-coding-agent (npm)
#
# Usage: <entity> harness pi [<provider> [<model>]] [prompt]
#
# Examples:
#   sibyl harness pi
#   sibyl harness pi anthropic claude-sonnet-4-6
#   sibyl harness pi openai gpt-4o "summarize briefs"
#   vesta harness pi -p "one-shot task"
#
# SPEC-072 invariants:
#   - --no-context-files always set: kingdom pipes context via system prompt,
#     not via AGENTS.md/CLAUDE.md discovery from cwd
#   - Do not let kingdom/entity PI_CODING_AGENT_DIR cascade pin pi's data dir;
#     pi should use its own default unless KOAD_IO_PI_AGENT_DIR is set.
#   - Do not use generic KOAD_IO_DEFAULT_PROVIDER/MODEL here; those may be
#     opencode defaults. pi gets its own PI-specific cascade. Default to
#     pi's ChatGPT Plus/Pro subscription provider (openai-codex), not the
#     OpenAI API-key provider (openai).
#   - KOAD_IO_ROOTED honored for cwd selection
#   - interactive when no prompt; --mode rpc for one-shot dispatch
#   - bond-gate narrow lanes may be supplied via env without enabling the full
#     bypass (bash, dispatch, read/write tools, path scopes, bash deny files)

set -e
ENTITY_DIR="$HOME/.$ENTITY"

# --- Emission helpers --------------------------------------------------------
#
# Source early — emit calls appear before context assembly, matching the
# claude harness ordering. Stubs keep the script safe on minimal machines.

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
  echo "Error: \$ENTITY is not set. Invoke via an entity launcher (e.g. 'sibyl harness pi ...')." >&2
  exit 64
fi

if [ -z "$ENTITY_DIR" ] || [ ! -d "$ENTITY_DIR" ]; then
  echo "Error: ~/.$ENTITY not set or not a directory" >&2
  exit 64
fi

PI_BIN="${PI_BIN:-pi}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

if ! command -v "$PI_BIN" >/dev/null 2>&1; then
  echo "Error: '$PI_BIN' not found on PATH." >&2
  echo "  Install: npm install -g @earendil-works/pi-coding-agent" >&2
  echo "  Upstream: https://github.com/earendil-works/pi-mono" >&2
  exit 69
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
      # koad-io's dispatcher may re-emit a quoted prompt as multiple argv
      # words (`-p who are you`). Treat everything after -p/--prompt as the
      # prompt, matching pi's own -p behavior and preventing prompt words from
      # being reinterpreted as provider/model.
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

PROVIDER="${1:-${ENTITY_PI_PROVIDER:-${KOAD_IO_PI_PROVIDER:-${PI_PROVIDER:-deepseek}}}}"
[ $# -gt 0 ] && shift

MODEL="${1:-${ENTITY_PI_MODEL:-${KOAD_IO_PI_MODEL:-${PI_MODEL:-deepseek-v4-pro}}}}"
[ $# -gt 0 ] && shift

if [ -z "$PROMPT" ] && [ ! -t 0 ]; then
  PROMPT="$(cat)"
fi
PROMPT="${PROMPT:-$*}"

# --- Model assembly -------------------------------------------------------
# pi accepts --model provider/id or bare id with --provider.
# If already has a slash or colon, pass through directly.

case "$MODEL" in
  */*|*:*) MODEL_ARG=("--model" "$MODEL") ;;
  *)
    case "$PROVIDER" in
      google) MODEL_ARG=("--provider" "google" "--model" "$MODEL") ;;
      *)      MODEL_ARG=("--model" "$PROVIDER/$MODEL") ;;
    esac
    ;;
esac

# --- pi data dir ----------------------------------------------------------
#
# Keep this experimental harness isolated from the user's normal pi instance.
# ~/.koad-io/.env may export PI_CODING_AGENT_DIR="~/.$ENTITY/.pi"; scrub that
# cascade and use this harness-local data dir by default. If a caller really
# wants to pin it elsewhere, set KOAD_IO_PI_AGENT_DIR.

if [ -n "${KOAD_IO_PI_AGENT_DIR:-}" ]; then
  export PI_CODING_AGENT_DIR="$KOAD_IO_PI_AGENT_DIR"
else
  export PI_CODING_AGENT_DIR="$HOME/.koad-io/harness"
fi

# --- Rooted vs roaming cwd ------------------------------------------------

HARNESS_WORK_DIR="${CWD:-$PWD}"
export HARNESS_WORK_DIR

if [ "${KOAD_IO_ROOTED:-false}" = "true" ]; then
  WORK_DIR="$ENTITY_DIR"
else
  WORK_DIR="$HARNESS_WORK_DIR"
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
  # assert/datadir (called below) validates .env presence — entity dirs
  # with .env are valid project folders and don't need blocking here.
  if [ "$_forbidden" = "true" ]; then
    echo "Error: WORK_DIR '$WORK_DIR' is the home directory." >&2
    echo "  Agent harnesses must run in an explicit project working folder." >&2
    echo "  cd to any project folder (with a .env at its root) and try again." >&2
    echo "  Invoke from your project directory or set KOAD_IO_ROOTED=true for entity-home operation." >&2
    exit 64
  fi
  unset _work_dir_real _home_real _forbidden

  # Assert valid koad:io workspace — same check as start/restart commands.
  # A koad-io project folder must have a .env file (source'd by assert/datadir).
  if [ -f "$HOME/.koad-io/commands/assert/datadir/command.sh" ]; then
    if ! source "$HOME/.koad-io/commands/assert/datadir/command.sh" 2>/dev/null; then
      echo -e "\033[31m$(pwd) is not a valid koad:io project folder\033[0m" >&2
      echo "" >&2
      echo "  A koad:io project folder must have a .env file at its root." >&2
      echo "  Entities can only spawn in the project root folder —" >&2
      echo "  not in subdirectories of the project tree." >&2
      echo "" >&2
      echo "  cd to the project root (where .env lives) and try again." >&2
      exit 64
    fi
  fi
fi

# --- Context assembly (VESTA-SPEC-067) ------------------------------------
# Same startup.sh used by claude harness. Assembles KOAD_IO.md → ENTITY.md
# → role primers → pre-emptive primitives into SYSTEM_PROMPT.
# Passed via --system-prompt; --no-context-files prevents double-loading.

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
# Mirrors the claude harness pattern:
#   - Write harness.pid for orphan detection by session-scanner
#   - Export HARNESS_PID, HARNESS_SESSION_ID, KOAD_IO_SPIRIT
#   - Export HARNESS_EMISSION_ID_FILE for resume support
# The EXIT trap always fires because we never `exec` pi — pi runs as a
# child process (same discipline as the claude harness).

_harness_pid_dir="$ENTITY_DIR/.local/state/harness"
_harness_pid_file="$_harness_pid_dir/harness.pid"
mkdir -p "$_harness_pid_dir" 2>/dev/null
echo $$ > "$_harness_pid_file" 2>/dev/null

export HARNESS_PID=$$
# Canonical session identity — stable for this harness wrapper's lifetime.
# Format: <entity>-<harness-pid>. Unique per pi instance, shared by all
# subprocesses via the process tree. Source of truth for session-watchers.
export HARNESS_SESSION_ID="${ENTITY}-${HARNESS_PID}"
# Spirit — who's at the keyboard. Defaults to $USER until sovereign-login is wired.
export KOAD_IO_SPIRIT="${KOAD_IO_SPIRIT:-${USER:-unknown}}"

# Emission ID persists across resume (same as claude harness)
export HARNESS_EMISSION_ID_FILE="$_harness_pid_dir/emission.id"

_mode="interactive"
[ -n "$PROMPT" ] && _mode="one-shot"
_emit_type="session"
[ -n "$PROMPT" ] && _emit_type="flight"

# Session dir — where session jsonl files land (pi writes its own path;
# we expose the dir so daemon scanners know where to look until the exact
# path is captured via RPC get_session_stats).
_sessions_dir="$_harness_pid_dir/sessions"
mkdir -p "$_sessions_dir" 2>/dev/null
export KOAD_IO_HARNESS_SESSIONS_DIR="$_sessions_dir"

_emit_meta="{\"harness\":\"pi\",\"model\":\"$PROVIDER/$MODEL\",\"pid\":$$,\"spirit\":\"$KOAD_IO_SPIRIT\",\"host\":\"$(hostname -s)\",\"cwd\":\"$WORK_DIR\",\"sessionDir\":\"$_sessions_dir\"${HARNESS_CONTROL_FLIGHT_ID:+,\"flightId\":\"$HARNESS_CONTROL_FLIGHT_ID\"}${HARNESS_PARENT_EMISSION_ID:+,\"parentId\":\"$HARNESS_PARENT_EMISSION_ID\"}}"

if [ -f "$HARNESS_EMISSION_ID_FILE" ] && [ -n "$CONTINUE_FLAG" ]; then
  koad_io_emit_resume "resumed: pi $PROVIDER/$MODEL ($_mode)" "$_emit_meta"
else
  koad_io_emit_open "$_emit_type" "harness opened: pi $PROVIDER/$MODEL ($_mode)" "$_emit_meta"
fi

# Stamp the control-tower flight file on harness exit (sovereignty fallback).
# If control-tower restarts mid-flight its child.on('exit') is gone and the
# flight stays "flying" forever. We stamp directly so `wait flight` unblocks.
# Idempotent: no-ops if control-tower already wrote the close.
_harness_stamp_flight() {
  local rc="$1" flight_id="${HARNESS_CONTROL_FLIGHT_ID:-}" flight_file runtime_path dispatch_dir
  [ -z "$flight_id" ] && return
  runtime_path="${KOAD_IO_RUNTIME_PATH:-$HOME/.local/share/koad-io/runtime}"
  dispatch_dir="$runtime_path/dispatches/$flight_id"
  flight_file="$dispatch_dir/dispatch.json"
  [ -f "$flight_file" ] || return
  local new_status="landed"
  [ "$rc" -ne 0 ] && [ "$rc" -ne 130 ] && new_status="error"
  python3 - "$flight_file" "$new_status" "$rc" "$dispatch_dir" <<'PYSTAMP' 2>/dev/null || true
import json, os, sys, time
from datetime import datetime

flight_path, new_status, rc_str, dispatch_dir = sys.argv[1:5]

try:
    with open(flight_path) as f:
        flight = json.load(f)
except Exception:
    sys.exit(0)

if flight.get("status") != "flying":
    sys.exit(0)

ended = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())
note = flight.get("closingNote") or f"harness exit rc={rc_str} (control-tower fallback)"
flight["status"] = new_status
flight["ended"] = ended
flight["closingNote"] = note
flight_tmp = flight_path + ".tmp." + str(os.getpid())
with open(flight_tmp, "w") as f:
    json.dump(flight, f, indent=2)
    f.write("\n")
os.replace(flight_tmp, flight_path)

# Write close event to run.jsonl (append-only)
run_jsonl = os.path.join(dispatch_dir, "run.jsonl")
run_id = flight.get("run_record_id") or ""

# Read last run snapshot from run.jsonl for merge base
run = {}
if os.path.exists(run_jsonl):
    try:
        lines = [l for l in open(run_jsonl).read().split("\n") if l.strip()]
        if lines:
            run = json.loads(lines[-1])
    except Exception:
        pass

if run.get("close_verified") is True and run.get("status") in ("complete", "failed"):
    sys.exit(0)

stats = flight.get("stats") or run.get("stats") or {}
outputs = dict(run.get("outputs") or {})
outputs["summary"] = outputs.get("summary") or note
results = dict(run.get("results") or {})
results["success"] = (new_status == "landed")
if stats.get("cost") is not None:
    results["cost"] = stats.get("cost")
model = flight.get("model") or run.get("model") or (stats.get("model") if isinstance(stats, dict) else None)

elapsed = run.get("elapsed_s") or run.get("elapsed") or 0
started = run.get("started") or run.get("started_at") or flight.get("started")
if not elapsed and started:
    try:
        started_dt = datetime.fromisoformat(str(started).replace("Z", "+00:00"))
        ended_dt = datetime.fromisoformat(ended.replace("Z", "+00:00"))
        elapsed = max(0, round((ended_dt - started_dt).total_seconds()))
    except Exception:
        elapsed = 0

close_snapshot = {
    "run_id": run_id,
    "flight_id": flight.get("id") or "",
    "status": "complete" if new_status == "landed" else "failed",
    "ended": ended,
    "completed_at": ended,
    "close_reason": "harness-fallback",
    "close_verified": True,
    "outputs": outputs,
    "results": results,
    "stats": stats,
    "elapsed": elapsed,
    "elapsed_s": elapsed,
    "snapshot_at": ended,
}
if model:
    close_snapshot["model"] = model

try:
    os.makedirs(dispatch_dir, exist_ok=True)
    with open(run_jsonl, "a") as f:
        f.write(json.dumps(close_snapshot) + "\n")
except Exception:
    pass
PYSTAMP
}

_pi_on_exit() {
  local rc=$?
  rm -f "$_harness_pid_file" 2>/dev/null
  [ -n "$_pi_exit_emitted" ] && return
  _pi_exit_emitted=1
  if [ "$rc" -eq 0 ]; then
    koad_io_emit_close "harness closed: pi $PROVIDER/$MODEL ($_mode, clean exit)"
  elif [ "$rc" -eq 130 ]; then
    koad_io_emit_close "harness closed: pi $PROVIDER/$MODEL ($_mode, interrupted)"
  else
    koad_io_emit_close "harness closed: pi $PROVIDER/$MODEL ($_mode, exit $rc)"
  fi
}
trap _pi_on_exit EXIT

# --- MCP session token pre-registration (VESTA-SPEC-139) ------------------
#
# Same pattern as the claude harness: pre-generate a UUID, write a session
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
{"sessionId":"${_mcp_token}","entity":"${ENTITY}","harness":"pi","host":"$(hostname -s)","pid":$$,"cwd":"${WORK_DIR}","createdAt":"$(date -u +%Y-%m-%dT%H:%M:%SZ)"}
MCPEOF
  export KOAD_IO_MCP_SESSION_TOKEN="$_mcp_token"
  echo "mcp_token     : ${_mcp_token:0:12}... (session file written)"
else
  echo "mcp_token     : uuid generation unavailable, MCP auth skipped" >&2
fi
unset _mcp_token _mcp_sess_dir

# Augment the EXIT trap to clean up the MCP session file.
_pi_on_exit() {
  local rc=$?
  rm -f "$_harness_pid_file" 2>/dev/null
  [ -n "$_pi_exit_emitted" ] && {
    [ -n "$_mcp_session_file" ] && rm -f "$_mcp_session_file" 2>/dev/null
    return
  }
  _pi_exit_emitted=1
  if [ "$rc" -eq 0 ]; then
    koad_io_emit_close "harness closed: pi $PROVIDER/$MODEL ($_mode, clean exit)"
  elif [ "$rc" -eq 130 ]; then
    koad_io_emit_close "harness closed: pi $PROVIDER/$MODEL ($_mode, interrupted)"
  else
    koad_io_emit_close "harness closed: pi $PROVIDER/$MODEL ($_mode, exit $rc)"
  fi
  _harness_stamp_flight "$rc"
  # Notify control-tower so the dashboard / wait flight see the landing.
  # Fire-and-forget — hits control-tower's POST /flight endpoint.
  if [ -n "${HARNESS_CONTROL_FLIGHT_ID:-}" ]; then
    _ct_url="${KOAD_IO_CONTROL_URL:-http://10.10.10.10:28283}"
    _runtime_path="${KOAD_IO_RUNTIME_PATH:-$HOME/.local/share/koad-io/runtime}"
    _dispatch_json="$_runtime_path/dispatches/$HARNESS_CONTROL_FLIGHT_ID/dispatch.json"
    _stats_json="{}"
    if [ -f "$_dispatch_json" ]; then
      _stats_json="$(python3 -c "import json,sys; d=json.load(open('$_dispatch_json')); print(json.dumps(d.get('stats') or {}))" 2>/dev/null || echo '{}')"
    fi
    curl -sSf --max-time 3 -X POST "$_ct_url/flight" \
      -H 'Content-Type: application/json' \
      -d "{\"action\":\"close\",\"_id\":\"$HARNESS_CONTROL_FLIGHT_ID\",\"ended\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"completionSummary\":\"harness exit rc=$rc\",\"stats\":$_stats_json}" >/dev/null 2>&1 || true
  fi
  [ -n "$_mcp_session_file" ] && rm -f "$_mcp_session_file" 2>/dev/null
}
# trap already set above — redefining _pi_on_exit is sufficient

# --- Announce -------------------------------------------------------------

echo
echo "harness       : pi (@earendil-works/pi-coding-agent)"
echo "entity        : $ENTITY"
echo "home          : ~/.$ENTITY"
if [ -n "${KOAD_IO_PI_AGENT_DIR:-}" ]; then
  echo "pi_agent_dir  : $PI_CODING_AGENT_DIR  (caller-provided)"
else
  echo "pi_agent_dir  : $PI_CODING_AGENT_DIR  (harness-local)"
fi
echo "work_dir      : $WORK_DIR"
echo "provider      : $PROVIDER"
echo "model         : $PROVIDER/$MODEL"
echo "session_id    : $HARNESS_SESSION_ID"
if [ -n "$PROMPT" ]; then
  echo "mode          : rpc dispatch (one-shot)"
  echo "prompt        : $PROMPT"
else
  echo "mode          : interactive"
fi
echo

# --- Base flags -----------------------------------------------------------

BASE_FLAGS=(--no-context-files "${MODEL_ARG[@]}" ${CONTINUE_FLAG:+"$CONTINUE_FLAG"} "${EXTRA_FLAGS[@]+"${EXTRA_FLAGS[@]}"}")

if [ -n "$SYSTEM_PROMPT" ]; then
  BASE_FLAGS+=(--system-prompt "$SYSTEM_PROMPT")
fi

# --- Interactive path -----------------------------------------------------

if [ -z "$PROMPT" ]; then
  "$PI_BIN" "${BASE_FLAGS[@]}"
  exit $?
fi

# --- RPC dispatch path (one-shot) -----------------------------------------
#
# Preferred over bare `-p` for lifecycle-complete dispatch. RPC mode gives
# us the session file path via get_session_stats immediately after the
# agent starts — no path construction, no guessing.
#
# Flow:
#   1. Launch pi --mode rpc as a subprocess
#   2. Send {"type":"prompt","message":"<task>"}
#   3. Wait for agent_end event
#   4. Call get_session_stats → capture sessionFile
#   5. Write sessionFile path to dispatch-control.json
#   6. Call get_last_assistant_text → print result to stdout
#   7. pi exits; trap fires
#
# Session file is the primary telemetry source (jsonl per-message cost).
# RPC event stream is used only for dispatch control and stats extraction.

_dispatch_control_file="$_harness_pid_dir/dispatch-control.json"

koad_io_emit_update "rpc dispatch started"

export PROMPT

python3 "$SCRIPT_DIR/pi_rpc_dispatch.py" "$PI_BIN" "${BASE_FLAGS[@]}"
_dispatch_rc=$?

# --- Followup polling loop (control-tower dispatched flights) ---------------
# When dispatched via control-tower, the dispatcher may send follow-up prompts
# after the initial task completes. Poll the followup file and re-dispatch
# until the dispatcher signals complete or timeout elapses.
if [ -n "${HARNESS_CONTROL_FLIGHT_ID:-}" ]; then
  _followup_file="${KOAD_IO_RUNTIME_PATH:-$HOME/.local/share/koad-io/runtime}/dispatches/${HARNESS_CONTROL_FLIGHT_ID}/followup.jsonl"
  _followup_timeout=300  # 5 minutes total for followups
  _followup_start=$(date +%s)
  _followup_pos=0

  # Record current file position so we only read new entries
  [ -f "$_followup_file" ] && _followup_pos=$(wc -c < "$_followup_file")

  koad_io_emit_update "followup polling started (timeout=${_followup_timeout}s)"

  while true; do
    _now=$(date +%s)
    _elapsed=$((_now - _followup_start))
    [ "$_elapsed" -ge "$_followup_timeout" ] && break

    if [ -f "$_followup_file" ]; then
      _current_size=$(wc -c < "$_followup_file")
      if [ "$_current_size" -gt "$_followup_pos" ]; then
        _new_bytes=$(tail -c +$((_followup_pos + 1)) "$_followup_file" 2>/dev/null || true)
        _followup_pos=$_current_size

        _first_line=$(echo "$_new_bytes" | head -1)
        _action=$(echo "$_first_line" | jq -r '.action // "prompt"' 2>/dev/null || echo "prompt")

        if [ "$_action" = "complete" ]; then
          koad_io_emit_update "followup: dispatcher signaled mission complete"
          break
        fi

        _followup_prompt=$(echo "$_first_line" | jq -r '.prompt // .message // ""' 2>/dev/null || echo "")
        if [ -n "$_followup_prompt" ]; then
          koad_io_emit_update "followup received, re-dispatching"
          PROMPT="$_followup_prompt" python3 "$SCRIPT_DIR/pi_rpc_dispatch.py" "$PI_BIN" "${BASE_FLAGS[@]}"
          _dispatch_rc=$?
          # Reset timeout on each received followup so the dispatcher can
          # chain multiple follow-ups without racing the clock
          _followup_start=$(date +%s)
        fi
      fi
    fi
    sleep 4
  done
fi

exit $_dispatch_rc
