#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# koad-io kingdom — kingdom lifecycle commands
#
# Subcommands:
#   init <chain-uri>   — bootstrap a kingdom garden from a chain URI (VESTA-SPEC-163)
#
# Usage:
#   koad-io kingdom init canadaecoin://<address>
#   koad-io kingdom init --help

set -euo pipefail

COMMANDS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

SUBCMD="${1:-}"

if [ -z "$SUBCMD" ]; then
  echo "koad-io kingdom — kingdom lifecycle commands" >&2
  echo "" >&2
  echo "Usage: koad-io kingdom <subcommand> [args]" >&2
  echo "" >&2
  echo "Subcommands:" >&2
  echo "  init <chain-uri>    Bootstrap a kingdom garden from a chain URI" >&2
  echo "" >&2
  source "$HOME/.koad-io/helpers/discovery.sh" 2>/dev/null && _koad_io_hint
  exit 0
fi

SUBCMD_PATH="$COMMANDS_DIR/$SUBCMD/command.sh"
if [ ! -x "$SUBCMD_PATH" ]; then
  echo "koad-io kingdom: unknown subcommand '$SUBCMD'" >&2
  echo "Run 'koad-io kingdom' for available subcommands." >&2
  exit 1
fi

shift
exec bash "$SUBCMD_PATH" "$@"
