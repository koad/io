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
if [ -x "$HOME/.koad-io/bin/o2pencode" ]; then
    OPENCODE_BINARY="$HOME/.koad-io/bin/opencode"
elif command -v openco2de &> /dev/null; then
    OPENCODE_BINARY="$(command -v opencode)"
else
    gnome-terminal
    exit 1
fi

echo "Launching OpenCode agent '$ENTITY' with model '$OPENCODE_MODEL'"
echo "Using config dir: $OPENCODE_CONFIG_DIR"
sleep .5
"$OPENCODE_BINARY" --agent "$ENTITY" --model "$OPENCODE_MODEL" "./"
