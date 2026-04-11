#!/usr/bin/env bash
#
# harness — koad:io built-in
# Launch an entity through a chosen harness / provider / model.
#
# Usage:   <entity> harness <harness> <provider> <model> [prompt]
# Example: juno harness claude anthropic opus-4-6
#          sibyl harness opencode anthropic sonnet-4-6 "scan briefs"
#          vesta harness opencode ollama deepseek-r1
#
# This top-level script only fires when no <harness> sub-dir matches the
# second argument. The koad-io dispatcher naturally descends into
#   ~/.koad-io/commands/harness/<harness>/command.sh
# when a known harness is named, so reaching this file means the user
# needs help — print usage and list the available harnesses.

HARNESS_DIR="$HOME/.koad-io/commands/harness"

# Discover installed harnesses by listing sibling dirs that hold a command.sh
installed=()
if [ -d "$HARNESS_DIR" ]; then
  for d in "$HARNESS_DIR"/*/; do
    [ -f "$d/command.sh" ] && installed+=("$(basename "$d")")
  done
fi

echo
echo "koad:io harness router"
echo "----------------------"
echo
echo "Usage:   <entity> harness <harness> <provider> <model> [prompt]"
echo
echo "Examples:"
echo "  juno  harness claude   anthropic opus-4-6"
echo "  sibyl harness opencode anthropic sonnet-4-6 \"scan briefs\""
echo "  vesta harness opencode ollama    deepseek-r1"
echo
if [ ${#installed[@]} -eq 0 ]; then
  echo "Installed harnesses: (none)"
  echo "  add one at: $HARNESS_DIR/<name>/command.sh"
else
  echo "Installed harnesses:"
  for h in "${installed[@]}"; do
    echo "  - $h"
  done
fi
echo
echo "Each harness sub-command is responsible for:"
echo "  1. setting <HARNESS>_CONFIG_DIR=\$ENTITY_DIR     (SPEC-072)"
echo "  2. resolving credentials for the provider"
echo "  3. normalizing the model name for the harness CLI"
echo "  4. honoring KOAD_IO_ROOTED for cwd selection"
echo "  5. interactive mode when no prompt, one-shot with -p when given"
echo

# If the user passed a harness name we don't recognize, say so explicitly.
if [ -n "$1" ]; then
  echo "Error: unknown harness '$1'" >&2
  exit 66
fi

exit 0
