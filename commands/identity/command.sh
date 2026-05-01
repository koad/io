#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# koad-io identity — entity identity lifecycle commands (VESTA-SPEC-149)
#
# Subcommands:
#   init   — generate a fresh entity identity (BIP39 master + device leaf)
#
# Usage:
#   koad-io identity init [--entity <name>] [--mnemonic <phrase>] [--dry-run]

set -euo pipefail

COMMANDS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

SUBCMD="${1:-}"

if [ -z "$SUBCMD" ]; then
  echo "koad-io identity — entity identity lifecycle commands" >&2
  echo "" >&2
  echo "Usage: koad-io identity <subcommand> [args]" >&2
  echo "" >&2
  echo "Subcommands:" >&2
  echo "  init    Generate a fresh entity identity (BIP39 master + device leaf)" >&2
  echo "" >&2
  source "$HOME/.koad-io/helpers/discovery.sh" 2>/dev/null && _koad_io_hint
  exit 0
fi

SUBCMD_PATH="$COMMANDS_DIR/$SUBCMD/command.sh"
if [ ! -x "$SUBCMD_PATH" ]; then
  echo "koad-io identity: unknown subcommand '$SUBCMD'" >&2
  echo "Run 'koad-io identity' for available subcommands." >&2
  exit 1
fi

shift
exec bash "$SUBCMD_PATH" "$@"
