#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# generate cid — derive a stable 17-char Content ID from a human name or handle
#
# Mirrors koad.generate.cid() from packages/core/both/global-helpers.js exactly.
# SHA-256 of the normalized handle, mapped through the EASILY_RECOGNIZABLE alphabet.
# Byte-identical to the Meteor function — safe to use in offline trust bonds.
#
# Usage:
#   koad-io generate cid "Addison Cameron-Huff"
#   koad-io generate cid addisoncameronhuff
#   echo "some string" | koad-io generate cid
#
# Output: 17-char CID, newline, exit 0
# Error:  exit 1 + stderr if input normalizes to empty string

set -euo pipefail

usage() {
  cat >&2 <<EOF
generate cid — derive a stable 17-char Content ID

Usage:
  koad-io generate cid "Human Name"
  koad-io generate cid handle
  echo "input" | koad-io generate cid

Normalization: lowercases, strips non-alphanumeric chars.
Source of truth: ~/.koad-io/packages/core/both/global-helpers.js (koad.generate.cid)
EOF
}

# Read input from arg or stdin
if [[ $# -gt 0 ]]; then
  case "$1" in
    -h|--help|help) usage; exit 0 ;;
  esac
  INPUT="$*"
elif [[ ! -t 0 ]]; then
  INPUT=$(cat)
else
  usage; exit 1
fi

# Delegate to @koad-io/node — canonical, byte-identical to the Meteor function.
KOAD_IO_DIR="${KOAD_IO_DIR:-$HOME/.koad-io}"

node --input-type=module -e "
import { koad } from '${KOAD_IO_DIR}/modules/node/index.js';
try {
  process.stdout.write(koad.generate.cid(process.argv[1]) + '\n');
} catch(e) {
  process.stderr.write('generate cid: ' + e.message + '\n');
  process.exit(1);
}
" "$INPUT"

# SANITY CHECK (commented out — run manually to verify byte-identical parity with Meteor)
# Expected output pairs (verified 2026-04-15 against koad.generate.cid in Meteor harness):
#
#   bash command.sh "alice"
#   # → ow8gKG2CWbavd4p6i
#
#   bash command.sh "Addison Cameron-Huff"
#   # → vPxbwQ4JP55aenfD4
#
#   bash command.sh "addisoncameronhuff"
#   # → vPxbwQ4JP55aenfD4   (same — normalization is idempotent)
#
#   bash command.sh "koad"
#   # → TysPFWq8Nr5LZQQnM
#
#   echo "!!!" | bash command.sh
#   # → exit 1, stderr: "generate cid: input normalizes to empty string — nothing to hash"
