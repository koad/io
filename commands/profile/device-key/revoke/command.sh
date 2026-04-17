#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# profile device-key revoke — revoke a previously authorized device key
#
# Implements VESTA-SPEC-111 v1.1 §5.4 (koad.device-key-revoke entry type).
#
# Builds a koad.device-key-revoke entry signed by the root key (or another
# authorized device key). No reverse_sig is required for revocation.
#
# Per SPEC-111 §5.4: a device key cannot self-revoke. The signing key must be
# different from the device key being revoked.
#
# Usage:
#   $ENTITY profile device-key revoke <device-id> [options]

set -euo pipefail

ENTITY="${ENTITY:-koad}"
ENTITY_DIR="${ENTITY_DIR:-$HOME/.$ENTITY}"
SIGCHAIN_TIP_FILE="$ENTITY_DIR/var/sigchain-tip"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
SIGN_HELPER="$(dirname "$(dirname "$(dirname "${BASH_SOURCE[0]}")")")/.helpers/sign.js"

# ── Usage ─────────────────────────────────────────────────────────────────────

usage() {
  cat >&2 <<EOF
profile device-key revoke — revoke an authorized device key

Usage:
  $ENTITY profile device-key revoke <device-id> [options]

Arguments:
  <device-id>         The device_id of the key to revoke (REQUIRED)

Options:
  --reason REASON     Reason for revocation: decommissioned | compromised | retired
                      Default: decommissioned
  --signing-key PATH  Key to sign the revocation entry (root key or authorized device key)
                      Must NOT be the key being revoked. Default: root key.
  --output DIR        Write signed entry JSON to this directory
  -h, --help          Show this help

Per VESTA-SPEC-111 §5.4:
  - No reverse_sig is required for revocation
  - The signing key must not be the device key being revoked
  - "compromised" reason signals verifiers to treat post-revocation signed entries
    from this key with additional suspicion

See also:
  $ENTITY profile device-key add   — authorize a new device key
  $ENTITY profile device-key list  — list currently authorized device keys
EOF
}

# ── Arg parsing ───────────────────────────────────────────────────────────────

DEVICE_ID="${1:-}"
REASON="decommissioned"
SIGNING_KEY_PATH=""
OUTPUT_DIR=""

# Shift positional if provided
if [[ -n "$DEVICE_ID" && "$DEVICE_ID" != --* ]]; then
  shift
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --reason)      REASON="$2"; shift 2 ;;
    --signing-key) SIGNING_KEY_PATH="$2"; shift 2 ;;
    --output)      OUTPUT_DIR="$2"; shift 2 ;;
    -h|--help|help) usage; exit 0 ;;
    *) echo "profile device-key revoke: unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

# ── Pre-flight checks ─────────────────────────────────────────────────────────

if [[ -z "$DEVICE_ID" ]]; then
  echo "profile device-key revoke: <device-id> is required" >&2
  usage; exit 1
fi

case "$REASON" in
  decommissioned|compromised|retired) ;;
  *) echo "profile device-key revoke: invalid reason '$REASON'" >&2
     echo "  Valid values: decommissioned | compromised | retired" >&2
     exit 1 ;;
esac

# Locate signing key
if [[ -z "$SIGNING_KEY_PATH" ]]; then
  if [[ -f "$ENTITY_DIR/id/ed25519.key" ]]; then
    SIGNING_KEY_PATH="$ENTITY_DIR/id/ed25519.key"
  elif [[ -f "$ENTITY_DIR/id/ed25519" ]]; then
    SIGNING_KEY_PATH="$ENTITY_DIR/id/ed25519"
  fi
fi

if [[ -z "$SIGNING_KEY_PATH" ]]; then
  echo "profile device-key revoke: signing key not found." >&2
  echo "  Checked: $ENTITY_DIR/id/ed25519.key (PEM PKCS8)" >&2
  echo "           $ENTITY_DIR/id/ed25519 (OpenSSH)" >&2
  exit 1
fi

if [[ ! -f "$SIGNING_KEY_PATH" ]]; then
  echo "profile device-key revoke: signing key not found: $SIGNING_KEY_PATH" >&2
  exit 1
fi

if [[ ! -f "$SIGCHAIN_TIP_FILE" ]]; then
  echo "profile device-key revoke: sigchain tip not found: $SIGCHAIN_TIP_FILE" >&2
  echo "Run '$ENTITY profile create' first." >&2
  exit 1
fi

if ! command -v node &>/dev/null; then
  echo "profile device-key revoke: node not found. Required for Ed25519 signing." >&2
  exit 1
fi

if [[ ! -f "$SIGN_HELPER" ]]; then
  echo "profile device-key revoke: sign helper not found: $SIGN_HELPER" >&2
  exit 1
fi

DEVICE_PUB_PATH="$ENTITY_DIR/id/devices/$DEVICE_ID.pub"

if [[ ! -f "$DEVICE_PUB_PATH" ]]; then
  echo "profile device-key revoke: device public key not found: $DEVICE_PUB_PATH" >&2
  echo "Cannot construct revocation entry without the device public key." >&2
  echo "Expected at: $DEVICE_PUB_PATH" >&2
  exit 1
fi

if [[ -n "$OUTPUT_DIR" ]]; then
  mkdir -p "$OUTPUT_DIR"
fi

# ── Get device public key (base64url) ─────────────────────────────────────────

DEVICE_PUBKEY_RESULT=$(printf '%s' "{\"op\":\"pubkey\",\"keyPath\":\"${DEVICE_PUB_PATH}\"}" \
  | node "$SIGN_HELPER" 2>&1)

if ! echo "$DEVICE_PUBKEY_RESULT" | grep -q '"ok":true'; then
  echo "profile device-key revoke: failed to read device public key" >&2
  echo "$DEVICE_PUBKEY_RESULT" >&2
  exit 1
fi

DEVICE_PUBKEY_B64URL=$(echo "$DEVICE_PUBKEY_RESULT" | node -e \
  "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).pubkeyBase64Url))")

CURRENT_TIP=$(cat "$SIGCHAIN_TIP_FILE")

# ── Self-revocation guard ─────────────────────────────────────────────────────
# Compare signing key's public key with the device key being revoked.
# If they match, abort — a key cannot self-revoke (SPEC-111 §5.4).

SIGNING_PUBKEY_RESULT=$(printf '%s' "{\"op\":\"pubkey\",\"keyPath\":\"${SIGNING_KEY_PATH}\"}" \
  | node "$SIGN_HELPER" 2>&1)

SIGNING_PUBKEY_B64URL=$(echo "$SIGNING_PUBKEY_RESULT" | node -e \
  "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).pubkeyBase64Url))" 2>/dev/null || true)

if [[ -n "$SIGNING_PUBKEY_B64URL" && "$SIGNING_PUBKEY_B64URL" == "$DEVICE_PUBKEY_B64URL" ]]; then
  echo "profile device-key revoke: signing key and revoked key are the same." >&2
  echo "Per VESTA-SPEC-111 §5.4: a device key cannot self-revoke." >&2
  echo "Use the root key or a different authorized device key to sign the revocation." >&2
  exit 1
fi

# ── Build and sign revocation entry ──────────────────────────────────────────

echo "Building koad.device-key-revoke entry for device: $DEVICE_ID ..." >&2

REVOKE_ENTRY=$(node -e "
const ts = process.argv[1];
const entity = process.argv[2];
const prevCid = process.argv[3];
const deviceId = process.argv[4];
const devicePubkey = process.argv[5];
const reason = process.argv[6];

// Payload keys sorted lexicographically
const e = {
  entity,
  payload: {
    device_id: deviceId,
    device_pubkey: devicePubkey,
    reason: reason,
  },
  previous: prevCid,
  timestamp: ts,
  type: 'koad.device-key-revoke',
  version: 1
};
process.stdout.write(JSON.stringify(e));
" "$TIMESTAMP" "$ENTITY" "$CURRENT_TIP" "$DEVICE_ID" "$DEVICE_PUBKEY_B64URL" "$REASON")

SIGN_RESULT=$(printf '%s' "{\"op\":\"sign\",\"entry\":${REVOKE_ENTRY},\"keyPath\":\"${SIGNING_KEY_PATH}\"}" \
  | node "$SIGN_HELPER" 2>&1)

if ! echo "$SIGN_RESULT" | grep -q '"ok":true'; then
  echo "profile device-key revoke: signing failed" >&2
  echo "$SIGN_RESULT" >&2
  exit 1
fi

SIGNED_ENTRY=$(echo "$SIGN_RESULT" | node -e \
  "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.stringify(JSON.parse(d).signedEntry)))")
NEW_CID=$(echo "$SIGN_RESULT" | node -e \
  "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).cid))")

echo "Entry CID: $NEW_CID" >&2

if [[ -n "$OUTPUT_DIR" ]]; then
  echo "$SIGNED_ENTRY" > "$OUTPUT_DIR/device-key-revoke-${DEVICE_ID}.json"
  echo "Wrote: $OUTPUT_DIR/device-key-revoke-${DEVICE_ID}.json" >&2
fi

# ── Update sigchain tip ───────────────────────────────────────────────────────

echo "$NEW_CID" > "$SIGCHAIN_TIP_FILE"

echo ""
echo "Device key revoked:"
echo "  Entity:     $ENTITY"
echo "  Device ID:  $DEVICE_ID"
echo "  Reason:     $REASON"
echo "  Entry CID:  $NEW_CID (new tip)"
echo "  Tip file:   $SIGCHAIN_TIP_FILE"
if [[ "$REASON" == "compromised" ]]; then
  echo ""
  echo "WARNING: reason=compromised — verifiers will flag entries signed by this key"
  echo "between last known-safe use and this revocation as potentially suspect."
fi
