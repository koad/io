#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# koad-io identity verify — verify entity sigchain integrity (VESTA-SPEC-111 + SPEC-150)
#
# Reads the entity's identity.json + local Vesta registry and verifies:
#   - Sigchain entry signatures cascade correctly (genesis → leaf-authorize chain)
#   - Submission object shape is correct (protocol, fingerprints, timestamps)
#   - Vesta registry is consistent with identity.json
#
# Does NOT fetch from IPFS (IPFS fetch is a separate online operation).
# Works against locally-cached entries written by identity submit.
#
# Usage:
#   koad-io identity verify
#   koad-io identity verify --entity <name>
#   koad-io identity verify --entity <name> --verbose
#
# Flags:
#   --entity=<name>     Entity handle. Defaults to $ENTITY env or current dir name.
#   --passphrase=<phrase>  Leaf key passphrase (Path A). Default: reads device.key.
#   --verbose           Print detailed per-entry verification results.
#   --json              Output results as JSON.

set -euo pipefail

VERIFY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRIDGE_SCRIPT="$VERIFY_DIR/verify-bridge.mjs"

# ---------------------------------------------------------------------------
# Flag parsing
# ---------------------------------------------------------------------------

ENTITY_ARG=""
PASSPHRASE_ARG=""
VERBOSE_FLAG="false"
JSON_FLAG="false"

for arg in "$@"; do
  case "$arg" in
    --entity=*)      ENTITY_ARG="${arg#--entity=}"       ;;
    --passphrase=*)  PASSPHRASE_ARG="${arg#--passphrase=}" ;;
    --verbose)       VERBOSE_FLAG="true"                  ;;
    --json)          JSON_FLAG="true"                     ;;
    --help|-h)
      grep '^#' "$0" | head -25 | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "koad-io identity verify: unknown flag: $arg" >&2
      echo "Run 'koad-io identity verify --help' for usage." >&2
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
  echo "koad-io identity verify: entity name is required (--entity=<name> or set \$ENTITY)" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Detect Node.js
# ---------------------------------------------------------------------------

if ! command -v node >/dev/null 2>&1; then
  echo "koad-io identity verify: Node.js is required but not found in PATH" >&2
  exit 1
fi

NODE_VERSION=$(node --version 2>/dev/null | sed 's/^v//')
NODE_MAJOR="${NODE_VERSION%%.*}"
if [ "${NODE_MAJOR:-0}" -lt 18 ]; then
  echo "koad-io identity verify: Node.js >= 18 required (found v${NODE_VERSION})" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Delegate to Node bridge
# ---------------------------------------------------------------------------

export KOAD_IO_VERIFY_ENTITY="$RESOLVED_ENTITY"
export KOAD_IO_VERIFY_PASSPHRASE="$PASSPHRASE_ARG"
export KOAD_IO_VERIFY_VERBOSE="$( [ "$VERBOSE_FLAG" = "true" ] && echo "1" || echo "0" )"
export KOAD_IO_VERIFY_JSON="$( [ "$JSON_FLAG" = "true" ] && echo "1" || echo "0" )"

exec node "$BRIDGE_SCRIPT"

# ---------------------------------------------------------------------------
# Self-documenting footer
# ---------------------------------------------------------------------------
# shellcheck disable=SC2317
_KOAD_IO_COMMAND_HELP() {
  echo "identity verify — verify entity sigchain integrity (VESTA-SPEC-111 + SPEC-150)"
  echo ""
  echo "Flags:"
  echo "  --entity=<name>      Entity handle (default: \$ENTITY or current dir name)"
  echo "  --passphrase=<phrase> Leaf key passphrase (Path A; default: reads device.key)"
  echo "  --verbose            Print per-entry verification details"
  echo "  --json               Output results as JSON"
}
source "$HOME/.koad-io/helpers/discovery.sh" 2>/dev/null && _koad_io_hint
