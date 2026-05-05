#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# koad-io migrate-entity <name> — migrate an entity to SPEC-175 multi-device shape
#
# Usage:
#   koad-io migrate-entity <name>            # Migrate entity to new id/ layout
#   koad-io migrate-entity <name> --forceful # Re-run even if already migrated
#
# Pre-conditions:
#   - ~/.koad-io/me/ must exist (run 'koad-io init sovereign' first)
#   - ~/.<name>/ must exist
#   - Sovereign device leaf must exist at ~/.koad-io/me/id/devices/$HOSTNAME/
#
# What this does:
#   1. Verifies sovereign and entity preconditions
#   2. Verifies sovereign device leaf is present and decryptable (no mnemonic needed)
#   3. Generates fresh entity public keypair (entity.public.asc)
#   4. Generates device leaf for this machine (devices/<host>/)
#   5. Signs sigchain entries using the sovereign's device leaf (not master)
#   6. Archives legacy key files to id/archive/pre-175-migration/
#   7. Updates .gitignore with SPEC-175 rules
#   8. Commits the migration in the entity's repo
#
# Idempotent paths:
#   - Already migrated (has entity.public.asc + leaf for this host): report + exit
#   - Entity key exists but no leaf for this host: generate leaf only
#   - --forceful: re-run even if already migrated (key rotation)
#
# Ref: VESTA-SPEC-175 §6.2 — migration steps; §6.3 — this command
# Ref: VESTA-SPEC-149 — master/leaf split; master is paper-only after genesis

set -euo pipefail

source "$HOME/.koad-io/helpers/ask.sh"

# ---------------------------------------------------------------------------
# Args
# ---------------------------------------------------------------------------

ENTITY_NAME="${1:-}"
FORCEFUL=0
[[ "${*}" == *"--forceful"* ]] && FORCEFUL=1

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

say()  { echo "[migrate-entity] $*"; }
warn() { echo "[migrate-entity] WARNING: $*" >&2; }
die()  { echo "[migrate-entity] ERROR: $*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# Pre-flight: validate arguments
# ---------------------------------------------------------------------------

if [ -z "$ENTITY_NAME" ]; then
    die "Usage: koad-io migrate-entity <name> [--forceful]"
fi

# Reject flag-shaped names
if [[ "$ENTITY_NAME" == --* ]]; then
    die "Usage: koad-io migrate-entity <name> [--forceful]"
fi

# ---------------------------------------------------------------------------
# Pre-flight check 1: sovereign must exist
# ---------------------------------------------------------------------------

SOVEREIGN_DIR="$HOME/.koad-io/me"
SOVEREIGN_ID_DIR="$SOVEREIGN_DIR/id"
MASTER_FINGERPRINT_FILE="$SOVEREIGN_ID_DIR/master.fingerprint"

if [ ! -d "$SOVEREIGN_DIR" ]; then
    die "No sovereign found at $SOVEREIGN_DIR. Run 'koad-io init sovereign' first."
fi

if [ ! -f "$SOVEREIGN_DIR/id/gpg.public.asc" ]; then
    die "Sovereign exists but has no master public key at $SOVEREIGN_DIR/id/gpg.public.asc. Run 'koad-io init sovereign' first."
fi

if [ ! -f "$MASTER_FINGERPRINT_FILE" ]; then
    die "Sovereign exists but id/master.fingerprint is missing. Run 'koad-io init sovereign' to repair."
fi

EXPECTED_MASTER_FPR=$(cat "$MASTER_FINGERPRINT_FILE")
SOVEREIGN_LEAF_DIR="$SOVEREIGN_ID_DIR/devices/$HOST"
SOVEREIGN_LEAF_PRIVATE="$SOVEREIGN_LEAF_DIR/leaf.private.asc"
SOVEREIGN_DEVICE_KEY="$SOVEREIGN_LEAF_DIR/device.key"

# ---------------------------------------------------------------------------
# Pre-flight check 2: entity dir must exist
# ---------------------------------------------------------------------------

ENTITY_DIR="$HOME/.$ENTITY_NAME"

if [ ! -d "$ENTITY_DIR" ]; then
    die "Entity dir $ENTITY_DIR does not exist. Use 'koad-io gestate $ENTITY_NAME' to create a new entity."
fi

# ---------------------------------------------------------------------------
# Pre-flight check 3: check current migration state
# ---------------------------------------------------------------------------

ENTITY_ID_DIR="$ENTITY_DIR/id"
HOST=$(hostname -s)
DEVICE_DIR="$ENTITY_ID_DIR/devices/$HOST"

ENTITY_KEY_PRESENT=0
LEAF_PRESENT=0

[ -f "$ENTITY_ID_DIR/entity.public.asc" ] && ENTITY_KEY_PRESENT=1
[ -f "$DEVICE_DIR/leaf.private.asc" ]     && LEAF_PRESENT=1

# Already fully migrated for this host
if [ "$ENTITY_KEY_PRESENT" -eq 1 ] && [ "$LEAF_PRESENT" -eq 1 ] && [ "$FORCEFUL" -eq 0 ]; then
    say "Entity '$ENTITY_NAME' is already migrated on this device ($HOST)."
    say "  entity.public.asc: present"
    say "  devices/$HOST/leaf.private.asc: present"
    say ""
    say "Run with --forceful to re-run the migration (key rotation)."
    exit 0
fi

# Determine which steps to run
GENERATE_ENTITY_KEY=1
GENERATE_LEAF=1

if [ "$ENTITY_KEY_PRESENT" -eq 1 ] && [ "$LEAF_PRESENT" -eq 0 ] && [ "$FORCEFUL" -eq 0 ]; then
    # Secondary device adoption — entity key already exists, just need a leaf
    say "Entity '$ENTITY_NAME' has entity.public.asc but no leaf for this device ($HOST)."
    say "Generating device leaf only (secondary device adoption)."
    GENERATE_ENTITY_KEY=0
    GENERATE_LEAF=1
fi

if [ "$FORCEFUL" -eq 1 ]; then
    say "--forceful: will re-run full migration (key rotation)"
    GENERATE_ENTITY_KEY=1
    GENERATE_LEAF=1
fi

# ---------------------------------------------------------------------------
# Pre-flight check 4: verify entity has legacy key material (not fresh/empty)
# ---------------------------------------------------------------------------

LEGACY_KEYS=()
for kf in ed25519 ed25519.pub gpg.pub kbpgp_key kbpgp_key.pub wonderland wonderland.pub dsa dsa.pub ecdsa ecdsa.pub rsa rsa.pub; do
    [ -f "$ENTITY_ID_DIR/$kf" ] && LEGACY_KEYS+=("$kf")
done

if [ ${#LEGACY_KEYS[@]} -eq 0 ] && [ "$ENTITY_KEY_PRESENT" -eq 0 ] && [ "$FORCEFUL" -eq 0 ]; then
    say "Entity '$ENTITY_NAME' has no key material at all — this looks like a fresh entity."
    say "Use 'koad-io gestate $ENTITY_NAME' instead of migrate-entity."
    exit 1
fi

# ---------------------------------------------------------------------------
# Ask for sovereign mnemonic — verify against master.fingerprint
# ---------------------------------------------------------------------------

say ""
say "Migrating entity '$ENTITY_NAME' to SPEC-175 multi-device shape."
say ""

SOVEREIGN_LABEL=""
[ -f "$SOVEREIGN_ID_DIR/label" ] && SOVEREIGN_LABEL=$(cat "$SOVEREIGN_ID_DIR/label")
SOVEREIGN_USERID="${SOVEREIGN_LABEL:-sovereign}"

# Read sovereign handle + domain from .env for userid reconstruction
SOVEREIGN_HANDLE=""
SOVEREIGN_DOMAIN=""
if [ -f "$SOVEREIGN_DIR/.env" ]; then
    SOVEREIGN_HANDLE=$(grep "^SOVEREIGN_HANDLE=" "$SOVEREIGN_DIR/.env" 2>/dev/null | cut -d= -f2- || true)
    SOVEREIGN_DOMAIN=$(grep "^SOVEREIGN_DOMAIN=" "$SOVEREIGN_DIR/.env" 2>/dev/null | cut -d= -f2- || true)
fi

if [ -n "$SOVEREIGN_HANDLE" ] && [ -n "$SOVEREIGN_DOMAIN" ]; then
    SOVEREIGN_USERID="$SOVEREIGN_HANDLE @ $SOVEREIGN_DOMAIN"
fi

say "  Sovereign: $SOVEREIGN_USERID"
say "  Master fingerprint: $(cat "$MASTER_FINGERPRINT_FILE")"
say "  Device: $HOST"
say ""

# Check for tooling requirements
command -v jq >/dev/null 2>&1  || die "jq is required but not found — install it and retry"
command -v node >/dev/null 2>&1 || die "node is required but not found — install Node.js >= 18 and retry"

CEREMONY_SCRIPT="$(dirname "${BASH_SOURCE[0]}")/ceremony.mjs"

# ---------------------------------------------------------------------------
# Pre-flight check 5: sovereign device leaf must exist and be decryptable
# ---------------------------------------------------------------------------
# Per SPEC-149: master is paper-only after genesis. Entity gestation/migration
# is a routine sovereign act signed by the sovereign's active device leaf.

if [ ! -f "$SOVEREIGN_LEAF_PRIVATE" ]; then
    die "Sovereign device leaf not found at $SOVEREIGN_LEAF_PRIVATE. Run 'koad-io init sovereign' on this device first."
fi

if [ ! -f "$SOVEREIGN_DEVICE_KEY" ]; then
    die "Sovereign device key not found at $SOVEREIGN_DEVICE_KEY. This file must exist on the signing device."
fi

say "  Verifying sovereign device leaf..."

LEAF_VERIFY_JSON=$(node "$CEREMONY_SCRIPT" verify-leaf \
    --sovereign-leaf-encrypted-path "$SOVEREIGN_LEAF_PRIVATE" \
    --sovereign-device-key-path "$SOVEREIGN_DEVICE_KEY") || die "Sovereign leaf verification failed"

LEAF_VERIFY_VALID=$(echo "$LEAF_VERIFY_JSON" | jq -r '.valid')
if [ "$LEAF_VERIFY_VALID" != "true" ]; then
    LEAF_VERIFY_ERR=$(echo "$LEAF_VERIFY_JSON" | jq -r '.error // "unknown error"')
    die "Sovereign device leaf could not be decrypted: $LEAF_VERIFY_ERR"
fi

SOVEREIGN_LEAF_FINGERPRINT=$(echo "$LEAF_VERIFY_JSON" | jq -r '.leafFingerprint')
say "  Leaf verified — fingerprint: ${SOVEREIGN_LEAF_FINGERPRINT: -16}"

# ---------------------------------------------------------------------------
# Pre-flight check 6: verify sovereign leaf is authorized in sovereign sigchain
# ---------------------------------------------------------------------------
# If no sigchain exists yet, warn but allow — sovereign sigchain may not have been
# initialized yet (that's a separate gap to file).

SOVEREIGN_SIGCHAIN_ENTRIES_DIR="$SOVEREIGN_DIR/sigchain/entries"

if [ ! -d "$SOVEREIGN_SIGCHAIN_ENTRIES_DIR" ]; then
    warn "Sovereign sigchain has no entries yet. The device leaf authority cannot be verified via chain."
    warn "This is acceptable for the first migration if the sovereign sigchain is not yet initialized."
    warn "File a gap: 'koad-io init sovereign' should record a koad.identity.leaf-authorize entry for this leaf."
else
    # Check for a leaf-authorize entry referencing this leaf fingerprint
    LEAF_AUTHORIZED=$(grep -rl "$SOVEREIGN_LEAF_FINGERPRINT" "$SOVEREIGN_SIGCHAIN_ENTRIES_DIR" 2>/dev/null | head -1)
    if [ -z "$LEAF_AUTHORIZED" ]; then
        warn "No koad.identity.leaf-authorize entry found for this device leaf in the sovereign sigchain."
        warn "Leaf fingerprint: $SOVEREIGN_LEAF_FINGERPRINT"
        warn "Authority assumed for this migration. File a gap: sovereign init should record leaf-authorize entries."
    else
        say "  Leaf found in sovereign sigchain: authorized."
    fi
fi

say ""

# ---------------------------------------------------------------------------
# Step 1: Create entity id/ structure
# ---------------------------------------------------------------------------

mkdir -p "$ENTITY_ID_DIR"
mkdir -p "$DEVICE_DIR"

# ---------------------------------------------------------------------------
# Step 2: Handle --forceful archiving of existing SPEC-175 keys
# ---------------------------------------------------------------------------

if [ "$FORCEFUL" -eq 1 ] && [ "$ENTITY_KEY_PRESENT" -eq 1 ]; then
    ROTATION_ARCHIVE="$ENTITY_ID_DIR/archive/rotation-$(date +%Y%m%dT%H%M%S)"
    mkdir -p "$ROTATION_ARCHIVE"
    say "  --forceful: archiving existing SPEC-175 keys to archive/rotation-*"
    [ -f "$ENTITY_ID_DIR/entity.public.asc" ] && mv "$ENTITY_ID_DIR/entity.public.asc" "$ROTATION_ARCHIVE/"
    if [ -d "$DEVICE_DIR" ]; then
        mv "$DEVICE_DIR" "$ROTATION_ARCHIVE/device-$HOST"
        mkdir -p "$DEVICE_DIR"
    fi
    say "  Archived: $ROTATION_ARCHIVE"
fi

# ---------------------------------------------------------------------------
# Step 3: Generate entity keypair + device leaf
# ---------------------------------------------------------------------------

ENTITY_USERID="$ENTITY_NAME @ ${SOVEREIGN_DOMAIN:-kingdom}"

if [ "$GENERATE_ENTITY_KEY" -eq 1 ]; then
    say "Generating entity keypair and device leaf for '$ENTITY_NAME'..."
    say "  Entity userid: $ENTITY_USERID"

    CEREMONY_JSON=$(node "$CEREMONY_SCRIPT" generate-entity \
        --userid "$ENTITY_USERID") || die "Entity key generation ceremony failed"

    ENTITY_FINGERPRINT=$(echo "$CEREMONY_JSON" | jq -r '.entityFingerprint')
    ENTITY_PUBLIC_ARMOR=$(echo "$CEREMONY_JSON" | jq -r '.entityPublicArmor')
    LEAF_FINGERPRINT=$(echo "$CEREMONY_JSON" | jq -r '.leafFingerprint')
    LEAF_PUBLIC_ARMOR=$(echo "$CEREMONY_JSON" | jq -r '.leafPublicArmor')
    LEAF_PRIVATE_ARMOR=$(echo "$CEREMONY_JSON" | jq -r '.leafPrivateArmor')
    DEVICE_KEY=$(echo "$CEREMONY_JSON" | jq -r '.deviceKey')

    # Write entity public key
    printf '%s' "$ENTITY_PUBLIC_ARMOR" > "$ENTITY_ID_DIR/entity.public.asc"
    printf '%s' "$ENTITY_FINGERPRINT"  > "$ENTITY_ID_DIR/entity.fingerprint"

    say "  generated: id/entity.public.asc (fingerprint: ${ENTITY_FINGERPRINT: -16})"

elif [ "$GENERATE_LEAF" -eq 1 ]; then
    # Secondary device adoption — generate leaf only, entity key already exists
    say "Generating device leaf for '$ENTITY_NAME' on $HOST..."

    CEREMONY_JSON=$(node "$CEREMONY_SCRIPT" generate-entity \
        --userid "$ENTITY_USERID") || die "Entity key generation ceremony failed"

    LEAF_FINGERPRINT=$(echo "$CEREMONY_JSON" | jq -r '.leafFingerprint')
    LEAF_PUBLIC_ARMOR=$(echo "$CEREMONY_JSON" | jq -r '.leafPublicArmor')
    LEAF_PRIVATE_ARMOR=$(echo "$CEREMONY_JSON" | jq -r '.leafPrivateArmor')
    DEVICE_KEY=$(echo "$CEREMONY_JSON" | jq -r '.deviceKey')
fi

# Write device leaf
printf '%s' "$LEAF_PUBLIC_ARMOR"  > "$DEVICE_DIR/leaf.public.asc"
printf '%s' "$LEAF_PRIVATE_ARMOR" > "$DEVICE_DIR/leaf.private.asc"
printf '%s' "$DEVICE_KEY"         > "$DEVICE_DIR/device.key"
chmod 600 "$DEVICE_DIR/leaf.private.asc" "$DEVICE_DIR/device.key"

say "  generated: id/devices/$HOST/leaf.public.asc (fingerprint: ${LEAF_FINGERPRINT: -16})"
say "  generated: id/devices/$HOST/leaf.private.asc (encrypted — passphrase is device.key)"
say "  generated: id/devices/$HOST/device.key (gitignored — machine-local, never commit)"

# Zero sensitive vars
unset CEREMONY_JSON DEVICE_KEY LEAF_PRIVATE_ARMOR

say ""

# ---------------------------------------------------------------------------
# Step 3b: Sign and record sigchain entries in sovereign's chain
# ---------------------------------------------------------------------------
# Per VESTA-SPEC-175 §4 + SPEC-111 §3.2b:
#   - koad.entity.genesis: sovereign authorizes entity into existence
#   - koad.entity.leaf-authorize: sovereign authorizes this device's entity leaf
# Both entries are signed by the sovereign's active device leaf (SPEC-149: master is
# paper-only after genesis; routine sovereign acts use the device leaf).

SOVEREIGN_SIGCHAIN_DIR="$SOVEREIGN_DIR/sigchain"
SOVEREIGN_SIGCHAIN_HEAD_FILE="$SOVEREIGN_SIGCHAIN_DIR/head.cid"
SOVEREIGN_SIGCHAIN_META_FILE="$SOVEREIGN_SIGCHAIN_DIR/metadata.json"
# Note: SOVEREIGN_SIGCHAIN_ENTRIES_DIR is already set in pre-flight check 6

# Read current head CID (empty if sovereign has no sigchain yet)
CURRENT_HEAD=""
if [ -f "$SOVEREIGN_SIGCHAIN_HEAD_FILE" ]; then
    CURRENT_HEAD=$(cat "$SOVEREIGN_SIGCHAIN_HEAD_FILE" | tr -d '[:space:]')
fi

say "Signing sigchain entries in sovereign's chain (using device leaf)..."
say "  Current sovereign chain head: ${CURRENT_HEAD:-'(none — first entity entry)'}"
say "  Signing leaf: ${SOVEREIGN_LEAF_FINGERPRINT: -16}"

# Read entity public armor from the file we just wrote
ENTITY_PUBLIC_ARMOR_FILE="$ENTITY_ID_DIR/entity.public.asc"
ENTITY_FINGERPRINT_FILE="$ENTITY_ID_DIR/entity.fingerprint"

# Determine entity fingerprint
if [ -f "$ENTITY_FINGERPRINT_FILE" ]; then
    ENTITY_FINGERPRINT=$(cat "$ENTITY_FINGERPRINT_FILE")
elif [ -n "${ENTITY_FINGERPRINT:-}" ]; then
    : # Already set from generate-entity step
else
    die "Cannot determine entity fingerprint — id/entity.fingerprint missing"
fi

# Read entity public armor from disk (avoids passing multi-line armor through argv)
if [ ! -f "$ENTITY_PUBLIC_ARMOR_FILE" ]; then
    die "entity.public.asc not found at $ENTITY_PUBLIC_ARMOR_FILE"
fi

# Pass entity public armor via a temp file path (not argv, to avoid quoting issues)
ENTITY_ARMOR_TMPFILE=$(mktemp /tmp/koad-entity-armor.XXXXXX)
cp "$ENTITY_PUBLIC_ARMOR_FILE" "$ENTITY_ARMOR_TMPFILE"

# Build sign-entity-entries args.
# --skip-genesis is passed when only adding a new device leaf (entity key already committed)
SIGN_ENTITY_EXTRA_ARGS=()
if [ "$GENERATE_ENTITY_KEY" -eq 0 ]; then
    SIGN_ENTITY_EXTRA_ARGS+=("--skip-genesis")
fi

ENTITY_SIGNING_JSON=$(node "$CEREMONY_SCRIPT" sign-entity-entries \
    --sovereign-leaf-encrypted-path "$SOVEREIGN_LEAF_PRIVATE" \
    --sovereign-device-key-path "$SOVEREIGN_DEVICE_KEY" \
    --sovereign-leaf-fingerprint "$SOVEREIGN_LEAF_FINGERPRINT" \
    --entity-handle "$ENTITY_NAME" \
    --entity-fingerprint "$ENTITY_FINGERPRINT" \
    --entity-public-armor "$(cat "$ENTITY_ARMOR_TMPFILE")" \
    --leaf-fingerprint "$LEAF_FINGERPRINT" \
    --host "$HOST" \
    --sigchain-head "$CURRENT_HEAD" \
    "${SIGN_ENTITY_EXTRA_ARGS[@]}") \
    || { rm -f "$ENTITY_ARMOR_TMPFILE"; die "Sigchain signing ceremony failed"; }

rm -f "$ENTITY_ARMOR_TMPFILE"

# Extract results
GENESIS_CID=$(echo "$ENTITY_SIGNING_JSON" | jq -r '.genesisCid')
LEAF_CID=$(echo "$ENTITY_SIGNING_JSON" | jq -r '.leafCid')
NEW_HEAD_CID=$(echo "$ENTITY_SIGNING_JSON" | jq -r '.newHeadCid')

if [ -z "$LEAF_CID" ] || [ "$LEAF_CID" = "null" ]; then
    die "Sigchain signing returned no leafCid — check ceremony output"
fi

SKIP_GENESIS=$(echo "$ENTITY_SIGNING_JSON" | jq -r '.skipGenesis // false')

if [ "$SKIP_GENESIS" = "false" ]; then
    if [ -z "$GENESIS_CID" ] || [ "$GENESIS_CID" = "null" ]; then
        die "Sigchain signing returned no genesisCid — check ceremony output"
    fi
    say "  signed: koad.entity.genesis (CID: ${GENESIS_CID:0:20}...)"
fi
say "  signed: koad.entity.leaf-authorize (CID: ${LEAF_CID:0:20}...)"

# Write entries to sovereign's sigchain store (append-only)
mkdir -p "$SOVEREIGN_SIGCHAIN_ENTRIES_DIR"

# Write individual entry files (keyed by CID)
if [ "$SKIP_GENESIS" = "false" ] && [ -n "$GENESIS_CID" ] && [ "$GENESIS_CID" != "null" ]; then
    echo "$ENTITY_SIGNING_JSON" | jq '.genesisEntry' > "$SOVEREIGN_SIGCHAIN_ENTRIES_DIR/$GENESIS_CID.json"
fi
echo "$ENTITY_SIGNING_JSON" | jq '.leafEntry' > "$SOVEREIGN_SIGCHAIN_ENTRIES_DIR/$LEAF_CID.json"

# Update head pointer
printf '%s' "$NEW_HEAD_CID" > "$SOVEREIGN_SIGCHAIN_HEAD_FILE"

# Update metadata.json
NOW_ISO=$(date -u +%Y-%m-%dT%H:%M:%SZ)
if [ -f "$SOVEREIGN_SIGCHAIN_META_FILE" ]; then
    # Update existing metadata — update head CID and timestamp
    EXISTING_META=$(cat "$SOVEREIGN_SIGCHAIN_META_FILE")
    echo "$EXISTING_META" | jq \
        --arg cid "$NEW_HEAD_CID" \
        --arg updated "$NOW_ISO" \
        '.sigchainHeadCID = $cid | .sigchainHeadUpdated = $updated' \
        > "$SOVEREIGN_SIGCHAIN_META_FILE.tmp" && mv "$SOVEREIGN_SIGCHAIN_META_FILE.tmp" "$SOVEREIGN_SIGCHAIN_META_FILE"
else
    # Create fresh metadata file
    jq -n \
        --arg handle "koad" \
        --arg fpr "$EXPECTED_MASTER_FPR" \
        --arg cid "$NEW_HEAD_CID" \
        --arg created "$NOW_ISO" \
        --arg updated "$NOW_ISO" \
        '{
            handle: $handle,
            masterFingerprint: $fpr,
            sigchainHeadCID: $cid,
            status: "active",
            created: $created,
            sigchainHeadUpdated: $updated
        }' > "$SOVEREIGN_SIGCHAIN_META_FILE"
fi

if [ "$SKIP_GENESIS" = "false" ] && [ -n "$GENESIS_CID" ] && [ "$GENESIS_CID" != "null" ]; then
    say "  recorded: me/sigchain/entries/$GENESIS_CID.json"
fi
say "  recorded: me/sigchain/entries/$LEAF_CID.json"
say "  updated:  me/sigchain/head.cid → ${NEW_HEAD_CID:0:20}..."

# Unset sensitive JSON
unset ENTITY_SIGNING_JSON

say ""

# ---------------------------------------------------------------------------
# Step 4: Write migration record
# ---------------------------------------------------------------------------

MIGRATION_RECORD="$ENTITY_ID_DIR/migrated-at"
if [ ! -f "$MIGRATION_RECORD" ] || [ "$FORCEFUL" -eq 1 ]; then
    printf '%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$MIGRATION_RECORD"
    say "  wrote: id/migrated-at"
fi

# ---------------------------------------------------------------------------
# Step 5: Archive legacy key files
# ---------------------------------------------------------------------------

if [ ${#LEGACY_KEYS[@]} -gt 0 ]; then
    LEGACY_ARCHIVE="$ENTITY_ID_DIR/archive/pre-175-migration"
    mkdir -p "$LEGACY_ARCHIVE"
    say "Archiving legacy key files to id/archive/pre-175-migration/"
    for kf in "${LEGACY_KEYS[@]}"; do
        src="$ENTITY_ID_DIR/$kf"
        if [ -f "$src" ]; then
            mv "$src" "$LEGACY_ARCHIVE/$kf"
            say "  archived: $kf"
        fi
    done
fi

# ---------------------------------------------------------------------------
# Step 6: Update .gitignore
# ---------------------------------------------------------------------------

ENTITY_GITIGNORE="$ENTITY_DIR/.gitignore"

# Ensure SPEC-175 gitignore rules are present
update_gitignore() {
    local gitignore="$1"

    # Create if missing
    if [ ! -f "$gitignore" ]; then
        cat > "$gitignore" << 'GITIGNORE'
# SPDX-License-Identifier: AGPL-3.0-or-later
GITIGNORE
        say "  created: .gitignore"
    fi

    local changed=0

    # Add private key rules if missing
    if ! grep -q "id/devices/\*/leaf.private.asc" "$gitignore" 2>/dev/null; then
        printf '\n# SPEC-175: per-device private key material — never commit\nid/devices/*/leaf.private.asc\nid/devices/*/device.key\n' >> "$gitignore"
        changed=1
    fi

    # Add archive allowlist if missing
    if ! grep -q "!id/archive" "$gitignore" 2>/dev/null; then
        printf '\n# SPEC-175: entity.public.asc is committed (sovereign-certified public identity)\n!id/entity.public.asc\n!id/entity.fingerprint\n!id/migrated-at\n!id/archive/**\n' >> "$gitignore"
        changed=1
    fi

    if [ "$changed" -eq 1 ]; then
        say "  updated: .gitignore (added SPEC-175 rules)"
    else
        say "  .gitignore — SPEC-175 rules already present"
    fi
}

update_gitignore "$ENTITY_GITIGNORE"

# Also update entity's id/.gitignore if it exists, or create one
ENTITY_ID_GITIGNORE="$ENTITY_ID_DIR/.gitignore"
if [ ! -f "$ENTITY_ID_GITIGNORE" ]; then
    cat > "$ENTITY_ID_GITIGNORE" << 'GITIGNORE'
# SPDX-License-Identifier: AGPL-3.0-or-later
# id/.gitignore for SPEC-175 shape
# Private keys — never commit
devices/*/leaf.private.asc
devices/*/device.key
# Keep public material
!devices/*/leaf.public.asc
!entity.public.asc
!entity.fingerprint
!migrated-at
!archive/**
# Keep this file
!.gitignore
GITIGNORE
    say "  created: id/.gitignore"
fi

say ""

# ---------------------------------------------------------------------------
# Step 7: Commit in entity repo
# ---------------------------------------------------------------------------

# Determine entity git repo (may or may not be initialized)
if [ ! -d "$ENTITY_DIR/.git" ]; then
    warn "Entity dir $ENTITY_DIR is not a git repo — skipping commit."
    warn "Initialize with: git -C $ENTITY_DIR init"
    say ""
    say "Migration complete (uncommitted). Initialize the git repo and commit manually:"
    say "  git -C $ENTITY_DIR add -f id/entity.public.asc id/entity.fingerprint id/migrated-at"
    say "  git -C $ENTITY_DIR add -f 'id/devices/$HOST/leaf.public.asc'"
    say "  git -C $ENTITY_DIR commit -m 'id: migrate to SPEC-175 multi-device shape'"
    say "  git -C $ENTITY_DIR push"
    exit 0
fi

# Determine commit author — use entity's own git config if available
AUTHOR_ENV=()
ENTITY_ENV_FILE="$ENTITY_DIR/.env"
if [ -f "$ENTITY_ENV_FILE" ]; then
    ENTITY_GIT_NAME=$(grep "^GIT_AUTHOR_NAME=" "$ENTITY_ENV_FILE" 2>/dev/null | cut -d= -f2- || true)
    ENTITY_GIT_EMAIL=$(grep "^GIT_AUTHOR_EMAIL=" "$ENTITY_ENV_FILE" 2>/dev/null | cut -d= -f2- || true)
    if [ -n "$ENTITY_GIT_NAME" ] && [ -n "$ENTITY_GIT_EMAIL" ]; then
        AUTHOR_ENV=(
            "GIT_AUTHOR_NAME=$ENTITY_GIT_NAME"
            "GIT_COMMITTER_NAME=$ENTITY_GIT_NAME"
            "GIT_AUTHOR_EMAIL=$ENTITY_GIT_EMAIL"
            "GIT_COMMITTER_EMAIL=$ENTITY_GIT_EMAIL"
        )
        say "Committing as entity: $ENTITY_GIT_NAME <$ENTITY_GIT_EMAIL>"
    fi
fi

# Stage new SPEC-175 artifacts
say "Staging and committing migration..."

# Force-add items that may be behind gitignore patterns
git -C "$ENTITY_DIR" add -f "$ENTITY_ID_DIR/entity.public.asc" 2>/dev/null || true
git -C "$ENTITY_DIR" add -f "$ENTITY_ID_DIR/entity.fingerprint" 2>/dev/null || true
git -C "$ENTITY_DIR" add -f "$ENTITY_ID_DIR/migrated-at" 2>/dev/null || true
git -C "$ENTITY_DIR" add -f "$DEVICE_DIR/leaf.public.asc" 2>/dev/null || true

# Stage gitignore changes
git -C "$ENTITY_DIR" add "$ENTITY_GITIGNORE" 2>/dev/null || true
git -C "$ENTITY_DIR" add "$ENTITY_ID_GITIGNORE" 2>/dev/null || true

# Stage archiving of legacy key removals (git rm handles tracked → archived moves)
for kf in "${LEGACY_KEYS[@]}"; do
    if git -C "$ENTITY_DIR" ls-files --error-unmatch "$ENTITY_ID_DIR/$kf" >/dev/null 2>&1; then
        git -C "$ENTITY_DIR" rm --cached "$ENTITY_ID_DIR/$kf" 2>/dev/null || true
    fi
done

# Stage archive contents
if [ -d "$ENTITY_ID_DIR/archive" ]; then
    git -C "$ENTITY_DIR" add "$ENTITY_ID_DIR/archive" 2>/dev/null || true
fi

# Commit if anything staged
if ! git -C "$ENTITY_DIR" diff --cached --quiet 2>/dev/null; then
    COMMIT_MSG="id: migrate to SPEC-175 multi-device shape"
    if [ "$FORCEFUL" -eq 1 ]; then
        COMMIT_MSG="id: rotate keys per SPEC-175 (--forceful, $HOST)"
    elif [ "$GENERATE_ENTITY_KEY" -eq 0 ]; then
        COMMIT_MSG="id: add device leaf for $HOST (SPEC-175 secondary device)"
    fi

    if [ ${#AUTHOR_ENV[@]} -gt 0 ]; then
        env "${AUTHOR_ENV[@]}" git -C "$ENTITY_DIR" commit -m "$COMMIT_MSG"
    else
        git -C "$ENTITY_DIR" commit -m "$COMMIT_MSG"
    fi
    say "  committed: $COMMIT_MSG"
else
    say "  nothing to commit (all changes already staged)"
fi

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------

say ""
say "================================================================================"
say " Migration complete: $ENTITY_NAME"
say "================================================================================"
say ""
say " Entity dir:    $ENTITY_DIR"
say " Entity key:    $ENTITY_ID_DIR/entity.public.asc"
say " Device leaf:   $DEVICE_DIR/leaf.public.asc"
say " Device:        $HOST"
say ""
if [ ${#LEGACY_KEYS[@]} -gt 0 ]; then
    say " Legacy keys archived to: $ENTITY_ID_DIR/archive/pre-175-migration/"
    say " (${#LEGACY_KEYS[@]} files — preserved for audit; safe to delete after transition)"
    say ""
fi
say " Next steps:"
say "   git -C $ENTITY_DIR push"
say ""
say " To add another device:"
say "   koad-io migrate-entity $ENTITY_NAME   (run on the new device)"
say ""

source "$HOME/.koad-io/helpers/discovery.sh" 2>/dev/null && _koad_io_hint
