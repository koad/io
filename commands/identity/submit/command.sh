#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# koad-io identity submit — publish entity sigchain to IPFS + optionally anchor on-chain
#
# Implements VESTA-SPEC-150 v1.1 (Sigchain Head Submission Protocol) bootstrap module
# obligations (§12): build genesis + leaf-authorize sigchain entries, pin to IPFS,
# broadcast SPEC-150 submission to known Vesta endpoints, optionally anchor on-chain
# via ROOTY-SPEC-001 OP_RETURN broadcast.
#
# Reads from:
#   ~/.<entity>/id/master.pub.asc     — Master public key
#   ~/.<entity>/id/leaf.private.asc   — Device leaf private key (encrypted)
#   ~/.<entity>/id/device.key         — Device key for leaf decryption (Path B)
#   ~/.<entity>/id/identity.json      — Identity metadata (fingerprints)
#
# Writes to (on success):
#   ~/.<entity>/id/identity.json      — Updated with sigchain_tip_cid + per-entry CIDs
#   ~/.vesta/entities/<entity>/sigchain/ — Local Vesta registry update
#
# Usage:
#   koad-io identity submit
#   koad-io identity submit --entity <name>
#   koad-io identity submit --entity <name> --dry-run
#   koad-io identity submit --entity <name> --ipfs-api http://127.0.0.1:5001
#   koad-io identity submit --entity <name> --anchor-chain cdn
#   koad-io identity submit --entity <name> --verify-after
#
# Flags:
#   --entity=<name>            Entity handle. Defaults to $ENTITY env or current dir name.
#   --passphrase=<phrase>      Leaf decryption passphrase (Path A). Reads device.key by default.
#   --ipfs-api=<url>           IPFS HTTP API URL (default: http://127.0.0.1:5001).
#   --anchor-chain=<ticker>    Anchor sigchain tip on-chain (cdn, btc, doge). Optional.
#   --anchor-key=<path>        Path to chain wallet key file (required if --anchor-chain set).
#   --dry-run                  Build entries + submission, do not pin or anchor.
#   --verify-after             Run 'koad-io identity verify' immediately after submission.
#   --vesta-url=<url>          HTTP URL of a Vesta daemon to push submission to. Optional.
#   --no-vesta-write           Skip local Vesta registry write (default: write local registry).

set -euo pipefail

SUBMIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRIDGE_SCRIPT="$SUBMIT_DIR/submit-bridge.mjs"

# ---------------------------------------------------------------------------
# Flag parsing
# ---------------------------------------------------------------------------

ENTITY_ARG=""
PASSPHRASE_ARG=""
IPFS_API_ARG="http://127.0.0.1:5001"
ANCHOR_CHAIN_ARG=""
ANCHOR_KEY_ARG=""
DRY_RUN_FLAG="false"
VERIFY_AFTER_FLAG="false"
VESTA_URL_ARG=""
NO_VESTA_WRITE_FLAG="false"

for arg in "$@"; do
  case "$arg" in
    --entity=*)          ENTITY_ARG="${arg#--entity=}"          ;;
    --passphrase=*)      PASSPHRASE_ARG="${arg#--passphrase=}"   ;;
    --ipfs-api=*)        IPFS_API_ARG="${arg#--ipfs-api=}"       ;;
    --anchor-chain=*)    ANCHOR_CHAIN_ARG="${arg#--anchor-chain=}" ;;
    --anchor-key=*)      ANCHOR_KEY_ARG="${arg#--anchor-key=}"   ;;
    --vesta-url=*)       VESTA_URL_ARG="${arg#--vesta-url=}"     ;;
    --dry-run)           DRY_RUN_FLAG="true"                     ;;
    --verify-after)      VERIFY_AFTER_FLAG="true"                ;;
    --no-vesta-write)    NO_VESTA_WRITE_FLAG="true"              ;;
    --help|-h)
      grep '^#' "$0" | head -40 | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "koad-io identity submit: unknown flag: $arg" >&2
      echo "Run 'koad-io identity submit --help' for usage." >&2
      exit 1
      ;;
  esac
done

# ---------------------------------------------------------------------------
# Resolve entity handle
# ---------------------------------------------------------------------------

RESOLVED_ENTITY=""
if [ -n "$ENTITY_ARG" ]; then
  RESOLVED_ENTITY="$ENTITY_ARG"
elif [ -n "${ENTITY:-}" ]; then
  RESOLVED_ENTITY="$ENTITY"
else
  RESOLVED_ENTITY="$(basename "$PWD" | sed 's/^\.//')"
fi

if [ -z "$RESOLVED_ENTITY" ]; then
  echo "koad-io identity submit: entity name is required (--entity=<name> or set \$ENTITY)" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Verify identity files exist
# ---------------------------------------------------------------------------

ID_DIR="$HOME/.$RESOLVED_ENTITY/id"
if [ ! -f "$ID_DIR/master.pub.asc" ]; then
  echo "koad-io identity submit: no identity found at $ID_DIR/master.pub.asc" >&2
  echo "  Run 'koad-io identity init --entity=$RESOLVED_ENTITY' first." >&2
  exit 1
fi
if [ ! -f "$ID_DIR/leaf.private.asc" ]; then
  echo "koad-io identity submit: leaf.private.asc not found at $ID_DIR/" >&2
  exit 1
fi
if [ ! -f "$ID_DIR/identity.json" ]; then
  echo "koad-io identity submit: identity.json not found at $ID_DIR/" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Detect Node.js
# ---------------------------------------------------------------------------

if ! command -v node >/dev/null 2>&1; then
  echo "koad-io identity submit: Node.js is required but not found in PATH" >&2
  exit 1
fi

NODE_VERSION=$(node --version 2>/dev/null | sed 's/^v//')
NODE_MAJOR="${NODE_VERSION%%.*}"
if [ "${NODE_MAJOR:-0}" -lt 18 ]; then
  echo "koad-io identity submit: Node.js >= 18 required (found v${NODE_VERSION})" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Validate anchor-chain usage
# ---------------------------------------------------------------------------

if [ -n "$ANCHOR_CHAIN_ARG" ] && [ -z "$ANCHOR_KEY_ARG" ] && [ "$DRY_RUN_FLAG" = "false" ]; then
  echo "koad-io identity submit: --anchor-chain requires --anchor-key=<path>" >&2
  echo "  To simulate without a real key: add --dry-run" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Delegate to Node bridge
# ---------------------------------------------------------------------------

export KOAD_IO_SUBMIT_ENTITY="$RESOLVED_ENTITY"
export KOAD_IO_SUBMIT_PASSPHRASE="$PASSPHRASE_ARG"
export KOAD_IO_SUBMIT_IPFS_API="$IPFS_API_ARG"
export KOAD_IO_SUBMIT_ANCHOR_CHAIN="$ANCHOR_CHAIN_ARG"
export KOAD_IO_SUBMIT_ANCHOR_KEY="$ANCHOR_KEY_ARG"
export KOAD_IO_SUBMIT_DRY_RUN="$( [ "$DRY_RUN_FLAG" = "true" ] && echo "1" || echo "0" )"
export KOAD_IO_SUBMIT_VESTA_URL="$VESTA_URL_ARG"
export KOAD_IO_SUBMIT_NO_VESTA_WRITE="$( [ "$NO_VESTA_WRITE_FLAG" = "true" ] && echo "1" || echo "0" )"

node "$BRIDGE_SCRIPT"
BRIDGE_EXIT=$?

if [ $BRIDGE_EXIT -ne 0 ]; then
  exit $BRIDGE_EXIT
fi

# ---------------------------------------------------------------------------
# Optional: run verify immediately after
# ---------------------------------------------------------------------------

if [ "$VERIFY_AFTER_FLAG" = "true" ]; then
  echo ""
  echo "--- Running identity verify ---"
  VERIFY_CMD="$SUBMIT_DIR/../verify/command.sh"
  if [ -x "$VERIFY_CMD" ]; then
    bash "$VERIFY_CMD" "--entity=$RESOLVED_ENTITY"
  else
    echo "koad-io identity submit: --verify-after requested but verify command not found at $VERIFY_CMD" >&2
  fi
fi

# ---------------------------------------------------------------------------
# Self-documenting footer
# ---------------------------------------------------------------------------
# shellcheck disable=SC2317
_KOAD_IO_COMMAND_HELP() {
  echo "identity submit — publish entity sigchain to IPFS (VESTA-SPEC-150)"
  echo ""
  echo "Flags:"
  echo "  --entity=<name>         Entity handle (default: \$ENTITY or current dir name)"
  echo "  --passphrase=<phrase>   Leaf key passphrase (Path A; default: reads device.key)"
  echo "  --ipfs-api=<url>        IPFS HTTP API (default: http://127.0.0.1:5001)"
  echo "  --anchor-chain=<ticker> Anchor on-chain: cdn, btc, doge (optional)"
  echo "  --anchor-key=<path>     Chain wallet key path (required if --anchor-chain set)"
  echo "  --vesta-url=<url>       Vesta HTTP endpoint to notify (optional)"
  echo "  --dry-run               Build entries, do not pin or anchor"
  echo "  --verify-after          Run identity verify after submission"
  echo "  --no-vesta-write        Skip local ~/.vesta/ registry write"
}
source "$HOME/.koad-io/helpers/discovery.sh" 2>/dev/null && _koad_io_hint
