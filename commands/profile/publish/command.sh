#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# profile publish — push the current sigchain tip CID to the canonical location
#
# Reads the tip CID from $ENTITY_DIR/var/sigchain-tip.
# Constructs a canonical location pointer (SPEC-111 §7.2), signs it, and
# announces the tip CID to the configured canonical location(s).
#
# Canonical location pointer format (SPEC-111 §7.2):
#   { version, entity, tip, published, signature }
#
# Supported canonical locations (configured in $ENTITY_DIR/.env or via flags):
#   - kingofalldata.com/ipfs/  (HTTP PUT to daemon API — default for kingdom entities)
#   - IPNS update              (ipfs name publish <tip>)
#   - DNS TXT record           (requires dns provider CLI, e.g. cloudflare)
#   - stdout                   (--dry-run, for inspection)
#
# Usage:
#   $ENTITY profile publish [--location LOCATION] [--dry-run]
#
# Requires:
#   - $ENTITY_DIR/var/sigchain-tip
#   - Ed25519 key at $ENTITY_DIR/id/ed25519
#   - ipfs CLI for IPNS (optional)

set -euo pipefail

ENTITY="${ENTITY:-koad}"
ENTITY_DIR="${ENTITY_DIR:-$HOME/.$ENTITY}"
KEY_PRIVATE="$ENTITY_DIR/id/ed25519"
SIGCHAIN_TIP_FILE="$ENTITY_DIR/var/sigchain-tip"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Canonical location from env or default
CANONICAL_LOCATION="${ENTITY_SIGCHAIN_CANONICAL_LOCATION:-stdout}"

# ── Usage ─────────────────────────────────────────────────────────────────────

usage() {
  cat >&2 <<EOF
profile publish — announce sigchain tip CID to canonical location

Usage:
  $ENTITY profile publish [options]

Options:
  --location LOCATION   Canonical location type: stdout | ipns | kingofalldata
                        Default: $CANONICAL_LOCATION (from ENTITY_SIGCHAIN_CANONICAL_LOCATION)
  --dry-run             Print the signed pointer without publishing
  -h, --help            Show this help

Reads tip from:  $SIGCHAIN_TIP_FILE
Signs with:      $KEY_PRIVATE

Canonical location pointer (SPEC-111 §7.2) is signed and delivered to the
configured location. Multiple locations can be configured by running publish
with --location for each.

See also:
  $ENTITY profile create   — initialize profile sigchain
  $ENTITY profile update   — add a new profile entry
  $ENTITY profile view     — display current profile
EOF
}

# ── Arg parsing ───────────────────────────────────────────────────────────────

DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --location) CANONICAL_LOCATION="$2"; shift 2 ;;
    --dry-run)  DRY_RUN=true; shift ;;
    -h|--help|help) usage; exit 0 ;;
    *) echo "profile publish: unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

# ── Pre-flight checks ─────────────────────────────────────────────────────────

if [[ ! -f "$SIGCHAIN_TIP_FILE" ]]; then
  echo "profile publish: no sigchain tip found at $SIGCHAIN_TIP_FILE" >&2
  echo "Run '$ENTITY profile create' first." >&2
  exit 1
fi

if [[ ! -f "$KEY_PRIVATE" ]]; then
  echo "profile publish: Ed25519 private key not found: $KEY_PRIVATE" >&2
  exit 1
fi

TIP_CID=$(cat "$SIGCHAIN_TIP_FILE")
echo "Tip CID: $TIP_CID"

# ── Build canonical location pointer ─────────────────────────────────────────

# SPEC-111 §7.2: pointer is signed by Ed25519 key, signature absent from pre-image.
# Pre-image field order (sorted): entity, published, tip, version

POINTER_PRE_IMAGE=$(cat <<JSON
{"entity":"$ENTITY","published":"$TIMESTAMP","tip":"$TIP_CID","version":1}
JSON
)

# TODO: replace stub with actual signing:
#   POINTER_SIG=$(printf '%s' "$POINTER_PRE_IMAGE" \
#     | openssl pkeyutl -sign -rawin -inkey $KEY_PRIVATE \
#     | base64 -w0 | tr '+/' '-_' | tr -d '=')

POINTER_SIG="TODO_POINTER_SIGNATURE"
echo "profile publish: WARNING — pointer signing not implemented (TODO)" >&2

SIGNED_POINTER=$(cat <<JSON
{
  "entity": "$ENTITY",
  "published": "$TIMESTAMP",
  "signature": "$POINTER_SIG",
  "tip": "$TIP_CID",
  "version": 1
}
JSON
)

# ── Publish ───────────────────────────────────────────────────────────────────

if [[ "$DRY_RUN" == true ]]; then
  echo ""
  echo "--- canonical location pointer (dry run) ---"
  echo "$SIGNED_POINTER"
  echo "--- end ---"
  exit 0
fi

case "$CANONICAL_LOCATION" in
  stdout)
    echo ""
    echo "--- canonical location pointer ---"
    echo "$SIGNED_POINTER"
    echo "--- end ---"
    echo ""
    echo "profile publish: pointer printed to stdout. Configure ENTITY_SIGCHAIN_CANONICAL_LOCATION for automated delivery."
    ;;

  ipns)
    # TODO: update IPNS name to point to tip CID
    # ipfs name publish --key="$ENTITY" "$TIP_CID"
    echo "profile publish: IPNS publish not yet implemented" >&2
    echo "TODO: ipfs name publish --key=\"$ENTITY\" \"$TIP_CID\"" >&2
    exit 1
    ;;

  kingofalldata)
    # TODO: PUT signed pointer to kingofalldata.com daemon API
    # curl -X PUT "https://kingofalldata.com/api/sigchain/$ENTITY/tip" \
    #   -H "Content-Type: application/json" \
    #   -H "Authorization: Bearer $KOAD_IO_DAEMON_TOKEN" \
    #   -d "$SIGNED_POINTER"
    echo "profile publish: kingofalldata.com publish not yet implemented" >&2
    echo "TODO: PUT signed pointer to daemon API" >&2
    exit 1
    ;;

  *)
    echo "profile publish: unknown canonical location: $CANONICAL_LOCATION" >&2
    echo "Supported: stdout | ipns | kingofalldata" >&2
    exit 1
    ;;
esac

echo "profile publish: done. Tip $TIP_CID announced to $CANONICAL_LOCATION"
