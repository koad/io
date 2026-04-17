#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# profile verify — walk a sigchain from a tip CID and verify all signatures
#
# Fetches each entry via `ipfs dag get`, recomputes the CID, verifies the
# Ed25519 signature. Walks from tip to genesis. Maintains the device key
# authorization set per SPEC-111 §6.5.
#
# Usage:
#   $ENTITY profile verify <CID>
#   $ENTITY profile verify                 # verifies own chain (reads from sigchain-tip)
#   $ENTITY profile verify --entity alice  # verifies alice's chain tip from their var/
#
# Requires:
#   - ipfs CLI + running daemon (for dag get)
#   - openssl (for Ed25519 signature verification)
#   - node (for canonical dag-json pre-image computation)

set -euo pipefail

ENTITY="${ENTITY:-koad}"
ENTITY_DIR="${ENTITY_DIR:-$HOME/.$ENTITY}"
SIGCHAIN_TIP_FILE="$ENTITY_DIR/var/sigchain-tip"

# ── Usage ─────────────────────────────────────────────────────────────────────

usage() {
  cat >&2 <<EOF
profile verify — walk a sigchain from tip to genesis, verify all signatures

Usage:
  $ENTITY profile verify <CID>              verify chain starting at given CID
  $ENTITY profile verify                    verify own chain (reads $SIGCHAIN_TIP_FILE)
  $ENTITY profile verify --entity NAME      verify named entity's chain

Options:
  --entity NAME         Resolve tip from ~./NAME/var/sigchain-tip
  --stop-at N           Stop after verifying N entries (default: unlimited)
  --json                Output verification results as JSON
  -h, --help            Show this help

Exit codes:
  0 — chain valid
  1 — chain invalid or error
  2 — missing prerequisites

Requires: ipfs CLI, openssl, node

See also:
  $ENTITY profile view     — display resolved profile
  $ENTITY profile publish  — announce tip to canonical location
EOF
}

# ── Arg parsing ───────────────────────────────────────────────────────────────

TARGET_CID=""
TARGET_ENTITY=""
STOP_AT=0
JSON_OUTPUT=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --entity) TARGET_ENTITY="$2"; shift 2 ;;
    --stop-at) STOP_AT="$2"; shift 2 ;;
    --json) JSON_OUTPUT=true; shift ;;
    -h|--help|help) usage; exit 0 ;;
    -*) echo "profile verify: unknown option: $1" >&2; usage; exit 1 ;;
    *) TARGET_CID="$1"; shift ;;
  esac
done

# ── Resolve tip CID ───────────────────────────────────────────────────────────

if [[ -z "$TARGET_CID" ]]; then
  if [[ -n "$TARGET_ENTITY" ]]; then
    TIP_FILE="$HOME/.$TARGET_ENTITY/var/sigchain-tip"
  else
    TIP_FILE="$SIGCHAIN_TIP_FILE"
  fi

  if [[ ! -f "$TIP_FILE" ]]; then
    echo "profile verify: no tip CID found at $TIP_FILE" >&2
    echo "Provide a CID explicitly: $ENTITY profile verify <CID>" >&2
    exit 1
  fi

  TARGET_CID=$(cat "$TIP_FILE")
fi

# ── Prerequisite check ────────────────────────────────────────────────────────

if ! command -v ipfs &>/dev/null; then
  echo "profile verify: ipfs CLI not found. Install go-ipfs or kubo." >&2
  exit 2
fi

if ! command -v openssl &>/dev/null; then
  echo "profile verify: openssl not found." >&2
  exit 2
fi

if ! command -v node &>/dev/null; then
  echo "profile verify: node not found. Required for canonical dag-json serialization." >&2
  exit 2
fi

# ── Chain walk ────────────────────────────────────────────────────────────────

echo "Verifying sigchain from tip: $TARGET_CID"
echo ""

CURRENT_CID="$TARGET_CID"
ENTRY_COUNT=0
ERRORS=()
CHAIN_ENTITY=""

# TODO: implement full chain walk with crypto verification.
# The walk should:
#
#   1. Fetch entry: ipfs dag get "$CURRENT_CID" → JSON
#
#   2. Recompute CID:
#      echo "$ENTRY_JSON" | ipfs dag put --input-codec dag-json --store-codec dag-json
#      Assert computed CID == $CURRENT_CID
#
#   3. Verify signature (SPEC-111 §3.4):
#      - Extract pre-image: canonical dag-json with 'signature' field absent, keys sorted
#        (use node script for deterministic serialization)
#      - Decode base64url signature → raw bytes
#      - Resolve signing key (root pubkey from genesis, or device key from auth set)
#      - openssl pkeyutl -verify -rawin -inkey <pubkey-pem> -sigfile <sig-raw>
#
#   4. For koad.device-key-add entries: also verify reverse_sig per §5.4.1
#
#   5. Maintain device key authorization set per §6.5:
#      - Initialize with genesis payload.pubkey
#      - Add keys on device-key-add (after reverse_sig verification)
#      - Remove keys on device-key-revoke
#
#   6. Advance: CURRENT_CID = entry.previous; stop when previous == null (genesis)
#
# For now: stub the walk to show the expected output shape.

echo "TODO: crypto verification not yet implemented — scaffold only" >&2
echo ""

# Stub: show what a successful verification looks like
echo "  [1] $TARGET_CID"
echo "      type:      koad.state-update (scope:profile)"
echo "      entity:    (TODO: fetch from IPFS)"
echo "      timestamp: (TODO: fetch from IPFS)"
echo "      CID:       TODO — recompute and assert"
echo "      signature: TODO — verify Ed25519 against authorized key"
echo "      previous:  TODO — fetch predecessor"
echo ""
echo "  [N] <genesis-cid>"
echo "      type:      koad.genesis"
echo "      CID:       TODO"
echo "      signature: TODO — verify against genesis pubkey"
echo "      previous:  null (chain root)"
echo ""

echo "TODO: implement chain walk in $0"
echo "See SPEC-111 §3.4 and §6.5 for verification rules."
echo ""

# Exit 1 (not verified) until implementation is complete
echo "profile verify: result: UNVERIFIED (scaffold — implementation pending)"
exit 1
