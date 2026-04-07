#!/usr/bin/env bash
set -euo pipefail

source "$HOME/.koad-io/.env" 2>/dev/null || true
source "$HOME/.${ENTITY:?ENTITY not set}/.env" 2>/dev/null || true

echo "[env] Loaded framework and entity env files"

ENTITY_DIR="${ENTITY_DIR:-$HOME/.$ENTITY}"
CALL_DIR="${CWD:-$PWD}"
echo "[config] ENTITY_DIR=$ENTITY_DIR, CALL_DIR=$CALL_DIR"

KOAD_IO_ENTITY_HARNESS="${KOAD_IO_ENTITY_HARNESS:-opencode}"
echo "[config] KOAD_IO_ENTITY_HARNESS=$KOAD_IO_ENTITY_HARNESS"

ENTITY_HOST="${ENTITY_HOST:-}"
echo "[config] ENTITY_HOST=$ENTITY_HOST"

REMOTE_HARNESS_BIN="${REMOTE_HARNESS_BIN:-$KOAD_IO_ENTITY_HARNESS}"
REMOTE_NVM_INIT="${REMOTE_NVM_INIT:-}"
echo "[config] REMOTE_HARNESS_BIN=$REMOTE_HARNESS_BIN, REMOTE_NVM_INIT=$REMOTE_NVM_INIT"

LOCKFILE="/tmp/entity-${ENTITY}.lock"

PROMPT="${PROMPT:-}"
FORCE_INTERACTIVE="${FORCE_INTERACTIVE:-}"
if [ -z "$PROMPT" ] && [ ! -t 0 ]; then
  PROMPT="$(cat)"
fi

echo "[debug] PROMPT length: ${#PROMPT}, FORCE_INTERACTIVE=$FORCE_INTERACTIVE"

# Only inject PRIMER.md if there's already a prompt (don't trigger non-interactive for nothing)
if [ -n "$PROMPT" ] && [ -f "${CALL_DIR}/PRIMER.md" ]; then
  PROJECT_PRIMER="$(cat "$CALL_DIR/PRIMER.md")"
  PROMPT="$(printf 'Project context (from %s/PRIMER.md):\n%s\n\n---\n\n%s' "$CALL_DIR" "$PROJECT_PRIMER" "$PROMPT")"
  echo "[primer] Injected PRIMER.md from $CALL_DIR ($(wc -c < "$CALL_DIR/PRIMER.md") bytes)"
fi

ON_HOME_MACHINE=true
if [ -n "$ENTITY_HOST" ] && [ "$(hostname -s)" != "$ENTITY_HOST" ]; then
  ON_HOME_MACHINE=false
fi

if [ "${FORCE_LOCAL:-}" = "1" ]; then
  ON_HOME_MACHINE=true
  echo "[force-local] FORCE_LOCAL=1, bypassing SSH"
fi
echo "[machine] ON_HOME_MACHINE=$ON_HOME_MACHINE (hostname: $(hostname -s), ENTITY_HOST: $ENTITY_HOST)"

if [ -n "$REMOTE_NVM_INIT" ]; then
  REMOTE_PREFIX="$REMOTE_NVM_INIT && "
else
  REMOTE_PREFIX=""
fi
echo "[remote] REMOTE_PREFIX set"

echo "[debug] PROMPT length: ${#PROMPT}, first 50 chars: '${PROMPT:0:50}'"
echo "[debug] Interactive check: PROMPT empty=$([ -z "$PROMPT" ] && echo true || echo false), stdin tty=$([ -t 0 ] && echo true || echo false)"

if [ -z "$PROMPT" ]; then
  echo "[mode] Interactive session"
  if $ON_HOME_MACHINE; then
    case "$KOAD_IO_ENTITY_HARNESS" in
      claude)
        echo "[exec] Running: claude . --model sonnet --add-dir $ENTITY_DIR"
        exec claude . --model sonnet --add-dir "$ENTITY_DIR"
        ;;
      opencode)
        echo "[exec] Running: opencode --agent $ENTITY --model ${OPENCODE_MODEL:-} ./"
        exec opencode --agent "$ENTITY" --model "${OPENCODE_MODEL:-}" ./
        ;;
      *)
        echo "[error] Unknown harness: $KOAD_IO_ENTITY_HARNESS" >&2
        exit 1
        ;;
    esac
  else
    echo "[exec] SSH to $ENTITY_HOST for interactive session"
    exec ssh -t "$ENTITY_HOST" \
      "${REMOTE_PREFIX}cd \$HOME/.$ENTITY && KOAD_IO_ENTITY_HARNESS=$KOAD_IO_ENTITY_HARNESS $REMOTE_HARNESS_BIN"
  fi
fi

echo "[mode] Non-interactive (orchestration)"

if [ "$KOAD_IO_ENTITY_HARNESS" = "opencode" ]; then
  EFFECTIVE_HARNESS=claude
  echo "[fallback] opencode → claude for non-interactive"
else
  EFFECTIVE_HARNESS="$KOAD_IO_ENTITY_HARNESS"
fi
echo "[harness] EFFECTIVE_HARNESS=$EFFECTIVE_HARNESS"

if [ -f "$LOCKFILE" ]; then
  LOCKED_PID=$(cat "$LOCKFILE" 2>/dev/null || echo "")
  if [ -n "$LOCKED_PID" ] && kill -0 "$LOCKED_PID" 2>/dev/null; then
    echo "[error] $ENTITY is busy (pid $LOCKED_PID). Try again shortly." >&2
    exit 1
  fi
  echo "[lock] Cleared stale lockfile"
fi
echo "[lock] Acquired lock: $LOCKFILE (pid: $$)"
echo $$ > "$LOCKFILE"
trap 'rm -f "$LOCKFILE"' EXIT

if $ON_HOME_MACHINE; then
  cd "$ENTITY_DIR"
  echo "[path] Changed to $ENTITY_DIR"
  case "$EFFECTIVE_HARNESS" in
    claude)
      echo "[exec] Running: claude --model sonnet --dangerously-skip-permissions -p <prompt>"
      claude --model sonnet --dangerously-skip-permissions --output-format=json \
        -p "$PROMPT" 2>/dev/null \
        | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('result',''))"
      ;;
    *)
      echo "[error] Unknown harness: $EFFECTIVE_HARNESS" >&2
      exit 1
      ;;
  esac
else
  echo "[exec] SSH to $ENTITY_HOST for non-interactive execution"
  ENCODED=$(printf '%s' "$PROMPT" | base64 -w0 2>/dev/null || printf '%s' "$PROMPT" | base64)
  ssh "$ENTITY_HOST" \
    "${REMOTE_PREFIX}cd \$HOME/.$ENTITY && DECODED=\$(echo '$ENCODED' | base64 -d) && $REMOTE_HARNESS_BIN --model sonnet --dangerously-skip-permissions --output-format=json -p \"\$DECODED\" 2>/dev/null" \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('result',''))"
fi
