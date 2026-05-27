#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# generate mnemonic — produce a valid BIP39 mnemonic with optional word pinning
#
# Delegates to koad.generate.mnemonic() from @koad-io/node.
#
# Usage:
#   koad-io generate mnemonic                     # 24 words
#   koad-io generate mnemonic 12                  # 12 words
#   koad-io generate mnemonic 24 zoo kingdom      # pin first two words
#   koad-io generate mnemonic 12 bright           # pin first word only

set -euo pipefail

usage() {
  cat >&2 <<EOF
generate mnemonic — produce a valid BIP39 mnemonic

Usage:
  koad-io generate mnemonic [wordCount] [firstWord] [secondWord]

  wordCount   12 or 24 (default: 24)
  firstWord   optional — pin the first word (must be in BIP39 english wordlist)
  secondWord  optional — pin the second word (must be in BIP39 english wordlist)

Examples:
  koad-io generate mnemonic
  koad-io generate mnemonic 12
  koad-io generate mnemonic 24 zoo kingdom
  koad-io generate mnemonic 12 bright
EOF
}

case "${1:-}" in
  -h|--help|help) usage; exit 0 ;;
esac

WORD_COUNT="${1:-24}"
FIRST_WORD="${2:-}"
SECOND_WORD="${3:-}"

KOAD_IO_DIR="${KOAD_IO_DIR:-$HOME/.koad-io}"

exec node --input-type=module -e "
import { koad } from '${KOAD_IO_DIR}/modules/node/index.js';
const wc = parseInt('${WORD_COUNT}', 10);
const first = '${FIRST_WORD}' || undefined;
const second = '${SECOND_WORD}' || undefined;
console.log(koad.generate.mnemonic(wc, first, second));
"
