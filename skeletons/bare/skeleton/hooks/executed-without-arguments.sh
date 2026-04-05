#!/usr/bin/env bash
set -euo pipefail
# ENTITY_NAME — headquartered at fourty4.

ENTITY_HOST="fourty4"
ENTITY_DIR="\$HOME/.ENTITY_NAME"
CLAUDE_BIN="\$HOME/.nvm/versions/node/v24.14.0/bin/claude"
NVM_INIT="export PATH=/opt/homebrew/bin:\$HOME/.nvm/versions/node/v24.14.0/bin:\$PATH"
LOCKFILE="/tmp/entity-ENTITY_NAME.lock"

PROMPT="${PROMPT:-}"
if [ -z "$PROMPT" ] && [ ! -t 0 ]; then
  PROMPT="$(cat)"
fi

# Inject project PRIMER.md from CWD if present — gives entity context about
# where it was called from without needing a CLAUDE.md in the project directory
if [ -f "${CWD:-}/PRIMER.md" ]; then
  PROJECT_PRIMER="$(cat "$CWD/PRIMER.md")"
  PROMPT="$(printf 'Project context (from %s/PRIMER.md):\n%s\n\n---\n\n%s' "$CWD" "$PROJECT_PRIMER" "$PROMPT")"
fi

if [ -n "$PROMPT" ]; then
  # PID lock — prevent concurrent non-interactive invocations
  if [ -f "$LOCKFILE" ]; then
    LOCKED_PID=$(cat "$LOCKFILE" 2>/dev/null || echo "")
    if [ -n "$LOCKED_PID" ] && kill -0 "$LOCKED_PID" 2>/dev/null; then
      echo "ENTITY_NAME is busy (pid $LOCKED_PID). Try again shortly." >&2
      exit 1
    fi
  fi
  echo $$ > "$LOCKFILE"
  trap 'rm -f "$LOCKFILE"' EXIT

  ENCODED=$(printf '%s' "$PROMPT" | base64 -w0 2>/dev/null || printf '%s' "$PROMPT" | base64)
  ssh "$ENTITY_HOST" "$NVM_INIT && cd $ENTITY_DIR && DECODED=\$(echo '$ENCODED' | base64 -d) && $CLAUDE_BIN --model sonnet --dangerously-skip-permissions --output-format=json -p \"\$DECODED\" 2>/dev/null" \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('result',''))"
else
  exec ssh -t "$ENTITY_HOST" "$NVM_INIT && cd $ENTITY_DIR && $CLAUDE_BIN --model sonnet --dangerously-skip-permissions -c"
fi
