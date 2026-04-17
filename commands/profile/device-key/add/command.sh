#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# profile device-key add — generate a new Ed25519 device keypair and authorize it
#
# Implements VESTA-SPEC-111 v1.1 §5.4 and §5.4.1 (reverse_sig protocol).
#
# Steps:
#   1. Generate new Ed25519 keypair locally
#   2. Save device private key to $ENTITY_DIR/id/devices/<device_id>.key
#   3. Build koad.device-key-add entry (payload without reverse_sig)
#   4. Device key signs the pre-image (without reverse_sig) → reverse_sig
#   5. Root key (or authorized key) signs the full entry (with reverse_sig) → signature
#   6. Compute final CID, update sigchain tip
#
# Key storage:
#   $ENTITY_DIR/id/devices/<device_id>.key   — PEM PKCS8 private key
#   $ENTITY_DIR/id/devices/<device_id>.pub   — PEM SPKI public key
#
# Usage:
#   $ENTITY profile device-key add --device-id DEVICE_ID [options]
#
# See VESTA-SPEC-111 §11.4 for key storage layout guidance.

set -euo pipefail

ENTITY="${ENTITY:-koad}"
ENTITY_DIR="${ENTITY_DIR:-$HOME/.$ENTITY}"
SIGCHAIN_TIP_FILE="$ENTITY_DIR/var/sigchain-tip"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
SIGN_HELPER="$(dirname "$(dirname "$(dirname "${BASH_SOURCE[0]}")")")/.helpers/sign.js"

# ── Usage ─────────────────────────────────────────────────────────────────────

usage() {
  cat >&2 <<EOF
profile device-key add — generate a new device keypair and authorize it on the sigchain

Usage:
  $ENTITY profile device-key add --device-id DEVICE_ID [options]

Options:
  --device-id ID        Stable identifier for this device (e.g. "wonderland", "fourty4")
                        REQUIRED. Must be unique within this entity's chain.
  --description TEXT    Human-readable label (e.g. "wonderland — primary workstation")
                        Default: same as device-id
  --authorizing-key PATH  Path to the authorizing key (root key or authorized device key)
                          Default: entity root key ($ENTITY_DIR/id/ed25519.key or .../id/ed25519)
  --output DIR          Write signed entry JSON to this directory
  -h, --help            Show this help

Per VESTA-SPEC-111 §5.4.1: the reverse_sig protocol is followed automatically.
  1. Device key signs the pre-image (without reverse_sig field) — proves key control
  2. Root/authorizing key signs the full entry (with reverse_sig) — authorizes the device

Device key stored at:
  $ENTITY_DIR/id/devices/<device_id>.key   (private, PEM PKCS8)
  $ENTITY_DIR/id/devices/<device_id>.pub   (public, PEM SPKI)

Tip updated in: $SIGCHAIN_TIP_FILE

See also:
  $ENTITY profile device-key revoke  — revoke a device key
  $ENTITY profile device-key list    — list authorized device keys
EOF
}

# ── Arg parsing ───────────────────────────────────────────────────────────────

DEVICE_ID=""
DEVICE_DESCRIPTION=""
AUTH_KEY_PATH=""
OUTPUT_DIR=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --device-id)       DEVICE_ID="$2"; shift 2 ;;
    --description)     DEVICE_DESCRIPTION="$2"; shift 2 ;;
    --authorizing-key) AUTH_KEY_PATH="$2"; shift 2 ;;
    --output)          OUTPUT_DIR="$2"; shift 2 ;;
    -h|--help|help)    usage; exit 0 ;;
    *) echo "profile device-key add: unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

# ── Pre-flight checks ─────────────────────────────────────────────────────────

if [[ -z "$DEVICE_ID" ]]; then
  echo "profile device-key add: --device-id is required" >&2
  usage; exit 1
fi

# Default description
if [[ -z "$DEVICE_DESCRIPTION" ]]; then
  DEVICE_DESCRIPTION="$DEVICE_ID"
fi

# Locate authorizing key (root or specified)
if [[ -z "$AUTH_KEY_PATH" ]]; then
  if [[ -f "$ENTITY_DIR/id/ed25519.key" ]]; then
    AUTH_KEY_PATH="$ENTITY_DIR/id/ed25519.key"
  elif [[ -f "$ENTITY_DIR/id/ed25519" ]]; then
    AUTH_KEY_PATH="$ENTITY_DIR/id/ed25519"
  fi
fi

if [[ -z "$AUTH_KEY_PATH" ]]; then
  echo "profile device-key add: authorizing key not found." >&2
  echo "  Checked: $ENTITY_DIR/id/ed25519.key (PEM PKCS8)" >&2
  echo "           $ENTITY_DIR/id/ed25519 (OpenSSH)" >&2
  exit 1
fi

if [[ ! -f "$AUTH_KEY_PATH" ]]; then
  echo "profile device-key add: authorizing key not found: $AUTH_KEY_PATH" >&2
  exit 1
fi

if [[ ! -f "$SIGCHAIN_TIP_FILE" ]]; then
  echo "profile device-key add: sigchain tip not found: $SIGCHAIN_TIP_FILE" >&2
  echo "Run '$ENTITY profile create' first to initialize the sigchain." >&2
  exit 1
fi

if ! command -v node &>/dev/null; then
  echo "profile device-key add: node not found. Required for Ed25519 operations." >&2
  exit 1
fi

if [[ ! -f "$SIGN_HELPER" ]]; then
  echo "profile device-key add: sign helper not found: $SIGN_HELPER" >&2
  exit 1
fi

DEVICE_KEY_DIR="$ENTITY_DIR/id/devices"
DEVICE_KEY_PATH="$DEVICE_KEY_DIR/$DEVICE_ID.key"
DEVICE_PUB_PATH="$DEVICE_KEY_DIR/$DEVICE_ID.pub"

if [[ -f "$DEVICE_KEY_PATH" ]]; then
  echo "profile device-key add: device key already exists: $DEVICE_KEY_PATH" >&2
  echo "To re-authorize this device with a new key, first revoke the old one." >&2
  exit 1
fi

# ── Create device key directory ───────────────────────────────────────────────

mkdir -p "$DEVICE_KEY_DIR"
chmod 700 "$DEVICE_KEY_DIR"

if [[ -n "$OUTPUT_DIR" ]]; then
  mkdir -p "$OUTPUT_DIR"
fi

# ── Step 1: Generate new Ed25519 device keypair ───────────────────────────────

echo "Generating new Ed25519 keypair for device: $DEVICE_ID ..." >&2

# Generate PEM PKCS8 private key via OpenSSL
openssl genpkey -algorithm Ed25519 -out "$DEVICE_KEY_PATH" 2>/dev/null
chmod 600 "$DEVICE_KEY_PATH"

# Extract public key in PEM SPKI format
openssl pkey -in "$DEVICE_KEY_PATH" -pubout -out "$DEVICE_PUB_PATH" 2>/dev/null
chmod 644 "$DEVICE_PUB_PATH"

echo "Device key written: $DEVICE_KEY_PATH" >&2
echo "Device public key:  $DEVICE_PUB_PATH" >&2

# ── Step 2: Get public keys (base64url) ──────────────────────────────────────

# Device public key (base64url)
DEVICE_PUBKEY_RESULT=$(printf '%s' "{\"op\":\"pubkey\",\"keyPath\":\"${DEVICE_KEY_PATH}\"}" \
  | node "$SIGN_HELPER" 2>&1)

if ! echo "$DEVICE_PUBKEY_RESULT" | grep -q '"ok":true'; then
  echo "profile device-key add: failed to read device public key" >&2
  echo "$DEVICE_PUBKEY_RESULT" >&2
  exit 1
fi

DEVICE_PUBKEY_B64URL=$(echo "$DEVICE_PUBKEY_RESULT" | node -e \
  "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).pubkeyBase64Url))")

# Authorizing (root) public key (base64url)
AUTH_PUBKEY_RESULT=$(printf '%s' "{\"op\":\"pubkey\",\"keyPath\":\"${AUTH_KEY_PATH}\"}" \
  | node "$SIGN_HELPER" 2>&1)

if ! echo "$AUTH_PUBKEY_RESULT" | grep -q '"ok":true'; then
  echo "profile device-key add: failed to read authorizing key" >&2
  echo "$AUTH_PUBKEY_RESULT" >&2
  exit 1
fi

AUTH_PUBKEY_B64URL=$(echo "$AUTH_PUBKEY_RESULT" | node -e \
  "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).pubkeyBase64Url))")

CURRENT_TIP=$(cat "$SIGCHAIN_TIP_FILE")

# ── Step 3: Build entry WITHOUT reverse_sig (pre-image for device signing) ───
#
# Per SPEC-111 §5.4.1:
#   - Construct full entry with payload fields populated EXCEPT reverse_sig
#   - Sort payload keys lexicographically before serializing
#   - Device key signs the canonical pre-image of this entry (signature field absent)
#   - This produces reverse_sig

echo "Building device-key-add entry (step 1/2: reverse_sig)..." >&2

ENTRY_WITHOUT_REVERSE_SIG=$(node -e "
const ts = process.argv[1];
const entity = process.argv[2];
const prevCid = process.argv[3];
const deviceId = process.argv[4];
const devicePubkey = process.argv[5];
const deviceDesc = process.argv[6];
const authorizedBy = process.argv[7];

// Payload WITHOUT reverse_sig (to be signed by device key)
// Keys MUST be sorted lexicographically per SPEC-111 §3.2
const e = {
  entity,
  payload: {
    authorized_by: authorizedBy,
    device_description: deviceDesc,
    device_id: deviceId,
    device_pubkey: devicePubkey,
    key_type: 'ed25519',
  },
  previous: prevCid,
  timestamp: ts,
  type: 'koad.device-key-add',
  version: 1
};
process.stdout.write(JSON.stringify(e));
" "$TIMESTAMP" "$ENTITY" "$CURRENT_TIP" "$DEVICE_ID" "$DEVICE_PUBKEY_B64URL" "$DEVICE_DESCRIPTION" "$AUTH_PUBKEY_B64URL")

# ── Step 4: Device key signs the pre-image → reverse_sig ─────────────────────
#
# The sign op computes the pre-image (canonical dag-json without signature field)
# and signs it. We capture the signature as reverse_sig.
# We use the device key to sign here.

DEVICE_SIGN_RESULT=$(printf '%s' "{\"op\":\"sign\",\"entry\":${ENTRY_WITHOUT_REVERSE_SIG},\"keyPath\":\"${DEVICE_KEY_PATH}\"}" \
  | node "$SIGN_HELPER" 2>&1)

if ! echo "$DEVICE_SIGN_RESULT" | grep -q '"ok":true'; then
  echo "profile device-key add: device key signing failed" >&2
  echo "$DEVICE_SIGN_RESULT" >&2
  exit 1
fi

# Extract the signature — this IS the reverse_sig
REVERSE_SIG=$(echo "$DEVICE_SIGN_RESULT" | node -e \
  "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).signedEntry.signature))")

echo "reverse_sig computed (device key proof of possession)" >&2

# ── Step 5: Build full entry WITH reverse_sig, sign with authorizing key ──────
#
# Now add reverse_sig to payload and sign the full entry with the authorizing (root) key.
# Per §5.4.1 step 5: authorizing key signs the full entry pre-image (reverse_sig present).

echo "Signing entry with authorizing key (step 2/2)..." >&2

FULL_ENTRY=$(node -e "
const ts = process.argv[1];
const entity = process.argv[2];
const prevCid = process.argv[3];
const deviceId = process.argv[4];
const devicePubkey = process.argv[5];
const deviceDesc = process.argv[6];
const authorizedBy = process.argv[7];
const reverseSig = process.argv[8];

// Full entry WITH reverse_sig in payload (keys sorted)
const e = {
  entity,
  payload: {
    authorized_by: authorizedBy,
    device_description: deviceDesc,
    device_id: deviceId,
    device_pubkey: devicePubkey,
    key_type: 'ed25519',
    reverse_sig: reverseSig,
  },
  previous: prevCid,
  timestamp: ts,
  type: 'koad.device-key-add',
  version: 1
};
process.stdout.write(JSON.stringify(e));
" "$TIMESTAMP" "$ENTITY" "$CURRENT_TIP" "$DEVICE_ID" "$DEVICE_PUBKEY_B64URL" "$DEVICE_DESCRIPTION" "$AUTH_PUBKEY_B64URL" "$REVERSE_SIG")

AUTH_SIGN_RESULT=$(printf '%s' "{\"op\":\"sign\",\"entry\":${FULL_ENTRY},\"keyPath\":\"${AUTH_KEY_PATH}\"}" \
  | node "$SIGN_HELPER" 2>&1)

if ! echo "$AUTH_SIGN_RESULT" | grep -q '"ok":true'; then
  echo "profile device-key add: authorizing key signing failed" >&2
  echo "$AUTH_SIGN_RESULT" >&2
  exit 1
fi

SIGNED_ENTRY=$(echo "$AUTH_SIGN_RESULT" | node -e \
  "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.stringify(JSON.parse(d).signedEntry)))")
NEW_CID=$(echo "$AUTH_SIGN_RESULT" | node -e \
  "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).cid))")

echo "Entry CID: $NEW_CID" >&2

if [[ -n "$OUTPUT_DIR" ]]; then
  echo "$SIGNED_ENTRY" > "$OUTPUT_DIR/device-key-add-${DEVICE_ID}.json"
  echo "Wrote: $OUTPUT_DIR/device-key-add-${DEVICE_ID}.json" >&2
fi

# ── Step 6: Update sigchain tip ───────────────────────────────────────────────

echo "$NEW_CID" > "$SIGCHAIN_TIP_FILE"

echo ""
echo "Device key authorized:"
echo "  Entity:       $ENTITY"
echo "  Device ID:    $DEVICE_ID"
echo "  Description:  $DEVICE_DESCRIPTION"
echo "  Device key:   $DEVICE_KEY_PATH"
echo "  Entry CID:    $NEW_CID (new tip)"
echo "  Tip file:     $SIGCHAIN_TIP_FILE"
echo ""
echo "Note: IPFS not wired. CID computed locally."
echo "To push to IPFS: ipfs dag put --input-codec dag-json --store-codec dag-json < entry.json"
