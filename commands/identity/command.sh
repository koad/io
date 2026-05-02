#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# koad-io identity — entity identity lifecycle commands (VESTA-SPEC-149, SPEC-150)
#
# Subcommands:
#   init    — generate a fresh entity identity (BIP39 master + device leaf)
#   submit  — publish sigchain to IPFS + anchor on-chain (SPEC-150)
#   verify  — verify sigchain integrity (SPEC-111 + SPEC-150)
#
# Usage:
#   koad-io identity init [--entity <name>] [--mnemonic <phrase>] [--dry-run]
#   koad-io identity submit [--entity <name>] [--dry-run] [--anchor-chain cdn]
#   koad-io identity verify [--entity <name>] [--verbose]

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
  echo "  submit  Publish sigchain to IPFS + notify Vesta + optional chain anchor" >&2
  echo "  verify  Verify sigchain integrity (signatures, CID links, Vesta consistency)" >&2
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
