#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# koad-io identity init — generate a fresh entity identity (VESTA-SPEC-149)
#
# Generates a BIP39 master key + device leaf key for an entity.
# Delegates key derivation to identity-init-bridge.mjs (@koad-io/node/ceremony).
#
# Usage:
#   koad-io identity init
#   koad-io identity init --entity <name>
#   koad-io identity init --entity <name> --mnemonic "word1 word2 ... word24"
#   koad-io identity init --entity <name> --leaf-count 3
#   koad-io identity init --entity <name> --dry-run
#   koad-io identity init --entity <name> --no-confirm
#
# Flags:
#   --entity=<name>           Entity handle. Defaults to $ENTITY env or current dir name.
#   --mnemonic=<phrase>       Import existing 24-word BIP39 mnemonic (recovery path).
#   --leaf-count=<n>          Pre-generate n device leaf keys (default: 1).
#   --passphrase              Prompt for leaf encryption passphrase (BIP39 Path A).
#                             Without this flag, a random device key is generated (Path B).
#   --dry-run                 Generate keys and print output; do not write to disk.
#   --no-confirm              Skip the mnemonic confirmation quiz (for automated use).
#
# Outputs:
#   ~/.<entity>/id/master.pub.asc     — Master public key (not sensitive)
#   ~/.<entity>/id/leaf.private.asc   — Device leaf private key (encrypted at rest)
#   ~/.<entity>/id/device.key         — Device key used for leaf encryption (Path B)
#   ~/.<entity>/id/identity.json      — Metadata summary (fingerprints, timestamps)

set -euo pipefail

INIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRIDGE_SCRIPT="$INIT_DIR/identity-init-bridge.mjs"

# ---------------------------------------------------------------------------
# Flag parsing
# ---------------------------------------------------------------------------

ENTITY_ARG=""
MNEMONIC_ARG=""
LEAF_COUNT_ARG="1"
PASSPHRASE_FLAG="false"
DRY_RUN_FLAG="false"
NO_CONFIRM_FLAG="false"

for arg in "$@"; do
  case "$arg" in
    --entity=*)       ENTITY_ARG="${arg#--entity=}"     ;;
    --mnemonic=*)     MNEMONIC_ARG="${arg#--mnemonic=}" ;;
    --leaf-count=*)   LEAF_COUNT_ARG="${arg#--leaf-count=}" ;;
    --passphrase)     PASSPHRASE_FLAG="true"            ;;
    --dry-run)        DRY_RUN_FLAG="true"               ;;
    --no-confirm)     NO_CONFIRM_FLAG="true"            ;;
    --help|-h)
      grep '^#' "$0" | head -30 | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "koad-io identity init: unknown flag: $arg" >&2
      echo "Run 'koad-io identity init --help' for usage." >&2
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
  # Fall back to current directory name, strip leading dot
  RESOLVED_ENTITY="$(basename "$PWD" | sed 's/^\.//')"
fi

if [ -z "$RESOLVED_ENTITY" ]; then
  echo "koad-io identity init: entity name is required (--entity=<name> or set \$ENTITY)" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Optional passphrase prompt (Path A — user-supplied passphrase)
# ---------------------------------------------------------------------------

PASSPHRASE_VALUE=""
if [ "$PASSPHRASE_FLAG" = "true" ]; then
  read -rs -p "Enter passphrase for leaf key encryption: " PASSPHRASE_VALUE </dev/tty
  echo "" >&2
  read -rs -p "Confirm passphrase: " PASSPHRASE_CONFIRM </dev/tty
  echo "" >&2
  if [ "$PASSPHRASE_VALUE" != "$PASSPHRASE_CONFIRM" ]; then
    echo "koad-io identity init: passphrases do not match" >&2
    exit 1
  fi
  if [ -z "$PASSPHRASE_VALUE" ]; then
    echo "koad-io identity init: passphrase must not be empty (SPEC-149 §8.1 prohibits no-encryption storage)" >&2
    exit 1
  fi
fi

# ---------------------------------------------------------------------------
# Detect Node.js
# ---------------------------------------------------------------------------

if ! command -v node >/dev/null 2>&1; then
  echo "koad-io identity init: Node.js is required but not found in PATH" >&2
  exit 1
fi

NODE_VERSION=$(node --version 2>/dev/null | sed 's/^v//')
NODE_MAJOR="${NODE_VERSION%%.*}"
if [ "${NODE_MAJOR:-0}" -lt 18 ]; then
  echo "koad-io identity init: Node.js >= 18 required (found v${NODE_VERSION})" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Check that @koad-io/node module exists
# ---------------------------------------------------------------------------

KOAD_IO_NODE_MODULE="$HOME/.koad-io/modules/node/ceremony.js"
if [ ! -f "$KOAD_IO_NODE_MODULE" ]; then
  echo "koad-io identity init: @koad-io/node module not found at $HOME/.koad-io/modules/node/" >&2
  echo "  Ensure the koad-io framework is installed and the node module is present." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Pre-flight: warn if id/ already exists with keys
# ---------------------------------------------------------------------------

ID_DIR="$HOME/.$RESOLVED_ENTITY/id"
if [ -f "$ID_DIR/master.pub.asc" ] && [ "$DRY_RUN_FLAG" = "false" ]; then
  echo "koad-io identity init: identity already exists at $ID_DIR/master.pub.asc" >&2
  echo "" >&2
  echo "  To re-initialize (creates a NEW identity, destroying the old one):" >&2
  echo "    rm -rf $ID_DIR && koad-io identity init --entity=$RESOLVED_ENTITY" >&2
  echo "" >&2
  echo "  To recover an existing identity from its mnemonic:" >&2
  echo "    koad-io identity init --entity=$RESOLVED_ENTITY --mnemonic=\"word1 word2 ...\"" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Delegate to Node bridge
# ---------------------------------------------------------------------------

export KOAD_IO_IDENTITY_ENTITY="$RESOLVED_ENTITY"
export KOAD_IO_IDENTITY_MNEMONIC="$MNEMONIC_ARG"
export KOAD_IO_IDENTITY_LEAF_COUNT="$LEAF_COUNT_ARG"
export KOAD_IO_IDENTITY_PASSPHRASE="$PASSPHRASE_VALUE"
export KOAD_IO_IDENTITY_DRY_RUN="$( [ "$DRY_RUN_FLAG" = "true" ] && echo "1" || echo "0" )"
export KOAD_IO_IDENTITY_NO_CONFIRM="$( [ "$NO_CONFIRM_FLAG" = "true" ] && echo "1" || echo "0" )"

exec node "$BRIDGE_SCRIPT"

# ---------------------------------------------------------------------------
# Self-documenting footer
# ---------------------------------------------------------------------------
# shellcheck disable=SC2317
_KOAD_IO_COMMAND_HELP() {
  echo "identity init — generate entity identity (VESTA-SPEC-149 BIP39 master+leaf)"
  echo ""
  echo "Flags:"
  echo "  --entity=<name>      Entity handle (default: \$ENTITY or current dir name)"
  echo "  --mnemonic=<phrase>  Import existing 24-word BIP39 mnemonic"
  echo "  --leaf-count=<n>     Pre-generate n leaf keys (default: 1)"
  echo "  --passphrase         Prompt for leaf encryption passphrase (Path A)"
  echo "  --dry-run            Generate but do not write to disk"
  echo "  --no-confirm         Skip mnemonic quiz (for automation)"
}
source "$HOME/.koad-io/helpers/discovery.sh" 2>/dev/null && _koad_io_hint
