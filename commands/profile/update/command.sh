#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# profile update — create a new koad.state-update sigchain entry with changed profile fields
#
# Reads the current tip CID from $ENTITY_DIR/var/sigchain-tip.
# Builds a new koad.state-update entry (scope:profile) referencing the current tip.
# Signs the entry with the entity's Ed25519 key.
# Updates $ENTITY_DIR/var/sigchain-tip with the new CID.
#
# Per VESTA-SPEC-111 §5.2: koad.state-update is full replacement within scope.
# All profile fields are included in the new entry.
#
# Key lookup order:
#   $ENTITY_DIR/id/ed25519.key  (PEM PKCS8 — preferred)
#   $ENTITY_DIR/id/ed25519      (OpenSSH format — fallback)
#
# Usage:
#   $ENTITY profile update [--name NAME] [--bio BIO] [--avatar CID] [--non-interactive]

set -euo pipefail

ENTITY="${ENTITY:-koad}"
ENTITY_DIR="${ENTITY_DIR:-$HOME/.$ENTITY}"
SIGCHAIN_TIP_FILE="$ENTITY_DIR/var/sigchain-tip"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
SIGN_HELPER="$(dirname "$(dirname "${BASH_SOURCE[0]}")")/.helpers/sign.js"

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
  --output DIR          Write signed entry JSON to this directory
  --non-interactive     Skip prompts; apply only flags provided
  -h, --help            Show this help

Current tip is read from: $SIGCHAIN_TIP_FILE
New tip is written to:    $SIGCHAIN_TIP_FILE

Per VESTA-SPEC-111 §5.2: koad.state-update is full state replacement within
scope "profile". All fields must be specified (empty fields default to blank).

Note: IPFS fetch for current profile values is not yet wired — interactive
mode shows placeholder defaults for current values.

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
OUTPUT_DIR=""
NON_INTERACTIVE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --name)           NAME="$2"; shift 2 ;;
    --bio)            BIO="$2";  shift 2 ;;
    --avatar)         AVATAR="$2"; shift 2 ;;
    --output)         OUTPUT_DIR="$2"; shift 2 ;;
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

# Locate private key
KEY_PRIVATE=""
if [[ -f "$ENTITY_DIR/id/ed25519.key" ]]; then
  KEY_PRIVATE="$ENTITY_DIR/id/ed25519.key"
elif [[ -f "$ENTITY_DIR/id/ed25519" ]]; then
  KEY_PRIVATE="$ENTITY_DIR/id/ed25519"
fi

if [[ -z "$KEY_PRIVATE" ]]; then
  echo "profile update: Ed25519 private key not found." >&2
  echo "  Checked: $ENTITY_DIR/id/ed25519.key (PEM PKCS8)" >&2
  echo "           $ENTITY_DIR/id/ed25519 (OpenSSH)" >&2
  exit 1
fi

if ! command -v node &>/dev/null; then
  echo "profile update: node not found. Required for Ed25519 signing." >&2
  exit 1
fi

if [[ ! -f "$SIGN_HELPER" ]]; then
  echo "profile update: sign helper not found: $SIGN_HELPER" >&2
  exit 1
fi

CURRENT_TIP=$(cat "$SIGCHAIN_TIP_FILE")
echo "Current tip: $CURRENT_TIP" >&2

# ── Interactive prompts ───────────────────────────────────────────────────────
# Note: fetching current values from IPFS is not yet wired.
# Users must supply all values they want to keep.

if [[ "$NON_INTERACTIVE" == false ]]; then
  echo "(Note: current profile values cannot be fetched until IPFS is wired.)" >&2
  echo "(Leave fields blank to set them empty in the new entry.)" >&2
  if [[ -z "$NAME" ]]; then
    read -r -p "Display name: " NAME
  fi
  if [[ -z "$BIO" ]]; then
    read -r -p "Bio: " BIO
  fi
  if [[ -z "$AVATAR" ]]; then
    read -r -p "Avatar CID: " AVATAR
  fi
fi

# ── Prepare output directory ──────────────────────────────────────────────────

# Always write to sigchain cache (enables no-args `profile verify`)
SIGCHAIN_CACHE_DIR="$ENTITY_DIR/var/sigchain-cache"
mkdir -p "$SIGCHAIN_CACHE_DIR"
if [[ -n "$OUTPUT_DIR" ]]; then
  mkdir -p "$OUTPUT_DIR"
fi

# ── Build and sign state-update entry ────────────────────────────────────────

echo "Building koad.state-update entry..." >&2

UPDATE_ENTRY=$(node -e "
const ts = process.argv[1];
const entity = process.argv[2];
const prevCid = process.argv[3];
const name = process.argv[4];
const bio = process.argv[5];
const avatar = process.argv[6] || null;
const e = {
  entity,
  payload: {
    data: {
      avatar,
      bio,
      name,
      socialProofs: []
    },
    scope: 'profile'
  },
  previous: prevCid,
  timestamp: ts,
  type: 'koad.state-update',
  version: 1
};
process.stdout.write(JSON.stringify(e));
" "$TIMESTAMP" "$ENTITY" "$CURRENT_TIP" "$NAME" "$BIO" "$AVATAR")

UPDATE_RESULT=$(printf '%s' "{\"op\":\"sign\",\"entry\":${UPDATE_ENTRY},\"keyPath\":\"${KEY_PRIVATE}\"}" \
  | node "$SIGN_HELPER" 2>&1)

if ! echo "$UPDATE_RESULT" | grep -q '"ok":true'; then
  echo "profile update: failed to sign update entry" >&2
  echo "$UPDATE_RESULT" >&2
  exit 1
fi

UPDATE_SIGNED=$(echo "$UPDATE_RESULT" | node -e \
  "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.stringify(JSON.parse(d).signedEntry)))")
NEW_TIP=$(echo "$UPDATE_RESULT" | node -e \
  "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).cid))")

# Always write to sigchain cache; use timestamp to avoid collisions with multiple updates
UPDATE_TS_SLUG=$(echo "$TIMESTAMP" | tr -d ':-' | tr 'T' '-' | tr -d 'Z')
echo "$UPDATE_SIGNED" > "$SIGCHAIN_CACHE_DIR/profile-update-${UPDATE_TS_SLUG}.json"
if [[ -n "$OUTPUT_DIR" ]]; then
  echo "$UPDATE_SIGNED" > "$OUTPUT_DIR/profile-update.json"
  echo "Wrote: $OUTPUT_DIR/profile-update.json" >&2
fi

# ── Update tip ────────────────────────────────────────────────────────────────

echo "$NEW_TIP" > "$SIGCHAIN_TIP_FILE"

echo ""
echo "Profile updated:"
echo "  Entity:      $ENTITY"
echo "  Name:        $NAME"
echo "  Previous:    $CURRENT_TIP"
echo "  New tip:     $NEW_TIP"
echo "  Tip file:    $SIGCHAIN_TIP_FILE"
echo ""
echo "Note: IPFS not wired. CID computed locally."
echo "Next: $ENTITY profile publish  — announce new tip to canonical location"
