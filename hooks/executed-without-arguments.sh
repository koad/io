#!/usr/bin/env bash
set -euo pipefail
echo && echo

if [ -z "${ENTITY:-}" ]; then
  echo "no arguments given, no obvious directive.  exiting..."
  exit 1
fi

export OPENCODE_CONFIG_DIR="$HOME/.$ENTITY/opencode"
export OPENCODE_MODEL="${OPENCODE_MODEL:-opencode/big-pickle}"

source "$HOME/.koad-io/.env" || true
source "$HOME/.$ENTITY/.env" || true

# default model
export OPENCODE_MODEL="${OPENCODE_MODEL:-opencode/big-pickle}"

# detect binary
if [ -x "$HOME/.koad-io/bin/opencode" ]; then
    OPENCODE_BINARY="$HOME/.koad-io/bin/opencode"
elif command -v opencode &> /dev/null; then
    OPENCODE_BINARY="$(command -v opencode)"
else
    SHELL_NAME="${SHELL:-/bin/bash}"
    if command -v gnome-terminal &> /dev/null; then
        echo "No opencode binary found, dropping into $SHELL_NAME"
        gnome-terminal -- "$SHELL"
    else
        echo "No terminal emulator found and opencode binary not available."
        echo "Dropping into shell: $SHELL_NAME"
        exec "$SHELL_NAME"
    fi
    exit 0
fi

echo "Launching OpenCode agent '$ENTITY' with model '$OPENCODE_MODEL'"
echo "Using config dir: $OPENCODE_CONFIG_DIR"
sleep .5
"$OPENCODE_BINARY" --agent "$ENTITY" --model "$OPENCODE_MODEL" "./"
