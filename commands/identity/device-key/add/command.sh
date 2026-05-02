#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# koad-io identity device-key add — add a new device key leaf to an existing identity
#
# Implements VESTA-SPEC-149 §5.2 (Device Leaves) + §6.
# Generates a new device keypair, signs a koad.identity.leaf-authorize entry,
# appends to the entity's sigchain, and writes the new device key files.
#
# Authorization must be provided by EITHER:
#   --mnemonic=<phrase|path>   Master key signs the new leaf (spec-preferred)
#   --leaf-key=<path>          An existing authorized leaf key signs (alternate)
#
# The command does NOT submit to IPFS or Vesta — run 'koad-io identity submit'
# separately after adding a device key.
#
# Usage:
#   koad-io identity device-key add --entity <name> --device-name <device>
#   koad-io identity device-key add --entity koad --device-name wonderland-laptop --mnemonic=<phrase>
#   koad-io identity device-key add --entity koad --device-name fourty4 --leaf-key ~/.koad/id/leaf.private.asc
#
# Flags:
#   --entity=<name>          Entity handle. Defaults to $ENTITY env or current dir name.
#   --device-name=<name>     Required. e.g. "wonderland-laptop", "fourty4-mac-mini"
#   --mnemonic=<phrase|path> BIP39 mnemonic — master signs the leaf-authorize entry.
#                            Accepts inline phrase OR file path containing the mnemonic.
#   --bip39-passphrase=<p>   BIP39 passphrase for mnemonic derivation (optional; default: empty).
#   --leaf-key=<path>        Path to an existing authorized leaf private key file.
#                            Alternative to --mnemonic — authorized leaf signs the new leaf.
#   --leaf-passphrase=<p>    Passphrase for the existing leaf key (Path A). Reads device.key by default.
#   --dry-run                Generate but do not write key files or update identity.json.
#   --no-confirm             Skip interactive confirmation prompt.

set -euo pipefail

DEVICE_KEY_ADD_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRIDGE_SCRIPT="$DEVICE_KEY_ADD_DIR/device-key-add-bridge.mjs"

# ---------------------------------------------------------------------------
# Flag parsing
# ---------------------------------------------------------------------------

ENTITY_ARG=""
DEVICE_NAME_ARG=""
MNEMONIC_ARG=""
BIP39_PASSPHRASE_ARG=""
LEAF_KEY_ARG=""
LEAF_PASSPHRASE_ARG=""
DRY_RUN_FLAG="false"
NO_CONFIRM_FLAG="false"

for arg in "$@"; do
  case "$arg" in
    --entity=*)            ENTITY_ARG="${arg#--entity=}"              ;;
    --device-name=*)       DEVICE_NAME_ARG="${arg#--device-name=}"    ;;
    --mnemonic=*)          MNEMONIC_ARG="${arg#--mnemonic=}"           ;;
    --bip39-passphrase=*)  BIP39_PASSPHRASE_ARG="${arg#--bip39-passphrase=}" ;;
    --leaf-key=*)          LEAF_KEY_ARG="${arg#--leaf-key=}"           ;;
    --leaf-passphrase=*)   LEAF_PASSPHRASE_ARG="${arg#--leaf-passphrase=}" ;;
    --dry-run)             DRY_RUN_FLAG="true"                         ;;
    --no-confirm)          NO_CONFIRM_FLAG="true"                      ;;
    --help|-h)
      grep '^#' "$0" | head -40 | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "koad-io identity device-key add: unknown flag: $arg" >&2
      echo "Run 'koad-io identity device-key add --help' for usage." >&2
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
  echo "koad-io identity device-key add: entity name is required (--entity=<name> or set \$ENTITY)" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Validate required flags
# ---------------------------------------------------------------------------

if [ -z "$DEVICE_NAME_ARG" ]; then
  echo "koad-io identity device-key add: --device-name=<name> is required" >&2
  echo "  Example: --device-name=wonderland-laptop" >&2
  exit 1
fi

if [ -z "$MNEMONIC_ARG" ] && [ -z "$LEAF_KEY_ARG" ]; then
  echo "koad-io identity device-key add: authorization required." >&2
  echo "  Provide --mnemonic=<phrase|path> (master signs) OR --leaf-key=<path> (leaf signs)" >&2
  exit 1
fi

if [ -n "$MNEMONIC_ARG" ] && [ -n "$LEAF_KEY_ARG" ]; then
  echo "koad-io identity device-key add: --mnemonic and --leaf-key are mutually exclusive." >&2
  echo "  Provide one authorization method only." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Verify identity exists
# ---------------------------------------------------------------------------

ID_DIR="$HOME/.$RESOLVED_ENTITY/id"
if [ ! -f "$ID_DIR/master.pub.asc" ]; then
  echo "koad-io identity device-key add: no identity found at $ID_DIR/master.pub.asc" >&2
  echo "  Run 'koad-io identity init --entity=$RESOLVED_ENTITY' first." >&2
  exit 1
fi
if [ ! -f "$ID_DIR/identity.json" ]; then
  echo "koad-io identity device-key add: identity.json not found at $ID_DIR/" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Resolve mnemonic: inline phrase or path to file
# ---------------------------------------------------------------------------

RESOLVED_MNEMONIC=""
if [ -n "$MNEMONIC_ARG" ]; then
  if [ -f "$MNEMONIC_ARG" ]; then
    RESOLVED_MNEMONIC="$(cat "$MNEMONIC_ARG")"
  else
    RESOLVED_MNEMONIC="$MNEMONIC_ARG"
  fi
fi

# ---------------------------------------------------------------------------
# Detect Node.js
# ---------------------------------------------------------------------------

if ! command -v node >/dev/null 2>&1; then
  echo "koad-io identity device-key add: Node.js is required but not found in PATH" >&2
  exit 1
fi

NODE_VERSION=$(node --version 2>/dev/null | sed 's/^v//')
NODE_MAJOR="${NODE_VERSION%%.*}"
if [ "${NODE_MAJOR:-0}" -lt 18 ]; then
  echo "koad-io identity device-key add: Node.js >= 18 required (found v${NODE_VERSION})" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Delegate to Node bridge
# ---------------------------------------------------------------------------

export KOAD_IO_DEVKEY_ENTITY="$RESOLVED_ENTITY"
export KOAD_IO_DEVKEY_DEVICE_NAME="$DEVICE_NAME_ARG"
export KOAD_IO_DEVKEY_MNEMONIC="$RESOLVED_MNEMONIC"
export KOAD_IO_DEVKEY_BIP39_PASSPHRASE="$BIP39_PASSPHRASE_ARG"
export KOAD_IO_DEVKEY_LEAF_KEY="$LEAF_KEY_ARG"
export KOAD_IO_DEVKEY_LEAF_PASSPHRASE="$LEAF_PASSPHRASE_ARG"
export KOAD_IO_DEVKEY_DRY_RUN="$( [ "$DRY_RUN_FLAG" = "true" ] && echo "1" || echo "0" )"
export KOAD_IO_DEVKEY_NO_CONFIRM="$( [ "$NO_CONFIRM_FLAG" = "true" ] && echo "1" || echo "0" )"

node "$BRIDGE_SCRIPT"
BRIDGE_EXIT=$?

exit $BRIDGE_EXIT

# ---------------------------------------------------------------------------
# Self-documenting footer
# ---------------------------------------------------------------------------
# shellcheck disable=SC2317
_KOAD_IO_COMMAND_HELP() {
  echo "identity device-key add — add a new device leaf to an existing identity (VESTA-SPEC-149)"
  echo ""
  echo "Flags:"
  echo "  --entity=<name>            Entity handle (default: \$ENTITY or current dir name)"
  echo "  --device-name=<name>       Required. Label for the new device key (e.g. wonderland-laptop)"
  echo "  --mnemonic=<phrase|path>   BIP39 mnemonic — master signs the new leaf (spec-preferred)"
  echo "  --bip39-passphrase=<p>     BIP39 passphrase (optional; default: empty)"
  echo "  --leaf-key=<path>          Existing authorized leaf key — alternative to --mnemonic"
  echo "  --leaf-passphrase=<p>      Passphrase for existing leaf key (default: reads device.key)"
  echo "  --dry-run                  Generate but do not write key files"
  echo "  --no-confirm               Skip confirmation prompt"
}
source "$HOME/.koad-io/helpers/discovery.sh" 2>/dev/null && _koad_io_hint
