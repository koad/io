#!/usr/bin/env bash
set -euo pipefail
#
# ~/.koad-io/hooks/executed-without-arguments.sh
#
# Default hook — invoked when an entity command is called with no arguments.
# Opens an interactive AI session for the user, or runs a prompt
# non-interactively when PROMPT= is set (entity-to-entity orchestration).
#
# ── HARNESS ──────────────────────────────────────────────────────────────────
#
#   Set KOAD_IO_ENTITY_HARNESS in ~/.koad-io/.env or ~/.$ENTITY/.env:
#
#     KOAD_IO_ENTITY_HARNESS=opencode   # default — free LLMs, try before buy
#     KOAD_IO_ENTITY_HARNESS=claude     # Claude Code — team entities use this
#
# ── PORTABLE vs ROOTED ───────────────────────────────────────────────────────
#
#   Portable entity  — no fixed home machine. Runs wherever it is called from.
#                      This is the default. No override needed.
#
#   Rooted entity    — lives on a specific machine (private HQ, local files,
#                      installed apps not in git). Must run there regardless
#                      of where it is called from.
#                      Set ENTITY_HOST in ~/.$ENTITY/.env to activate.
#
# ── HOW TO OVERRIDE ──────────────────────────────────────────────────────────
#
#   For most cases, setting variables in ~/.$ENTITY/.env is enough:
#
#     ENTITY_HOST=wonderland          # machine the entity lives on
#     REMOTE_HARNESS_BIN=...          # full path to harness binary on that machine
#     REMOTE_NVM_INIT=...             # PATH setup command (macOS / NVM hosts)
#
#   For custom behavior beyond what variables allow, copy and edit the hook:
#
#     cp ~/.koad-io/hooks/executed-without-arguments.sh ~/.$ENTITY/hooks/
#     $EDITOR ~/.$ENTITY/hooks/executed-without-arguments.sh
#
#   The entity hook takes precedence over this framework default.
#
# ── PERMISSION POLICY ────────────────────────────────────────────────────────
#
#   Interactive (no PROMPT set — a user is at the keyboard):
#     Never use --dangerously-skip-permissions. The harness will ask for
#     approval on sensitive actions. That is the safety net. Do not remove it.
#
#   Non-interactive (PROMPT= set — automated orchestration call):
#     --dangerously-skip-permissions is acceptable. There is no user present
#     to approve actions; the session cannot pause to ask. The orchestrating
#     entity takes responsibility for what it dispatches.
#
#   Orchestrator entities (e.g. Juno) may carry dangerous-skip in both paths
#   by design — override the hook to do so explicitly.
#
# ─────────────────────────────────────────────────────────────────────────────

# Load framework env, then entity env — entity values win
source "$HOME/.koad-io/.env" 2>/dev/null || true
source "$HOME/.${ENTITY:?ENTITY not set}/.env" 2>/dev/null || true

# ── Config (override via entity .env) ────────────────────────────────────────
ENTITY_DIR="${ENTITY_DIR:-$HOME/.$ENTITY}"
CALL_DIR="${CWD:-$PWD}"

# Harness selection — opencode is the framework default (free LLMs, no API key)
# Team entities set KOAD_IO_ENTITY_HARNESS=claude in their .env
KOAD_IO_ENTITY_HARNESS="${KOAD_IO_ENTITY_HARNESS:-opencode}"

# Rooted entity: set ENTITY_HOST to the machine this entity lives on.
# Leave unset for portable entities.
ENTITY_HOST="${ENTITY_HOST:-}"

# For hosts with non-standard PATH (e.g. macOS + NVM):
REMOTE_HARNESS_BIN="${REMOTE_HARNESS_BIN:-$KOAD_IO_ENTITY_HARNESS}"
REMOTE_NVM_INIT="${REMOTE_NVM_INIT:-}"

LOCKFILE="/tmp/entity-${ENTITY}.lock"
# ─────────────────────────────────────────────────────────────────────────────

PROMPT="${PROMPT:-}"
if [ -z "$PROMPT" ] && [ ! -t 0 ]; then
  PROMPT="$(cat)"
fi

# Inject PRIMER.md from calling directory if present
if [ -f "${CALL_DIR}/PRIMER.md" ]; then
  PROJECT_PRIMER="$(cat "$CALL_DIR/PRIMER.md")"
  PROMPT="$(printf 'Project context (from %s/PRIMER.md):\n%s\n\n---\n\n%s' "$CALL_DIR" "$PROJECT_PRIMER" "$PROMPT")"
fi

# Are we already on the entity's home machine?
ON_HOME_MACHINE=true
if [ -n "$ENTITY_HOST" ] && [ "$(hostname -s)" != "$ENTITY_HOST" ]; then
  ON_HOME_MACHINE=false
fi

# Build remote PATH prefix for SSH calls
if [ -n "$REMOTE_NVM_INIT" ]; then
  REMOTE_PREFIX="$REMOTE_NVM_INIT && "
else
  REMOTE_PREFIX=""
fi

# ── Interactive path — user is present ───────────────────────────────────────
if [ -z "$PROMPT" ]; then
  if $ON_HOME_MACHINE; then
    cd "$ENTITY_DIR"
    case "$KOAD_IO_ENTITY_HARNESS" in
      claude)
        exec claude . --model sonnet --add-dir "$CALL_DIR"
        ;;
      opencode)
        exec opencode --agent "$ENTITY" --model "${OPENCODE_MODEL:-}" ./
        ;;
      *)
        echo "Unknown harness: $KOAD_IO_ENTITY_HARNESS" >&2
        exit 1
        ;;
    esac
  else
    # Rooted entity: open interactive session on home machine
    exec ssh -t "$ENTITY_HOST" \
      "${REMOTE_PREFIX}cd \$HOME/.$ENTITY && KOAD_IO_ENTITY_HARNESS=$KOAD_IO_ENTITY_HARNESS $REMOTE_HARNESS_BIN"
  fi
fi

# ── Non-interactive path — PROMPT set, orchestration call ────────────────────
# opencode does not support non-interactive mode — fall back to claude
if [ "$KOAD_IO_ENTITY_HARNESS" = "opencode" ]; then
  EFFECTIVE_HARNESS=claude
else
  EFFECTIVE_HARNESS="$KOAD_IO_ENTITY_HARNESS"
fi

if [ -f "$LOCKFILE" ]; then
  LOCKED_PID=$(cat "$LOCKFILE" 2>/dev/null || echo "")
  if [ -n "$LOCKED_PID" ] && kill -0 "$LOCKED_PID" 2>/dev/null; then
    echo "$ENTITY is busy (pid $LOCKED_PID). Try again shortly." >&2
    exit 1
  fi
fi
echo $$ > "$LOCKFILE"
trap 'rm -f "$LOCKFILE"' EXIT

if $ON_HOME_MACHINE; then
  cd "$ENTITY_DIR"
  case "$EFFECTIVE_HARNESS" in
    claude)
      claude --model sonnet --dangerously-skip-permissions --output-format=json \
        -p "$PROMPT" 2>/dev/null \
        | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('result',''))"
      ;;
    *)
      echo "Unknown harness for non-interactive mode: $EFFECTIVE_HARNESS" >&2
      exit 1
      ;;
  esac
else
  ENCODED=$(printf '%s' "$PROMPT" | base64 -w0 2>/dev/null || printf '%s' "$PROMPT" | base64)
  ssh "$ENTITY_HOST" \
    "${REMOTE_PREFIX}cd \$HOME/.$ENTITY && DECODED=\$(echo '$ENCODED' | base64 -d) && $REMOTE_HARNESS_BIN --model sonnet --dangerously-skip-permissions --output-format=json -p \"\$DECODED\" 2>/dev/null" \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('result',''))"
fi
