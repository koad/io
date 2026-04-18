#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# profile create — generate a genesis sigchain entry and initial profile state
#
# Creates two entries per VESTA-SPEC-111:
#   1. koad.genesis  — anchors the chain, embeds the entity's Ed25519 public key
#   2. koad.state-update (scope:profile) — initial profile state (name, bio, etc.)
#
# Both entries are signed with the entity's Ed25519 key.
# Tip CID is written to $ENTITY_DIR/var/sigchain-tip.
# If --output is specified, signed entries are also written to that directory.
#
# Key lookup order:
#   $ENTITY_DIR/id/ed25519.key  (PEM PKCS8 — preferred, per SPEC-111 §11.4)
#   $ENTITY_DIR/id/ed25519      (OpenSSH format — fallback)
#
# IPFS dag put is stubbed — CIDs are computed locally without an IPFS daemon.
# CID format: CIDv1 base32lower, codec dag-json (0x0129), hash sha2-256.
#
# Usage:
#   $ENTITY profile create [--name NAME] [--bio BIO] [--non-interactive] [--output DIR]
#   koad profile create --name "Alice" --bio "A koad:io entity"

set -euo pipefail

ENTITY="${ENTITY:-koad}"
ENTITY_DIR="${ENTITY_DIR:-$HOME/.$ENTITY}"
SIGCHAIN_TIP_FILE="$ENTITY_DIR/var/sigchain-tip"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
SIGN_HELPER="$(dirname "$(dirname "${BASH_SOURCE[0]}")")/.helpers/sign.js"

# ── Usage ─────────────────────────────────────────────────────────────────────

usage() {
  cat >&2 <<EOF
profile create — generate genesis sigchain entry + initial profile state

Usage:
  $ENTITY profile create [options]

Options:
  --name NAME           Display name (required in non-interactive mode)
  --bio BIO             Short bio (optional)
  --avatar CID          IPFS CID of your avatar image (optional)
  --output DIR          Write signed entry JSON files to this directory
  --non-interactive     Skip prompts; fail if required fields are missing
  -h, --help            Show this help

Creates (per VESTA-SPEC-111):
  1. koad.genesis entry — anchors chain identity, embeds Ed25519 public key
  2. koad.state-update[scope:profile] entry — initial profile data

Key lookup: $ENTITY_DIR/id/ed25519.key (PEM) or $ENTITY_DIR/id/ed25519 (OpenSSH)
Tip CID written to: $SIGCHAIN_TIP_FILE

Note: IPFS dag put is stubbed. CIDs are computed locally. To push to IPFS,
run: ipfs dag put --input-codec dag-json --store-codec dag-json < entry.json

See also:
  $ENTITY profile update   — update existing profile
  $ENTITY profile publish  — push tip CID to canonical location
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
    *) echo "profile create: unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

# ── Pre-flight checks ─────────────────────────────────────────────────────────

# Locate private key (PEM PKCS8 preferred, OpenSSH fallback)
KEY_PRIVATE=""
if [[ -f "$ENTITY_DIR/id/ed25519.key" ]]; then
  KEY_PRIVATE="$ENTITY_DIR/id/ed25519.key"
elif [[ -f "$ENTITY_DIR/id/ed25519" ]]; then
  KEY_PRIVATE="$ENTITY_DIR/id/ed25519"
fi

if [[ -z "$KEY_PRIVATE" ]]; then
  echo "profile create: Ed25519 private key not found." >&2
  echo "  Checked: $ENTITY_DIR/id/ed25519.key (PEM PKCS8)" >&2
  echo "           $ENTITY_DIR/id/ed25519 (OpenSSH)" >&2
  echo "  Generate with: ssh-keygen -t ed25519 -f $ENTITY_DIR/id/ed25519 -C '$ENTITY@wonderland' -N ''" >&2
  exit 1
fi

if [[ -f "$SIGCHAIN_TIP_FILE" ]]; then
  echo "profile create: sigchain tip already exists: $SIGCHAIN_TIP_FILE" >&2
  echo "This entity already has a sigchain. Use '$ENTITY profile update' to update." >&2
  exit 1
fi

if ! command -v node &>/dev/null; then
  echo "profile create: node not found. Required for Ed25519 signing." >&2
  exit 1
fi

if [[ ! -f "$SIGN_HELPER" ]]; then
  echo "profile create: sign helper not found: $SIGN_HELPER" >&2
  exit 1
fi

# ── Interactive prompts ───────────────────────────────────────────────────────

if [[ "$NON_INTERACTIVE" == false ]]; then
  if [[ -z "$NAME" ]]; then
    read -r -p "Display name [${ENTITY}]: " NAME
    NAME="${NAME:-$ENTITY}"
  fi
  if [[ -z "$BIO" ]]; then
    read -r -p "Short bio (optional): " BIO
  fi
  if [[ -z "$AVATAR" ]]; then
    read -r -p "Avatar IPFS CID (optional): " AVATAR
  fi
else
  if [[ -z "$NAME" ]]; then
    echo "profile create: --name is required in --non-interactive mode" >&2
    exit 1
  fi
fi

# ── Prepare output directory ──────────────────────────────────────────────────

mkdir -p "$ENTITY_DIR/var"
# Always write to sigchain-cache (enables no-args `profile verify`)
SIGCHAIN_CACHE_DIR="$ENTITY_DIR/var/sigchain-cache"
mkdir -p "$SIGCHAIN_CACHE_DIR"
if [[ -n "$OUTPUT_DIR" ]]; then
  mkdir -p "$OUTPUT_DIR"
fi

# ── Get public key (base64url) ────────────────────────────────────────────────

echo "Reading Ed25519 key from $KEY_PRIVATE..." >&2

PUBKEY_RESULT=$(printf '%s' "{\"op\":\"pubkey\",\"keyPath\":\"${KEY_PRIVATE}\"}" \
  | node "$SIGN_HELPER" 2>&1)

if ! echo "$PUBKEY_RESULT" | grep -q '"ok":true'; then
  echo "profile create: failed to read public key" >&2
  echo "$PUBKEY_RESULT" >&2
  exit 1
fi

PUBKEY_B64URL=$(echo "$PUBKEY_RESULT" | node -e \
  "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).pubkeyBase64Url))")

# ── Step 1: sign genesis entry ────────────────────────────────────────────────

echo "Creating genesis entry for $ENTITY..." >&2

# Build the genesis entry object via node (handles JSON escaping cleanly)
GENESIS_ENTRY=$(node -e "
const ts = process.argv[1];
const entity = process.argv[2];
const pubkey = process.argv[3];
const e = {
  entity,
  payload: {
    created: ts,
    description: entity + ' sovereign profile chain \u2014 genesis',
    entity,
    pubkey,
  },
  previous: null,
  timestamp: ts,
  type: 'koad.genesis',
  version: 1
};
process.stdout.write(JSON.stringify(e));
" "$TIMESTAMP" "$ENTITY" "$PUBKEY_B64URL")

GENESIS_RESULT=$(printf '%s' "{\"op\":\"sign\",\"entry\":${GENESIS_ENTRY},\"keyPath\":\"${KEY_PRIVATE}\"}" \
  | node "$SIGN_HELPER" 2>&1)

if ! echo "$GENESIS_RESULT" | grep -q '"ok":true'; then
  echo "profile create: failed to sign genesis entry" >&2
  echo "$GENESIS_RESULT" >&2
  exit 1
fi

GENESIS_SIGNED=$(echo "$GENESIS_RESULT" | node -e \
  "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.stringify(JSON.parse(d).signedEntry)))")
GENESIS_CID=$(echo "$GENESIS_RESULT" | node -e \
  "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).cid))")

echo "Genesis CID: $GENESIS_CID" >&2

# Always write to sigchain cache
echo "$GENESIS_SIGNED" > "$SIGCHAIN_CACHE_DIR/genesis.json"
if [[ -n "$OUTPUT_DIR" ]]; then
  echo "$GENESIS_SIGNED" > "$OUTPUT_DIR/genesis.json"
  echo "Wrote: $OUTPUT_DIR/genesis.json" >&2
fi

# ── Step 2: sign initial profile state-update entry ──────────────────────────

echo "Creating initial profile state entry..." >&2

# Build profile entry via node (handles JSON escaping of name/bio)
PROFILE_ENTRY=$(node -e "
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
" "$TIMESTAMP" "$ENTITY" "$GENESIS_CID" "$NAME" "$BIO" "$AVATAR")

PROFILE_RESULT=$(printf '%s' "{\"op\":\"sign\",\"entry\":${PROFILE_ENTRY},\"keyPath\":\"${KEY_PRIVATE}\"}" \
  | node "$SIGN_HELPER" 2>&1)

if ! echo "$PROFILE_RESULT" | grep -q '"ok":true'; then
  echo "profile create: failed to sign profile entry" >&2
  echo "$PROFILE_RESULT" >&2
  exit 1
fi

PROFILE_SIGNED=$(echo "$PROFILE_RESULT" | node -e \
  "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.stringify(JSON.parse(d).signedEntry)))")
PROFILE_CID=$(echo "$PROFILE_RESULT" | node -e \
  "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).cid))")

echo "Profile CID: $PROFILE_CID" >&2

# Always write to sigchain cache
echo "$PROFILE_SIGNED" > "$SIGCHAIN_CACHE_DIR/profile-state.json"
if [[ -n "$OUTPUT_DIR" ]]; then
  echo "$PROFILE_SIGNED" > "$OUTPUT_DIR/profile-state.json"
  echo "Wrote: $OUTPUT_DIR/profile-state.json" >&2
fi

# ── Write tip CID ─────────────────────────────────────────────────────────────

echo "$PROFILE_CID" > "$SIGCHAIN_TIP_FILE"

echo ""
echo "Profile created:"
echo "  Entity:       $ENTITY"
echo "  Name:         $NAME"
echo "  Key:          $KEY_PRIVATE"
echo "  Genesis CID:  $GENESIS_CID"
echo "  Profile CID:  $PROFILE_CID (tip)"
echo "  Tip file:     $SIGCHAIN_TIP_FILE"
echo ""
echo "Note: IPFS not wired. CIDs are computed locally (dag-json, sha2-256)."
echo "To push entries to IPFS when daemon is running:"
echo "  ipfs dag put --input-codec dag-json --store-codec dag-json < genesis.json"
echo ""
echo "Next: $ENTITY profile publish  — announce tip CID to canonical location"
