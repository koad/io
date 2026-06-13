#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# harness/claude — launch an entity through Claude Code
#
# Usage: <entity> harness claude <provider> <model> [prompt]
#
# Examples:
#   juno  harness claude anthropic opus-4-6
#   sibyl harness claude anthropic sonnet-4-6 "scan briefs"
#   alice harness claude anthropic haiku-4-5 "hi"
#
# Invariants (per VESTA-SPEC-072):
#   - CLAUDE_CONFIG_DIR = ~/.$ENTITY (entity root IS the harness config dir)
#   - credentials cascade: entity .credentials > kingdom .credentials (handled by koad-io loader)
#   - rooted vs roaming cwd honored via KOAD_IO_ROOTED
#   - interactive when no prompt; -p one-shot when prompt present

set -e
ENTITY_DIR="$HOME/.$ENTITY"

# --- Flag filter ----------------------------------------------------------
#
# Extract --continue / -c before positional parsing so the flag can appear
# anywhere (e.g. 'vesta harness claude -c' or 'vesta harness claude anthropic
# sonnet-4-6 -c "follow-up"'). Env-var CONTINUE=1 is equivalent and lets
# callers set it without touching positional args. This is the same pattern
# koad-io itself uses for --quiet.

_filtered=()
_grab_resume=""
for _arg in "$@"; do
  if [ "$_grab_resume" = "1" ]; then
    RESUME_ID="$_arg"
    _grab_resume=""
    continue
  fi
  case "$_arg" in
    --continue|-c) CONTINUE=1 ;;
    --resume|-r)   _grab_resume=1 ;;
    --resume=*)    RESUME_ID="${_arg#*=}" ;;
    *)             _filtered+=("$_arg") ;;
  esac
done
set -- "${_filtered[@]}"
unset _arg _filtered _grab_resume
CONTINUE="${CONTINUE:-0}"
RESUME_ID="${RESUME_ID:-}"

# --- Guard rails ----------------------------------------------------------

if [ -z "$ENTITY" ]; then
  echo "Error: \$ENTITY is not set. Invoke via an entity launcher (e.g. 'juno harness claude ...')." >&2
  exit 64
fi

if [ -z "$ENTITY_DIR" ] || [ ! -d "$ENTITY_DIR" ]; then
  echo "Error: ~/.$ENTITY not set or not a directory" >&2
  exit 64
fi

if ! command -v claude >/dev/null 2>&1; then
  echo "Error: 'claude' CLI not found on PATH. Install Claude Code first." >&2
  exit 69
fi

# --- Argument parsing -----------------------------------------------------

PROVIDER="${1:-${ENTITY_DEFAULT_PROVIDER:-${KOAD_IO_DEFAULT_PROVIDER:-anthropic}}}"
[ $# -gt 0 ] && shift

MODEL="${1:-${ENTITY_DEFAULT_MODEL:-${KOAD_IO_DEFAULT_MODEL:-opus-4-6}}}"
[ $# -gt 0 ] && shift

# Remaining positional args become the prompt (word-split by the koad-io
# dispatcher, so we rejoin with single spaces). Precedence:
#   1. $PROMPT env var     — explicit override, heredoc-friendly
#   2. stdin pipe          — `cat brief.md | ...` or heredoc with no env var
#   3. positional args     — legacy `... harness default "hi there"`
#
# Reading stdin when it's not a TTY (`[ ! -t 0 ]`) lets callers sidestep
# shell quoting entirely — nested quotes, dollar signs, backticks, newlines,
# all pass through literally because they never touch shell word-splitting.
if [ -z "$PROMPT" ] && [ ! -t 0 ]; then
  PROMPT="$(cat)"
fi
PROMPT="${PROMPT:-$*}"

# --- Auto-continue on interactive startup (ENTITY_CONTINUE) ---------------
#
# When ENTITY_CONTINUE=true AND the launch is interactive (no PROMPT),
# force CONTINUE=1 so the entity resumes its last session automatically.
# Opt-in per-entity via .env. One-shot (-p) mode is unaffected — continuity
# there is an explicit caller choice, not an entity trait. See the
# feedback_continue_vs_fresh memory for when a reflexive -c is the right
# default (identity-stable entities that think across sittings).
if [ "${ENTITY_CONTINUE:-false}" = "true" ] && [ -z "$PROMPT" ]; then
  CONTINUE=1
fi

# --- Provider validation --------------------------------------------------

case "$PROVIDER" in
  anthropic)
    if [ -z "$ANTHROPIC_API_KEY" ] && [ -z "$CLAUDE_CODE_OAUTH_TOKEN" ]; then
      echo "Warning: no ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN in environment." >&2
      echo "  (claude CLI may still work if it has cached credentials in ~/.$ENTITY/.credentials.json)" >&2
    fi
    ;;
  bedrock|vertex)
    echo "Error: provider '$PROVIDER' not yet wired in this harness. Contributions welcome." >&2
    exit 65
    ;;
  *)
    echo "Error: unknown provider '$PROVIDER' for claude harness." >&2
    echo "  Supported: anthropic  (bedrock, vertex — not yet wired)" >&2
    exit 65
    ;;
esac

# --- Model name normalization --------------------------------------------
#
# Accept short names like 'opus-4-6' or full IDs like 'claude-opus-4-6'.
# Prefix 'claude-' if missing. The claude CLI resolves short→long itself
# but being explicit avoids surprises.

case "$MODEL" in
  claude-*) MODEL_RESOLVED="$MODEL" ;;
  *)        MODEL_RESOLVED="claude-$MODEL" ;;
esac

# --- SPEC-072 invariants (three modes) ------------------------------------
#
# CLAUDE_CONFIG_DIR resolves to one of three modes, in priority order:
#
#   1. Caller-pinned room  — if KOAD_IO_ROOM is set, use $KOAD_IO_ROOM as
#      the config dir. The room is then a sealed portable workspace: its
#      own chat history lives at $KOAD_IO_ROOM/projects/.../<uuid>.jsonl
#      and travels with the room when you tar it up. Multiple roaming
#      entities visiting the same room with the same --session-id share
#      the same conversation file naturally.
#
#   2. Rooted entity       — if KOAD_IO_ROOTED=true, use ~/.$ENTITY. This
#      is the original SPEC-072 axiom for protocol keepers (Juno, Vesta):
#      sealed entity, portable, session log lives inside the entity tarball.
#
#   3. Roaming entity      — neither set, so EXPLICITLY unset
#      CLAUDE_CONFIG_DIR (inherited from the caller's env otherwise) and
#      let claude fall back to the system default ~/.claude/. The system
#      db is shared across roaming entities by default — they can join
#      common rooms via --session-id with no extra configuration.

if [ -n "$KOAD_IO_ROOM" ] && [ -d "$KOAD_IO_ROOM" ]; then
  export CLAUDE_CONFIG_DIR="$KOAD_IO_ROOM"
elif [ "${KOAD_IO_ROOTED:-false}" = "true" ]; then
  export CLAUDE_CONFIG_DIR="$ENTITY_DIR"
else
  unset CLAUDE_CONFIG_DIR
fi

# --- Rooted vs roaming cwd ------------------------------------------------
#
# Rooted entities (Juno, Vesta) always work from ~/.$ENTITY regardless of
# where they were invoked. Roaming entities (Vulcan, Mercury) stay in $CWD
# so they can operate on the project the user invoked them inside.

if [ "${KOAD_IO_ROOTED:-false}" = "true" ]; then
  WORK_DIR="$ENTITY_DIR"
else
  WORK_DIR="${CWD:-$PWD}"
fi

cd "$WORK_DIR"

# --- Announce -------------------------------------------------------------

echo
echo "harness       : claude"
echo "entity        : $ENTITY"
echo "home          : ~/.$ENTITY"
echo "work_dir      : $WORK_DIR"
echo "provider      : $PROVIDER"
echo "model         : $MODEL_RESOLVED"
if [ -n "$CLAUDE_CONFIG_DIR" ]; then
  if [ -n "$KOAD_IO_ROOM" ]; then
    echo "config_dir    : $CLAUDE_CONFIG_DIR  (sealed portable room)"
  else
    echo "config_dir    : $CLAUDE_CONFIG_DIR  (sealed portable entity — SPEC-072)"
  fi
else
  echo "config_dir    : (system default ~/.claude — roaming, room-shareable)"
fi
if [ -n "$PROMPT" ]; then
  echo "mode          : one-shot"
  echo "prompt        : $PROMPT"
else
  echo "mode          : interactive"
fi
[ "$CONTINUE" = "1" ] && echo "continue      : yes (session picker)"
[ -n "$RESUME_ID" ] && echo "resume        : $RESUME_ID"

# --- Context readout (continue mode only) --------------------------------
#
# When resuming, peek the session JSONL that `claude -c` is about to pick
# up and report the last assistant turn's token usage. Context size =
# input + cache_creation + cache_read (what Claude actually sees on the
# next turn, minus the delta from that turn's reply). Silent on any
# failure — this is a convenience readout, not a gate.

if [ "$CONTINUE" = "1" ] && command -v jq >/dev/null 2>&1; then
  _proj_root="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/projects"
  _proj_slug=$(printf '%s' "$WORK_DIR" | sed 's|[/.]|-|g')
  _sess=$(ls -t "$_proj_root/$_proj_slug"/*.jsonl 2>/dev/null | head -1)
  if [ -n "$_sess" ] && [ -r "$_sess" ]; then
    _usage=$(tac "$_sess" 2>/dev/null \
      | jq -c 'select(.message.usage != null) | .message.usage' 2>/dev/null \
      | head -1)
    if [ -n "$_usage" ]; then
      printf '%s' "$_usage" | jq -r '
        (.input_tokens // 0) as $in
        | (.cache_creation_input_tokens // 0) as $cc
        | (.cache_read_input_tokens // 0) as $cr
        | ($in + $cc + $cr) as $ctx
        | "context       : \($ctx) tokens  (cached \($cr), fresh \($cc + $in))"'
      _turns=$(wc -l < "$_sess" 2>/dev/null)
      _bytes=$(stat -c%s "$_sess" 2>/dev/null)
      echo "session       : $(basename "$_sess" .jsonl)  (${_turns:-?} lines, ${_bytes:-?} bytes)"
    fi
  fi
  unset _proj_root _proj_slug _sess _usage _turns _bytes
fi
echo

# --- Session picker (continue mode without prompt) --------------------------
#
# When -c is used without a prompt and without --resume, list recent sessions
# so the user can pick one and re-invoke with --resume <id>. This works around
# the claude CLI regression where bare -c looks for a deferred-tool marker
# instead of simply resuming the conversation.

if [ "$CONTINUE" = "1" ] && [ -z "$PROMPT" ] && [ -z "$RESUME_ID" ]; then
  _proj_root="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/projects"
  _proj_slug=$(printf '%s' "$WORK_DIR" | sed 's|[/.]|-|g')
  _sess_dir="$_proj_root/$_proj_slug"

  if [ -d "$_sess_dir" ] && command -v python3 >/dev/null 2>&1; then
    echo "Recent sessions in $(basename "$_sess_dir"):"
    echo
    python3 - "$_sess_dir" <<'PYEOF'
import json, os, sys
from datetime import datetime

sess_dir = sys.argv[1]
files = []
for f in os.listdir(sess_dir):
    if not f.endswith('.jsonl'):
        continue
    path = os.path.join(sess_dir, f)
    files.append((os.path.getmtime(path), f, path))
files.sort(reverse=True)

for i, (mtime, fname, path) in enumerate(files[:10]):
    sid = fname.replace('.jsonl', '')
    first_user = None
    first_ts = None
    last_ts = None
    summary = None
    line_count = 0
    try:
        with open(path) as fh:
            for line in fh:
                line_count += 1
                d = json.loads(line)
                ts = d.get('timestamp')
                if ts:
                    if not first_ts:
                        first_ts = ts
                    last_ts = ts
                if d.get('type') == 'user' and not first_user:
                    msg = d.get('message', {})
                    content = msg.get('content', '')
                    if isinstance(content, list):
                        for c in content:
                            if isinstance(c, dict) and c.get('type') == 'text':
                                content = c['text']
                                break
                        else:
                            content = ''
                    if isinstance(content, str) and content.strip() and content.strip() != '.':
                        first_user = content.strip().replace('\n', ' ')[:72]
                if d.get('subtype') == 'away_summary':
                    summary = d.get('content', '').replace('\n', ' ')[:72]
    except Exception:
        continue

    dt = datetime.fromisoformat(last_ts.replace('Z','+00:00')) if last_ts else None
    age = ''
    if dt:
        age = dt.strftime('%b %d %H:%M')

    marker = '  '
    if i == 0:
        marker = '→ '

    print(f'  {marker}{sid}')
    if age:
        print(f'      {age}  ({line_count} turns)')
    preview = summary or first_user or '(no preview)'
    print(f'      {preview}')
    print()

PYEOF

    echo "Resume with:"
    echo "  $ENTITY harness default --resume <session-id>"
    echo
  else
    echo "No session files found in $_sess_dir" >&2
  fi

  unset _proj_root _proj_slug _sess_dir
  exit 0
fi

# --- VESTA-SPEC-134 §6.2 Path C: Local-harness KEK ceremony ──────────────
#
# If KOAD_IO_MEMORY_ENABLED=1 is set in the entity's .env, run the KEK
# ceremony before launching the entity. The ceremony prompts for the memory
# passphrase on stderr (terminal), writes a JSON result to stdout, and exits.
#
# Ceremony result shape: { status, kek_b64? }
#   status=loaded           → KEK active; entity has memories this session
#   status=loaded-empty     → KEK active; no memories yet (first post-setup)
#   status=rotation-required → KEK active; some blobs need re-wrap
#   status=aborted          → 3 failures or user opt-out; proceed without memories
#   status=revoked          → bond revoked; proceed without memories
#
# The ceremony runs only if:
#   1. KOAD_IO_MEMORY_ENABLED=1
#   2. The ceremony script exists
#   3. Node.js is available
#
# The derived kek_b64 is exported as KOAD_IO_SESSION_KEK for the entity session.
# Phase 6 wires this into the DDP session-KEK transport.

CEREMONY_SCRIPT="$HOME/.koad-io/harness/memory-kek-ceremony.js"

if [ "${KOAD_IO_MEMORY_ENABLED:-0}" = "1" ] && [ -f "$CEREMONY_SCRIPT" ] && command -v node >/dev/null 2>&1; then
  # Forward all relevant env vars to the ceremony
  export KOAD_IO_MEMORY_FIRST_TIME_DEVICE="${KOAD_IO_MEMORY_FIRST_TIME_DEVICE:-0}"
  export KOAD_IO_MEMORY_KEK_STATUS="${KOAD_IO_MEMORY_KEK_STATUS:-}"
  export KOAD_IO_MEMORY_KEY_VERSION="${KOAD_IO_MEMORY_KEY_VERSION:-1}"
  export KOAD_IO_MEMORY_SALT_B64="${KOAD_IO_MEMORY_SALT_B64:-}"
  export KOAD_IO_MEMORY_COUNT="${KOAD_IO_MEMORY_COUNT:-0}"

  # Run ceremony; capture stdout (JSON result), let stderr (UI) flow to terminal
  _ceremony_result="$(node "$CEREMONY_SCRIPT" 2>/dev/tty || echo '{"status":"aborted"}')"
  _ceremony_status="$(echo "$_ceremony_result" | jq -r '.status // "aborted"' 2>/dev/null || echo 'aborted')"
  _ceremony_kek="$(echo "$_ceremony_result" | jq -r '.kek_b64 // ""' 2>/dev/null || echo '')"

  case "$_ceremony_status" in
    loaded|loaded-empty|rotation-required)
      # Session has memories — export KEK for Phase 6 wire
      export KOAD_IO_SESSION_KEK="$_ceremony_kek"
      export KOAD_IO_MEMORY_CEREMONY_STATUS="$_ceremony_status"
      ;;
    aborted|revoked)
      # No memories this session — entity proceeds normally
      export KOAD_IO_MEMORY_CEREMONY_STATUS="$_ceremony_status"
      unset KOAD_IO_SESSION_KEK
      ;;
  esac

  unset _ceremony_result _ceremony_status _ceremony_kek
fi

# --- Load emission helpers (before first koad_io_emit_update use) ----------

source "$HOME/.koad-io/helpers/emit.sh" 2>/dev/null

# --- Context assembly (VESTA-SPEC-067) ------------------------------------
#
# Identity always loads. Run startup.sh to assemble KOAD_IO.md → ENTITY.md →
# role primers → pre-emptive primitives into SYSTEM_PROMPT. This happens
# unconditionally — the entity wakes up knowing who it is regardless of
# whether a prompt was given or how dispatch reached this script.

if [ -f "$HOME/.koad-io/harness/startup.sh" ]; then
  koad_io_emit_update "context assembly started"
  SYSTEM_PROMPT="$("$HOME/.koad-io/harness/startup.sh")" || {
    echo "Warning: startup.sh failed (exit $?), proceeding without context assembly" >&2
    koad_io_emit_update "context assembly failed (exit $?)"
  }
  export SYSTEM_PROMPT
  koad_io_emit_update "context assembly complete"
fi

# --- Exec -----------------------------------------------------------------
#
# Build argv explicitly. --resume <id> resumes a specific session.
# --continue (-c) with a prompt still passes through to claude -c.
# Bare -c without a prompt is handled above (session picker, exits early).

_args=(--model "$MODEL_RESOLVED")
if [ -n "$RESUME_ID" ]; then
  _args+=(--resume "$RESUME_ID")
elif [ "$CONTINUE" = "1" ]; then
  _args+=(-c)
fi

# --- Entity-contributed Claude Code plugins --------------------------------
#
# Scan ~/.$ENTITY/plugins/*/ for dirs that are actual plugins (contain
# .claude-plugin/plugin.json) and inject each as --plugin-dir. Lets an
# entity bundle its own agents/skills/hooks as plugins without touching
# the framework or the harness. Experimental (2026-04-21) — see
# ~/.juno/plugins/koad-io-team/ for the first plugin.
if [ -d "$ENTITY_DIR/plugins" ]; then
  for _pdir in "$ENTITY_DIR/plugins"/*/; do
    [ -f "$_pdir/.claude-plugin/plugin.json" ] || continue
    _args+=(--plugin-dir "${_pdir%/}")
  done
  unset _pdir
fi

# --- Skip permissions (Juno-only by convention) ---------------------------
#
# ENTITY_SKIP_PERMISSIONS=true in the entity's .env bypasses the interactive
# permission prompt. Per feedback_permissions memory this is Juno-only —
# orchestrator entities can't pause mid-flight to ask for approval. Every
# other entity leaves this unset so the harness stays the safety net.
if [ "${ENTITY_SKIP_PERMISSIONS:-false}" = "true" ]; then
  _args+=(--dangerously-skip-permissions)
fi

# Inject identity context via --append-system-prompt and add entity dir for file access.
# KOAD_IO_CWD_PRIMER carries a path to the caller's PRIMER.md
# (set by executed-without-arguments.sh when invoked in a dir with
# PRIMER.md). Read the file and append to SYSTEM_PROMPT so it loads as
# context, not as a one-shot prompt.
if [ -n "${KOAD_IO_CWD_PRIMER:-}" ] && [ -f "${KOAD_IO_CWD_PRIMER}" ]; then
  _cwd_primer_content="$(cat "$KOAD_IO_CWD_PRIMER")"
  SYSTEM_PROMPT="${SYSTEM_PROMPT:+$SYSTEM_PROMPT

}Project context (from $KOAD_IO_CWD_PRIMER):
$_cwd_primer_content"
  unset _cwd_primer_content
fi
if [ -n "$SYSTEM_PROMPT" ]; then
  _args+=(--append-system-prompt "$SYSTEM_PROMPT" --add-dir "$ENTITY_DIR")
fi

if [ -n "$PROMPT" ]; then
  _args+=(-p "$PROMPT")
fi

# --- Lockfile busy-guard (ENTITY_LOCKFILE) --------------------------------
#
# When ENTITY_LOCKFILE=true AND this is -p one-shot mode, refuse to launch
# if another one-shot is already running for this entity. Prevents
# orchestrators from racing two dispatches into the same entity's
# conversation. Stale locks (PID exited without cleanup) are auto-reclaimed.
# Lock lives at ~/.$ENTITY/.lock/harness-claude.pid — a dot-dir inside the
# entity so it travels with sealed-portable entities.
#
# Interactive mode is intentionally unguarded: terminal windows are already
# human-serialized, and locking them would strand a session if the shell
# died without trap. Opt-in per-entity because most entities (roaming,
# party-lined) are explicitly built for concurrent sessions.
_lock_cleanup() { :; }
if [ "${ENTITY_LOCKFILE:-false}" = "true" ] && [ -n "$PROMPT" ]; then
  _lockdir="$ENTITY_DIR/.lock"
  _lockfile="$_lockdir/harness-claude.pid"
  mkdir -p "$_lockdir"
  if [ -f "$_lockfile" ]; then
    _locked_pid=$(cat "$_lockfile" 2>/dev/null || echo "")
    if [ -n "$_locked_pid" ] && kill -0 "$_locked_pid" 2>/dev/null; then
      echo "$ENTITY is busy (pid $_locked_pid). Try again shortly." >&2
      exit 75  # EX_TEMPFAIL
    fi
    # stale lock — previous process died without cleanup
    rm -f "$_lockfile"
  fi
  echo $$ > "$_lockfile"
  _lock_cleanup() { rm -f "$_lockfile"; }
  trap _lock_cleanup EXIT INT TERM
fi

# --- Harness lifecycle emissions + PID tracking ---------------------------
#
# Record the harness wrapper PID so the session-scanner can detect orphans
# (SIGKILL'd processes that never ran the EXIT trap). Emit open/close/killed
# lifecycle events to the daemon via the emit helper.
#
# Lifecycle emission: one record per session, updated as it progresses.
# On resume (-c), reconnect to the existing emission instead of opening new.
#
# We never `exec` claude anymore — always run as a child process so the
# EXIT trap fires reliably. The overhead is one extra bash process in the
# tree, negligible for sessions that run minutes to hours.

_harness_pid_dir="$ENTITY_DIR/.local/state/harness"
_harness_pid_file="$_harness_pid_dir/harness.pid"
mkdir -p "$_harness_pid_dir" 2>/dev/null
echo $$ > "$_harness_pid_file" 2>/dev/null
export HARNESS_PID=$$
# Canonical session identity — stable for this harness wrapper's lifetime.
# Format: <entity>-<harness-pid>. Unique per Claude Code instance, shared by
# all subprocesses (hooks, session commands) via the process tree.
# This is the source of truth for session-watchers and session-inbox paths.
export HARNESS_SESSION_ID="${ENTITY}-${HARNESS_PID}"
# Spirit — who's at the keyboard. Defaults to $USER until sovereign-login is wired.
# Same session shows under /<spirit>/sessions and /<entity>/sessions.
export KOAD_IO_SPIRIT="${KOAD_IO_SPIRIT:-${USER:-unknown}}"

# Emission ID persists across resume
export HARNESS_EMISSION_ID_FILE="$_harness_pid_dir/emission.id"

_mode="interactive"
[ -n "$PROMPT" ] && _mode="one-shot"

_emit_type="session"
[ -n "$PROMPT" ] && _emit_type="flight"

# Session file pattern — the daemon uses this to correlate with session-scanner.
# Claude Code writes the session UUID as the filename; we pass the dir so the
# daemon knows where to look. The actual sessionId gets merged via heartbeat
# once Claude Code's statusline writes it.
_emit_meta="{\"harness\":\"claude\",\"model\":\"$MODEL_RESOLVED\",\"pid\":$$,\"spirit\":\"$KOAD_IO_SPIRIT\",\"host\":\"$(hostname -s)\",\"cwd\":\"$WORK_DIR\",\"sessionDir\":\"$_harness_pid_dir/sessions\"${HARNESS_PARENT_EMISSION_ID:+,\"parentId\":\"$HARNESS_PARENT_EMISSION_ID\"}}"

if { [ "$CONTINUE" = "1" ] || [ -n "$RESUME_ID" ]; } && [ -f "$HARNESS_EMISSION_ID_FILE" ]; then
  koad_io_emit_resume "resumed: claude $MODEL_RESOLVED ($_mode)" "$_emit_meta"
else
  koad_io_emit_open "$_emit_type" "harness opened: claude $MODEL_RESOLVED ($_mode)" "$_emit_meta"
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

_harness_exit_emitted=""
_harness_on_exit() {
  local rc=$?
  _lock_cleanup
  rm -f "$_harness_pid_file" 2>/dev/null
  [ -n "$_harness_exit_emitted" ] && return
  _harness_exit_emitted=1
  if [ "$rc" -eq 0 ]; then
    koad_io_emit_close "harness closed: claude $MODEL_RESOLVED ($_mode, clean exit)"
  elif [ "$rc" -eq 130 ]; then
    koad_io_emit_close "harness closed: claude $MODEL_RESOLVED ($_mode, interrupted)"
  else
    koad_io_emit_close "harness closed: claude $MODEL_RESOLVED ($_mode, exit $rc)"
  fi
}
trap _harness_on_exit EXIT

# --- MCP session token pre-registration (VESTA-SPEC-139) ------------------
#
# Claude Code reads .mcp.json at startup and substitutes ${KOAD_IO_MCP_SESSION_TOKEN}
# before connecting to the kingdom MCP service (dance-hall). The dance-hall's
# auth layer (auth.js) resolves Bearer tokens via two paths:
#   1. In-memory sessions-store (JSONL-backed, dance-hall managed)
#   2. Disk scan: ~/.<entity>/.local/state/harness/sessions/<token>.json
#
# We use path 2: pre-generate a UUID, write a session file to disk, and export
# it as KOAD_IO_MCP_SESSION_TOKEN. The dance-hall finds it on first MCP connect.
# No network call needed — filesystem is the registration mechanism.
#
# Cleanup: on harness EXIT, remove the session file (avoids ghost sessions).

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
{"sessionId":"${_mcp_token}","entity":"${ENTITY}","harness":"claude-code","host":"$(hostname -s)","pid":$$,"cwd":"${WORK_DIR}","createdAt":"$(date -u +%Y-%m-%dT%H:%M:%SZ)"}
MCPEOF
  export KOAD_IO_MCP_SESSION_TOKEN="$_mcp_token"
  echo "mcp_token     : ${_mcp_token:0:12}... (session file written)"
else
  echo "mcp_token     : uuid generation unavailable, MCP auth skipped" >&2
fi
unset _mcp_token _mcp_sess_dir

# Augment the EXIT trap to clean up the MCP session file.
_harness_on_exit() {
  local rc=$?
  _lock_cleanup
  rm -f "$_harness_pid_file" 2>/dev/null
  [ -n "$_harness_exit_emitted" ] && {
    [ -n "$_mcp_session_file" ] && rm -f "$_mcp_session_file" 2>/dev/null
    return
  }
  _harness_exit_emitted=1
  if [ "$rc" -eq 0 ]; then
    koad_io_emit_close "harness closed: claude $MODEL_RESOLVED ($_mode, clean exit)"
  elif [ "$rc" -eq 130 ]; then
    koad_io_emit_close "harness closed: claude $MODEL_RESOLVED ($_mode, interrupted)"
  else
    koad_io_emit_close "harness closed: claude $MODEL_RESOLVED ($_mode, exit $rc)"
  fi
  _harness_stamp_flight "$rc"
  [ -n "$_mcp_session_file" ] && rm -f "$_mcp_session_file" 2>/dev/null
}
# trap already set above — redefining _harness_on_exit is sufficient

# --- JSON .result extraction (ENTITY_EXTRACT_RESULT) ----------------------
#
# When ENTITY_EXTRACT_RESULT=true AND this is -p one-shot mode, force
# --output-format=json and pipe stdout through python3 to emit just the
# .result field. Gives orchestrators a clean string to parse without the
# JSON envelope noise. Interactive launches are unaffected.
if [ "${ENTITY_EXTRACT_RESULT:-false}" = "true" ] && [ -n "$PROMPT" ]; then
  _has_json=0
  for _a in "${_args[@]}"; do
    case "$_a" in --output-format=*|--output-format) _has_json=1 ;; esac
  done
  [ "$_has_json" = "0" ] && _args=(--output-format json "${_args[@]}")
  unset _a _has_json

  claude "${_args[@]}" 2>/dev/null | jq -r '.result // ""'
  exit ${PIPESTATUS[0]}
fi

# --- Launch ---------------------------------------------------------------
claude "${_args[@]}"
exit $?
