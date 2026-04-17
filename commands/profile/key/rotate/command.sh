#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# profile key rotate — rotate the entity's root Ed25519 signing key
#
# Implements VESTA-SPEC-111 v1.5 §5.2 (koad.key-rotation entry type).
#
# Steps:
#   1. Read current root key (old key — this authorizes the rotation)
#   2. Generate a new Ed25519 keypair at $ENTITY_DIR/id/ed25519.new
#   3. Build koad.key-rotation entry:
#        old_pubkey, new_pubkey, reason, effective, rotated_at
#   4. Sign the entry with the OLD key (proves the current key holder chose to rotate)
#   5. Append entry to sigchain (update tip)
#   6. Archive old key to $ENTITY_DIR/id/ed25519.rotated-YYYYMMDD
#   7. Promote new key to $ENTITY_DIR/id/ed25519 (canonical path)
#
# Usage:
#   $ENTITY profile key rotate --reason REASON [options]
#
# Note: If the old key is already lost or compromised and unavailable, this command
#       cannot run — that requires a separate recovery protocol (not yet specified).
#       See follow-on: koad/vesta lost-key-recovery spec.
#
# See VESTA-SPEC-111 §5.2 for full key-rotation entry definition.

set -euo pipefail

ENTITY="${ENTITY:-koad}"
ENTITY_DIR="${ENTITY_DIR:-$HOME/.$ENTITY}"
SIGCHAIN_TIP_FILE="$ENTITY_DIR/var/sigchain-tip"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
DATE_SLUG=$(date -u +"%Y%m%d")
SIGN_HELPER="$(dirname "$(dirname "$(dirname "${BASH_SOURCE[0]}")")")/.helpers/sign.js"

# ── Usage ─────────────────────────────────────────────────────────────────────

usage() {
  cat >&2 <<EOF
profile key rotate — rotate the entity's root signing key

Usage:
  $ENTITY profile key rotate --reason REASON [options]

Options:
  --reason STRING       Human-readable reason for rotation (required unless --non-interactive)
                        Examples: "key compromised", "scheduled rotation", "device migrated",
                                  "wrong email in keygen commit"
  --non-interactive     Skip confirmation prompt
  --dry-run             Generate the new key and rotation entry, but do not update sigchain
                        or swap key files (preview mode)
  --new-key-path PATH   Use an existing key as the new key instead of generating one
                        (must be PEM PKCS8 or OpenSSH Ed25519)
  --cache-dir DIR       Write signed entry JSON to this directory for chain walking
                        Default: $ENTITY_DIR/var/sigchain-cache
  -h, --help            Show this help

Important: The rotation entry is signed by the OLD key — proving the current keyholder
           authorized the rotation. If the old key is unavailable, this command cannot run.

After rotation:
  Active key:  $ENTITY_DIR/id/ed25519 (or .key)
  Archived:    $ENTITY_DIR/id/ed25519.rotated-YYYYMMDD

See also:
  $ENTITY profile key list   — show root key rotation timeline
EOF
}

# ── Arg parsing ───────────────────────────────────────────────────────────────

REASON=""
NON_INTERACTIVE=false
DRY_RUN=false
NEW_KEY_PATH_ARG=""
CACHE_DIR="$ENTITY_DIR/var/sigchain-cache"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --reason)           REASON="$2"; shift 2 ;;
    --non-interactive)  NON_INTERACTIVE=true; shift ;;
    --dry-run)          DRY_RUN=true; shift ;;
    --new-key-path)     NEW_KEY_PATH_ARG="$2"; shift 2 ;;
    --cache-dir)        CACHE_DIR="$2"; shift 2 ;;
    -h|--help|help)     usage; exit 0 ;;
    *) echo "profile key rotate: unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

# ── Pre-flight checks ─────────────────────────────────────────────────────────

# Locate old (current) root key
OLD_KEY_PATH=""
if [[ -f "$ENTITY_DIR/id/ed25519.key" ]]; then
  OLD_KEY_PATH="$ENTITY_DIR/id/ed25519.key"
elif [[ -f "$ENTITY_DIR/id/ed25519" ]]; then
  OLD_KEY_PATH="$ENTITY_DIR/id/ed25519"
fi

if [[ -z "$OLD_KEY_PATH" ]]; then
  echo "profile key rotate: current root key not found." >&2
  echo "  Checked: $ENTITY_DIR/id/ed25519.key (PEM PKCS8)" >&2
  echo "           $ENTITY_DIR/id/ed25519 (OpenSSH)" >&2
  echo "" >&2
  echo "If the key is already lost, this command cannot run." >&2
  echo "Lost-key recovery requires a separate protocol (not yet specified)." >&2
  exit 1
fi

if [[ ! -f "$SIGCHAIN_TIP_FILE" ]]; then
  echo "profile key rotate: sigchain tip not found: $SIGCHAIN_TIP_FILE" >&2
  echo "Run '$ENTITY profile create' first to initialize the sigchain." >&2
  exit 1
fi

if ! command -v node &>/dev/null; then
  echo "profile key rotate: node not found. Required for Ed25519 operations." >&2
  exit 1
fi

if [[ ! -f "$SIGN_HELPER" ]]; then
  echo "profile key rotate: sign helper not found: $SIGN_HELPER" >&2
  exit 1
fi

# Reason is required
if [[ -z "$REASON" ]]; then
  if [[ "$NON_INTERACTIVE" == "true" ]]; then
    echo "profile key rotate: --reason is required with --non-interactive" >&2
    usage; exit 1
  fi
  echo -n "Reason for key rotation: " >&2
  read -r REASON
  if [[ -z "$REASON" ]]; then
    echo "profile key rotate: reason cannot be empty" >&2
    exit 1
  fi
fi

# Check no in-progress rotation key exists (fail-safe)
KEY_EXT="${OLD_KEY_PATH##*/}"  # e.g. "ed25519" or "ed25519.key"
KEY_DIR="${OLD_KEY_PATH%/*}"   # e.g. "$ENTITY_DIR/id"
NEW_KEY_STAGING="$KEY_DIR/${KEY_EXT}.new"

if [[ -z "$NEW_KEY_PATH_ARG" ]] && [[ -f "$NEW_KEY_STAGING" ]]; then
  echo "profile key rotate: a staged new key already exists: $NEW_KEY_STAGING" >&2
  echo "If a previous rotation failed mid-flight, review and clean up manually." >&2
  echo "To use this key as the new key, pass: --new-key-path $NEW_KEY_STAGING" >&2
  exit 1
fi

ARCHIVE_PATH="$KEY_DIR/${KEY_EXT}.rotated-${DATE_SLUG}"
if [[ -f "$ARCHIVE_PATH" ]]; then
  echo "profile key rotate: archive path already exists: $ARCHIVE_PATH" >&2
  echo "Cannot archive old key — a rotation already happened today." >&2
  echo "Wait until tomorrow or clean up the existing archive file." >&2
  exit 1
fi

CURRENT_TIP=$(cat "$SIGCHAIN_TIP_FILE")

# ── Get old key pubkey ────────────────────────────────────────────────────────

echo "Reading current root key: $OLD_KEY_PATH" >&2

OLD_PUBKEY_RESULT=$(printf '%s' "{\"op\":\"pubkey\",\"keyPath\":\"${OLD_KEY_PATH}\"}" \
  | node "$SIGN_HELPER" 2>&1)

if ! echo "$OLD_PUBKEY_RESULT" | grep -q '"ok":true'; then
  echo "profile key rotate: failed to read current root key pubkey" >&2
  echo "$OLD_PUBKEY_RESULT" >&2
  exit 1
fi

OLD_PUBKEY_B64URL=$(echo "$OLD_PUBKEY_RESULT" | node -e \
  "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).pubkeyBase64Url))")

echo "Old pubkey (first 16 chars): ${OLD_PUBKEY_B64URL:0:16}..." >&2

# ── Generate or load new key ──────────────────────────────────────────────────

if [[ -n "$NEW_KEY_PATH_ARG" ]]; then
  NEW_KEY_PATH="$NEW_KEY_PATH_ARG"
  echo "Using provided new key: $NEW_KEY_PATH" >&2
else
  echo "Generating new Ed25519 keypair..." >&2
  NEW_KEY_PATH="$NEW_KEY_STAGING"

  openssl genpkey -algorithm Ed25519 -out "$NEW_KEY_PATH" 2>/dev/null
  chmod 600 "$NEW_KEY_PATH"
  echo "New key written (staging): $NEW_KEY_PATH" >&2
fi

NEW_PUBKEY_RESULT=$(printf '%s' "{\"op\":\"pubkey\",\"keyPath\":\"${NEW_KEY_PATH}\"}" \
  | node "$SIGN_HELPER" 2>&1)

if ! echo "$NEW_PUBKEY_RESULT" | grep -q '"ok":true'; then
  echo "profile key rotate: failed to read new key pubkey" >&2
  echo "$NEW_PUBKEY_RESULT" >&2
  [[ -z "$NEW_KEY_PATH_ARG" ]] && rm -f "$NEW_KEY_PATH"
  exit 1
fi

NEW_PUBKEY_B64URL=$(echo "$NEW_PUBKEY_RESULT" | node -e \
  "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).pubkeyBase64Url))")

echo "New pubkey (first 16 chars): ${NEW_PUBKEY_B64URL:0:16}..." >&2

# ── Confirmation prompt ───────────────────────────────────────────────────────

if [[ "$NON_INTERACTIVE" == "false" && "$DRY_RUN" == "false" ]]; then
  echo "" >&2
  echo "About to rotate root key for entity: $ENTITY" >&2
  echo "  Old pubkey: ${OLD_PUBKEY_B64URL:0:32}..." >&2
  echo "  New pubkey: ${NEW_PUBKEY_B64URL:0:32}..." >&2
  echo "  Reason:     $REASON" >&2
  echo "  Archive:    $ARCHIVE_PATH" >&2
  echo "" >&2
  echo -n "Proceed? [y/N] " >&2
  read -r CONFIRM
  if [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]]; then
    echo "Rotation cancelled." >&2
    [[ -z "$NEW_KEY_PATH_ARG" ]] && rm -f "$NEW_KEY_PATH"
    exit 0
  fi
fi

# ── Build rotation entry ──────────────────────────────────────────────────────
#
# Per SPEC-111 §5.2: payload contains old_pubkey, new_pubkey, reason, effective.
# Entry is signed by the OLD key — proving the current keyholder authorized the rotation.
# Keys in payload sorted lexicographically per SPEC-111 §3.2.

echo "" >&2
echo "Building koad.key-rotation entry..." >&2

ROTATION_ENTRY=$(node -e "
const ts        = process.argv[1];
const entity    = process.argv[2];
const prevCid   = process.argv[3];
const oldPubkey = process.argv[4];
const newPubkey = process.argv[5];
const reason    = process.argv[6];

const e = {
  entity,
  payload: {
    effective:  ts,
    new_pubkey: newPubkey,
    old_pubkey: oldPubkey,
    reason,
    rotated_at: ts,
  },
  previous: prevCid,
  timestamp: ts,
  type: 'koad.key-rotation',
  version: 1
};
process.stdout.write(JSON.stringify(e));
" "$TIMESTAMP" "$ENTITY" "$CURRENT_TIP" "$OLD_PUBKEY_B64URL" "$NEW_PUBKEY_B64URL" "$REASON")

# ── Sign the entry with the OLD key ──────────────────────────────────────────
#
# Critical: the rotation entry MUST be signed by the OLD key.
# This is cryptographic proof that the current keyholder chose to rotate.

echo "Signing rotation entry with OLD key (authorizes the rotation)..." >&2

SIGN_RESULT=$(printf '%s' "{\"op\":\"sign\",\"entry\":${ROTATION_ENTRY},\"keyPath\":\"${OLD_KEY_PATH}\"}" \
  | node "$SIGN_HELPER" 2>&1)

if ! echo "$SIGN_RESULT" | grep -q '"ok":true'; then
  echo "profile key rotate: signing failed" >&2
  echo "$SIGN_RESULT" >&2
  [[ -z "$NEW_KEY_PATH_ARG" ]] && rm -f "$NEW_KEY_PATH"
  exit 1
fi

SIGNED_ENTRY=$(echo "$SIGN_RESULT" | node -e \
  "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.stringify(JSON.parse(d).signedEntry)))")
NEW_CID=$(echo "$SIGN_RESULT" | node -e \
  "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).cid))")

echo "Rotation entry CID: $NEW_CID" >&2

# ── Dry-run exit point ────────────────────────────────────────────────────────

if [[ "$DRY_RUN" == "true" ]]; then
  echo "" >&2
  echo "[DRY RUN] — no files modified, no sigchain update." >&2
  echo "" >&2
  echo "Would produce:"
  echo "  Rotation CID:    $NEW_CID"
  echo "  Old pubkey:      $OLD_PUBKEY_B64URL"
  echo "  New pubkey:      $NEW_PUBKEY_B64URL"
  echo "  Signed by:       OLD key ($OLD_KEY_PATH)"
  echo "  Would archive:   $OLD_KEY_PATH → $ARCHIVE_PATH"
  echo "  Would promote:   $NEW_KEY_PATH → $OLD_KEY_PATH"
  echo "  Reason:          $REASON"
  echo ""
  echo "Rotation entry (signed):"
  echo "$SIGNED_ENTRY" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.stringify(JSON.parse(d),null,2)))"
  [[ -z "$NEW_KEY_PATH_ARG" ]] && rm -f "$NEW_KEY_PATH"
  exit 0
fi

# ── Cache entry ───────────────────────────────────────────────────────────────

mkdir -p "$CACHE_DIR"

# Annotate with _cid for chain walker
CACHED_ENTRY=$(echo "$SIGNED_ENTRY" | node -e \
  "const cid=process.argv[1];let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const e=JSON.parse(d);e._cid=cid;console.log(JSON.stringify(e,null,2));})" \
  "$NEW_CID")

echo "$CACHED_ENTRY" > "$CACHE_DIR/key-rotation-${DATE_SLUG}.json"
echo "Cached entry: $CACHE_DIR/key-rotation-${DATE_SLUG}.json" >&2

# ── Commit: update sigchain tip ───────────────────────────────────────────────

echo "$NEW_CID" > "$SIGCHAIN_TIP_FILE"
echo "Sigchain tip updated: $NEW_CID" >&2

# ── Swap key files ────────────────────────────────────────────────────────────
#
# Archive old key first, then promote new key.
# Both steps are atomic rename operations — no window where neither key exists.

echo "Archiving old key → $ARCHIVE_PATH" >&2
mv "$OLD_KEY_PATH" "$ARCHIVE_PATH"

echo "Promoting new key → $OLD_KEY_PATH" >&2
mv "$NEW_KEY_PATH" "$OLD_KEY_PATH"
chmod 600 "$OLD_KEY_PATH"

# ── Report ────────────────────────────────────────────────────────────────────

echo ""
echo "Root key rotation complete:"
echo "  Entity:       $ENTITY"
echo "  Rotation CID: $NEW_CID (new tip)"
echo "  New pubkey:   $NEW_PUBKEY_B64URL"
echo "  Old pubkey:   $OLD_PUBKEY_B64URL (archived)"
echo "  Archive:      $ARCHIVE_PATH"
echo "  Active key:   $OLD_KEY_PATH"
echo "  Reason:       $REASON"
echo "  Timestamp:    $TIMESTAMP"
echo ""
echo "Going forward, this entity signs with the new key."
echo "The rotation entry is permanent and verifiable."
echo ""
echo "Note: IPFS not wired. CID computed locally."
echo "To push to IPFS: ipfs dag put --input-codec dag-json --store-codec dag-json < entry.json"
