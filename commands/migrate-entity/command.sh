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
#   - Sovereign mnemonic required (for fingerprint verification)
#
# What this does:
#   1. Verifies sovereign and entity preconditions
#   2. Asks for sovereign mnemonic; verifies against id/master.fingerprint
#   3. Generates fresh entity public keypair (entity.public.asc)
#   4. Generates device leaf for this machine (devices/<host>/)
#   5. Archives legacy key files to id/archive/pre-175-migration/
#   6. Updates .gitignore with SPEC-175 rules
#   7. Commits the migration in the entity's repo
#
# Idempotent paths:
#   - Already migrated (has entity.public.asc + leaf for this host): report + exit
#   - Entity key exists but no leaf for this host: generate leaf only
#   - --forceful: re-run even if already migrated (key rotation)
#
# Ref: VESTA-SPEC-175 §6.2 — migration steps; §6.3 — this command

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
say ""
say "The sovereign mnemonic is needed to verify you have authority to generate"
say "new entity keys signed by this sovereign."
say ""

# Check for tooling requirements
command -v jq >/dev/null 2>&1  || die "jq is required but not found — install it and retry"
command -v node >/dev/null 2>&1 || die "node is required but not found — install Node.js >= 18 and retry"

CEREMONY_SCRIPT="$(dirname "${BASH_SOURCE[0]}")/ceremony.mjs"

_cyan='\033[0;36m'
_dim='\033[2m'
_reset='\033[0m'
_bold='\033[1m'

MNEMONIC_INPUT=""
while [ -z "$MNEMONIC_INPUT" ]; do
    printf "\n  ${_cyan}▸${_reset} Sovereign recovery phrase ${_dim}(input hidden)${_reset}\n    ${_bold}›${_reset} " >&2
    read -rs MNEMONIC_INPUT </dev/tty
    echo "" >&2
    MNEMONIC_INPUT="$(echo "$MNEMONIC_INPUT" | tr -s ' ' | sed 's/^ //;s/ $//')"
    if [ -z "$MNEMONIC_INPUT" ]; then
        printf "  ${_dim}(required — please enter your recovery phrase)${_reset}\n" >&2
    fi
done

say ""
say "  Verifying mnemonic against master.fingerprint..."

VERIFY_JSON=$(node "$CEREMONY_SCRIPT" verify-mnemonic \
    --mnemonic "$MNEMONIC_INPUT" \
    --userid "$SOVEREIGN_USERID" \
    --expected-fingerprint "$EXPECTED_MASTER_FPR") || die "Mnemonic verification ceremony failed"

MNEMONIC_INPUT=""
unset MNEMONIC_INPUT

VERIFY_VALID=$(echo "$VERIFY_JSON" | jq -r '.valid')
if [ "$VERIFY_VALID" != "true" ]; then
    VERIFY_ERR=$(echo "$VERIFY_JSON" | jq -r '.error // "unknown error"')
    die "Mnemonic verification failed: $VERIFY_ERR"
fi

say "  Mnemonic verified — sovereign authority confirmed."
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
unset ENTITY_PUBLIC_ARMOR LEAF_PUBLIC_ARMOR

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
