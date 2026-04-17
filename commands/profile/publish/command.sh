#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# profile publish — sign and announce the sigchain tip CID to the canonical location
#
# Reads the tip CID from $ENTITY_DIR/var/sigchain-tip.
# Constructs a canonical location pointer per VESTA-SPEC-111 §7.2:
#   { version, entity, tip, published, signature }
# Signs the pointer with the entity's Ed25519 key.
# Delivers the signed pointer to the configured canonical location.
#
# Usage:
#   $ENTITY profile publish [--location LOCATION] [--dry-run]

set -euo pipefail

ENTITY="${ENTITY:-koad}"
ENTITY_DIR="${ENTITY_DIR:-$HOME/.$ENTITY}"
SIGCHAIN_TIP_FILE="$ENTITY_DIR/var/sigchain-tip"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
SIGN_HELPER="$(dirname "$(dirname "${BASH_SOURCE[0]}")")/.helpers/sign.js"

# Canonical location from env or default
CANONICAL_LOCATION="${ENTITY_SIGCHAIN_CANONICAL_LOCATION:-stdout}"

# ── Usage ─────────────────────────────────────────────────────────────────────

usage() {
  cat >&2 <<EOF
profile publish — sign and announce sigchain tip CID to canonical location

Usage:
  $ENTITY profile publish [options]

Options:
  --location LOCATION   Canonical location type: stdout | ipns | kingofalldata
                        Default: $CANONICAL_LOCATION (from ENTITY_SIGCHAIN_CANONICAL_LOCATION)
  --dry-run             Print the signed pointer without publishing
  -h, --help            Show this help

Reads tip from:  $SIGCHAIN_TIP_FILE
Signs with:      Ed25519 key in $ENTITY_DIR/id/

Canonical location pointer format (VESTA-SPEC-111 §7.2):
  { version, entity, tip, published, signature }

The pointer is signed with the entity's Ed25519 key (signature field absent
from pre-image, per §3.2). Pre-image field order: entity, published, tip, version.

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

# Locate private key
KEY_PRIVATE=""
if [[ -f "$ENTITY_DIR/id/ed25519.key" ]]; then
  KEY_PRIVATE="$ENTITY_DIR/id/ed25519.key"
elif [[ -f "$ENTITY_DIR/id/ed25519" ]]; then
  KEY_PRIVATE="$ENTITY_DIR/id/ed25519"
fi

if [[ -z "$KEY_PRIVATE" ]]; then
  echo "profile publish: Ed25519 private key not found." >&2
  echo "  Checked: $ENTITY_DIR/id/ed25519.key (PEM PKCS8)" >&2
  echo "           $ENTITY_DIR/id/ed25519 (OpenSSH)" >&2
  exit 1
fi

if ! command -v node &>/dev/null; then
  echo "profile publish: node not found." >&2
  exit 1
fi

if [[ ! -f "$SIGN_HELPER" ]]; then
  echo "profile publish: sign helper not found: $SIGN_HELPER" >&2
  exit 1
fi

TIP_CID=$(cat "$SIGCHAIN_TIP_FILE")
echo "Tip CID: $TIP_CID" >&2

# ── Build canonical location pointer ─────────────────────────────────────────
# SPEC-111 §7.2: pointer fields sorted: entity, published, tip, version
# signature absent from pre-image, then added.
# The pointer is NOT a sigchain entry (no `type`, `previous`, `payload`).
# We use the sign.js helper: pass a fake "entry" with the pointer fields,
# treating signature as the field to omit from pre-image.

POINTER=$(node -e "
const ts = process.argv[1];
const entity = process.argv[2];
const tip = process.argv[3];
// Build pointer object with fields in sorted order (entity, published, tip, version)
// This is what the pre-image will contain (signature excluded by sign.js)
const p = {
  entity,
  published: ts,
  tip,
  version: 1
};
process.stdout.write(JSON.stringify(p));
" "$TIMESTAMP" "$ENTITY" "$TIP_CID")

# Use sign.js to sign the pointer (it excludes the 'signature' field from pre-image)
SIGN_RESULT=$(printf '%s' "{\"op\":\"sign\",\"entry\":${POINTER},\"keyPath\":\"${KEY_PRIVATE}\"}" \
  | node "$SIGN_HELPER" 2>&1)

if ! echo "$SIGN_RESULT" | grep -q '"ok":true'; then
  echo "profile publish: failed to sign canonical location pointer" >&2
  echo "$SIGN_RESULT" >&2
  exit 1
fi

SIGNED_POINTER=$(echo "$SIGN_RESULT" | node -e \
  "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
    const r = JSON.parse(d);
    // The signedEntry has the signature field — extract just the pointer fields
    const e = r.signedEntry;
    const pointer = { entity: e.entity, published: e.published, signature: e.signature, tip: e.tip, version: e.version };
    console.log(JSON.stringify(pointer, null, 2));
  })")

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
    echo "--- canonical location pointer (VESTA-SPEC-111 §7.2) ---"
    echo "$SIGNED_POINTER"
    echo "--- end ---"
    echo ""
    echo "Pointer printed to stdout."
    echo "Set ENTITY_SIGCHAIN_CANONICAL_LOCATION to 'ipns' or 'kingofalldata' for automated delivery."
    ;;

  ipns)
    # IPFS IPNS publish: ipfs name publish --key="$ENTITY" "$TIP_CID"
    if ! command -v ipfs &>/dev/null; then
      echo "profile publish: ipfs CLI not found." >&2
      exit 1
    fi
    if ! ipfs swarm peers &>/dev/null 2>&1; then
      echo "profile publish: IPFS daemon not running." >&2
      exit 1
    fi
    echo "Publishing to IPNS (key: $ENTITY)..." >&2
    ipfs name publish --key="$ENTITY" "$TIP_CID"
    echo ""
    echo "profile publish: IPNS updated. Tip $TIP_CID announced."
    ;;

  kingofalldata)
    # PUT signed pointer to kingofalldata.com daemon API
    # Requires KOAD_IO_DAEMON_TOKEN in env
    if [[ -z "${KOAD_IO_DAEMON_TOKEN:-}" ]]; then
      echo "profile publish: KOAD_IO_DAEMON_TOKEN not set." >&2
      echo "Set it in your entity .env or export it before running." >&2
      exit 1
    fi
    echo "Publishing to kingofalldata.com..." >&2
    curl -fsS -X PUT \
      "https://kingofalldata.com/api/sigchain/${ENTITY}/tip" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer ${KOAD_IO_DAEMON_TOKEN}" \
      -d "$SIGNED_POINTER"
    echo ""
    echo "profile publish: tip $TIP_CID announced to kingofalldata.com."
    ;;

  *)
    echo "profile publish: unknown canonical location: $CANONICAL_LOCATION" >&2
    echo "Supported: stdout | ipns | kingofalldata" >&2
    exit 1
    ;;
esac

echo "profile publish: done."
