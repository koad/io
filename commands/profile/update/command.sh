#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# profile update — create a new koad.state-update sigchain entry with changed profile fields
#
# Reads the current tip CID from $ENTITY_DIR/var/sigchain-tip.
# Fetches and decodes the current profile from IPFS (to show current values).
# Builds a new koad.state-update[scope:profile] entry referencing the current tip.
# Signs the entry with $ENTITY_DIR/id/ed25519.
# Publishes to IPFS via ipfs dag put.
# Updates $ENTITY_DIR/var/sigchain-tip with the new CID.
#
# Usage:
#   $ENTITY profile update [--name NAME] [--bio BIO] [--avatar CID] [--non-interactive]
#
# Requires:
#   - $ENTITY_DIR/var/sigchain-tip (run 'profile create' first)
#   - Ed25519 key at $ENTITY_DIR/id/ed25519
#   - ipfs CLI + running daemon

set -euo pipefail

ENTITY="${ENTITY:-koad}"
ENTITY_DIR="${ENTITY_DIR:-$HOME/.$ENTITY}"
KEY_PRIVATE="$ENTITY_DIR/id/ed25519"
SIGCHAIN_TIP_FILE="$ENTITY_DIR/var/sigchain-tip"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# ── Usage ─────────────────────────────────────────────────────────────────────

usage() {
  cat >&2 <<EOF
profile update — publish updated profile state to sigchain

Usage:
  $ENTITY profile update [options]

Options:
  --name NAME           New display name
  --bio BIO             New bio
  --avatar CID          New avatar IPFS CID
  --non-interactive     Skip prompts; apply only flags provided
  -h, --help            Show this help

Current tip is read from: $SIGCHAIN_TIP_FILE
New tip is written to:    $SIGCHAIN_TIP_FILE

Requires:
  - Existing sigchain (run '$ENTITY profile create' first)
  - Ed25519 key at $ENTITY_DIR/id/ed25519
  - ipfs CLI + running daemon

See also:
  $ENTITY profile create   — create genesis + initial profile
  $ENTITY profile publish  — announce tip CID to canonical location
  $ENTITY profile view     — display current profile
EOF
}

# ── Arg parsing ───────────────────────────────────────────────────────────────

NAME=""
BIO=""
AVATAR=""
NON_INTERACTIVE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --name)           NAME="$2"; shift 2 ;;
    --bio)            BIO="$2";  shift 2 ;;
    --avatar)         AVATAR="$2"; shift 2 ;;
    --non-interactive) NON_INTERACTIVE=true; shift ;;
    -h|--help|help)   usage; exit 0 ;;
    *) echo "profile update: unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

# ── Pre-flight checks ─────────────────────────────────────────────────────────

if [[ ! -f "$SIGCHAIN_TIP_FILE" ]]; then
  echo "profile update: no sigchain tip found at $SIGCHAIN_TIP_FILE" >&2
  echo "Run '$ENTITY profile create' first to initialize your profile sigchain." >&2
  exit 1
fi

if [[ ! -f "$KEY_PRIVATE" ]]; then
  echo "profile update: Ed25519 private key not found: $KEY_PRIVATE" >&2
  exit 1
fi

CURRENT_TIP=$(cat "$SIGCHAIN_TIP_FILE")
echo "Current tip: $CURRENT_TIP"

# ── Fetch current profile state ───────────────────────────────────────────────

# TODO: fetch and decode current profile from IPFS to pre-populate prompt defaults.
# Pattern:
#   CURRENT_ENTRY=$(ipfs dag get "$CURRENT_TIP")
#   CURRENT_NAME=$(echo "$CURRENT_ENTRY" | node -e "
#     let d=''; process.stdin.on('data',c=>d+=c).on('end',()=>{
#       const e=JSON.parse(d);
#       console.log(e.payload?.data?.name||'');
#     });
#   ")

CURRENT_NAME="(TODO: fetch from IPFS — $CURRENT_TIP)"
CURRENT_BIO="(TODO: fetch from IPFS)"
CURRENT_AVATAR="(TODO: fetch from IPFS)"

# ── Interactive prompts ───────────────────────────────────────────────────────

if [[ "$NON_INTERACTIVE" == false ]]; then
  if [[ -z "$NAME" ]]; then
    read -r -p "Display name [$CURRENT_NAME]: " NAME
    NAME="${NAME:-$CURRENT_NAME}"
  fi
  if [[ -z "$BIO" ]]; then
    read -r -p "Bio [$CURRENT_BIO]: " BIO
    BIO="${BIO:-$CURRENT_BIO}"
  fi
  if [[ -z "$AVATAR" ]]; then
    read -r -p "Avatar CID [$CURRENT_AVATAR]: " AVATAR
    AVATAR="${AVATAR:-$CURRENT_AVATAR}"
  fi
fi

# ── Build and sign state-update entry ────────────────────────────────────────

echo "Building koad.state-update entry..."

# TODO: replace with node script implementing SPEC-111 §3.2–3.3:
#   1. Sort payload keys lexicographically
#   2. Serialize pre-image as canonical dag-json (no signature field)
#   3. Sign with: printf '%s' "$PRE_IMAGE" | openssl pkeyutl -sign -rawin -inkey $KEY_PRIVATE | base64url
#   4. Add signature field
#   5. ipfs dag put → new CID

UPDATE_ENTRY=$(cat <<ENTRY
{
  "entity": "$ENTITY",
  "payload": {
    "data": {
      "avatar": ${AVATAR:+"\"$AVATAR\""}${AVATAR:-null},
      "bio": "$BIO",
      "name": "$NAME",
      "socialProofs": []
    },
    "scope": "profile"
  },
  "previous": "$CURRENT_TIP",
  "signature": "TODO_SIGNATURE",
  "timestamp": "$TIMESTAMP",
  "type": "koad.state-update",
  "version": 1
}
ENTRY
)

# TODO: wire to ipfs dag put
# NEW_TIP=$(echo "$UPDATE_ENTRY" | ipfs dag put --input-codec dag-json --store-codec dag-json)
NEW_TIP="TODO_NEW_TIP_CID"
echo "profile update: new tip CID: $NEW_TIP (TODO: wire to ipfs dag put)" >&2

# ── Update tip ────────────────────────────────────────────────────────────────

echo "$NEW_TIP" > "$SIGCHAIN_TIP_FILE"
echo "profile update: tip updated: $SIGCHAIN_TIP_FILE"

echo ""
echo "Profile update queued (scaffold — crypto not yet implemented):"
echo "  Entity:      $ENTITY"
echo "  Name:        $NAME"
echo "  Previous:    $CURRENT_TIP"
echo "  New tip:     $NEW_TIP"
echo ""
echo "Next: $ENTITY profile publish  — announce new tip to canonical location"
