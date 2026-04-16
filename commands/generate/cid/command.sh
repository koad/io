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

# Delegate to node to guarantee byte-identical output to the Meteor function.
# Pure-bash sha256sum → alphabet mapping has numeric drift risk; node avoids that.
node - "$INPUT" <<'NODE'
const EASILY_RECOGNIZABLE = "23456789ABCDEFGHJKLMNPQRSTWXYZabcdefghijkmnopqrstuvwxyz";

function handle(str) {
  return str.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function cid(e) {
  const h = handle(e);
  if (!h) {
    process.stderr.write("generate cid: input normalizes to empty string — nothing to hash\n");
    process.exit(1);
  }
  const crypto = require("crypto");
  const digest = crypto.createHash("sha256").update(h).digest();
  let c = "";
  for (let i = 0; i < 17; i++) c += EASILY_RECOGNIZABLE[digest[i] % EASILY_RECOGNIZABLE.length];
  return c;
}

const input = process.argv[2] || "";
process.stdout.write(cid(input) + "\n");
NODE

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
