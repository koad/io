#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
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

HARNESS_DIR="$(dirname "${BASH_SOURCE[0]}")"

# Discover installed harnesses across EVERY command dir, not just this one.
#
# This used to scan its own directory only, which was right while all harnesses lived in
# the framework. They do not: the kindergarten keeps the building blocks (bash, zsh,
# default, opencode, ollama) and the operator's own harnesses live in ~/.forge/commands
# (throne, and the vendor integrations). A router that lists only its neighbours tells the
# operator half the truth — `harness throne` works but never appears in the usage list.
#
# KOAD_IO_COMMANDS_DIRS is the same ordered path the dispatcher descends, so discovery here
# matches resolution there. First hit wins; a name is listed once.
installed=()
_seen_harnesses=" "
for _cmd_dir in ${KOAD_IO_COMMANDS_DIRS//:/ }; do
  _hdir="$_cmd_dir/harness"
  [ -d "$_hdir" ] || continue
  for d in "$_hdir"/*/; do
    [ -f "$d/command.sh" ] || continue
    _name="$(basename "$d")"
    case "$_seen_harnesses" in *" $_name "*) continue ;; esac
    _seen_harnesses="$_seen_harnesses$_name "
    installed+=("$_name")
  done
done
installed=($(printf '%s
' "${installed[@]}" | sort))

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
echo "  1. setting <HARNESS>_CONFIG_DIR=~/.\$ENTITY     (SPEC-072)"
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

source "$HOME/.koad-io/helpers/discovery.sh" 2>/dev/null && _koad_io_hint
exit 0
