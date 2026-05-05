#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# koad-io init <entity> [<repo-url>] — state-aware idempotent entity init
# koad-io init sovereign              — kingdom genesis (delegated to sovereign/command.sh)
#
# Usage:
#   koad-io init sovereign              # Kingdom genesis — see init/sovereign/command.sh
#   koad-io init <name>                 # State-detect + init/migrate/re-seed as needed
#   koad-io init <name> <url>           # Clone entity repo then state-detect
#   koad-io init <name> --forceful      # Force re-run even if already initialized
#
# State machine (entity path):
#   1. Dir missing + URL given     → git clone → fall through to state detection
#   2. Dir missing + no URL        → error, redirect to gestate or pass URL
#   3. Dir present, legacy keys    → migrate to SPEC-175 (absorbs migrate-entity)
#   4. Dir present, no keys at all → re-seed: regenerate device leaf + leaf-authorize
#   5. Dir present, partial SPEC-175 → fill in missing pieces idempotently
#   6. Dir present, full SPEC-175  → "all set", optionally backfill leaf-authorize
#   7. Dir present, SPEC-175 entity key but no leaf for THIS device → secondary device adoption
#
# Pre-flight checks (entity path):
#   - Sovereign must exist at ~/.koad-io/me/
#   - Sovereign device leaf must exist at ~/.koad-io/me/id/devices/$HOSTNAME/
#
# After state resolution:
#   - Launcher at ~/.koad-io/bin/<entity> is always ensured
#   - .env is scaffolded from kingdom defaults if missing
#   - AGENTS.md is regenerated from KOAD_IO.md → ENTITY.md → PRIMER.md
#
# Ref: VESTA-SPEC-175 §6 — entity key shape
# Ref: VESTA-SPEC-149 — master/leaf split

set -euo pipefail

# ---------------------------------------------------------------------------
# Route: sovereign subcommand
# ---------------------------------------------------------------------------

_INIT_CMD_DIR="$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")"

if [ "${1:-}" = "sovereign" ]; then
    shift
    exec "$_INIT_CMD_DIR/sovereign/command.sh" "$@"
fi

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

say()  { echo "[init] $*"; }
warn() { echo "[init] WARNING: $*" >&2; }
die()  { echo "[init] ERROR: $*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# Args
# ---------------------------------------------------------------------------

ENTITY_NAME="${1:-}"
REPO_URL=""
FORCEFUL=0

# Parse remaining args
shift || true
for arg in "$@"; do
    case "$arg" in
        --forceful) FORCEFUL=1 ;;
        http://*|https://*|git@*|keybase://*) REPO_URL="$arg" ;;
        *) : ;;
    esac
done

# If no entity name, fall back to current directory basename
if [ -z "$ENTITY_NAME" ]; then
    ENTITY_NAME=$(basename "$PWD")
    ENTITY_NAME="${ENTITY_NAME#.}"
    say "No entity name given — using current directory: $ENTITY_NAME"
fi

# Reject flag-shaped names
if [[ "$ENTITY_NAME" == --* ]]; then
    die "Usage: koad-io init <name> [<repo-url>] [--forceful]"
fi

ENTITY_DIR="$HOME/.$ENTITY_NAME"

# ---------------------------------------------------------------------------
# Pre-flight 1: sovereign must exist
# ---------------------------------------------------------------------------

SOVEREIGN_DIR="$HOME/.koad-io/me"
SOVEREIGN_ID_DIR="$SOVEREIGN_DIR/id"
MASTER_FINGERPRINT_FILE="$SOVEREIGN_ID_DIR/master.fingerprint"
HOST=$(hostname -s)
SOVEREIGN_LEAF_DIR="$SOVEREIGN_ID_DIR/devices/$HOST"
SOVEREIGN_LEAF_PRIVATE="$SOVEREIGN_LEAF_DIR/leaf.private.asc"
SOVEREIGN_DEVICE_KEY="$SOVEREIGN_LEAF_DIR/device.key"

if [ ! -d "$SOVEREIGN_DIR" ]; then
    die "No sovereign found at $SOVEREIGN_DIR. Run 'koad-io init sovereign' first."
fi

if [ ! -f "$SOVEREIGN_ID_DIR/gpg.public.asc" ]; then
    die "Sovereign exists but has no master public key. Run 'koad-io init sovereign' first."
fi

if [ ! -f "$MASTER_FINGERPRINT_FILE" ]; then
    die "Sovereign id/master.fingerprint is missing. Run 'koad-io init sovereign' to repair."
fi

# ---------------------------------------------------------------------------
# Pre-flight 2: sovereign device leaf must exist on this machine
# ---------------------------------------------------------------------------

if [ ! -f "$SOVEREIGN_LEAF_PRIVATE" ]; then
    die "Sovereign device leaf not found at $SOVEREIGN_LEAF_PRIVATE. Run 'koad-io init sovereign' on this device first."
fi

if [ ! -f "$SOVEREIGN_DEVICE_KEY" ]; then
    die "Sovereign device key not found at $SOVEREIGN_DEVICE_KEY. Run 'koad-io init sovereign' on this device first."
fi

EXPECTED_MASTER_FPR=$(cat "$MASTER_FINGERPRINT_FILE")

# ---------------------------------------------------------------------------
# State 1/2: Dir missing — clone or error
# ---------------------------------------------------------------------------

if [ ! -d "$ENTITY_DIR" ]; then
    if [ -n "$REPO_URL" ]; then
        say "Cloning entity '$ENTITY_NAME' from $REPO_URL"
        git clone "$REPO_URL" "$ENTITY_DIR" || die "Clone failed: $REPO_URL"
        say "Cloned to $ENTITY_DIR — continuing with state detection"
    else
        die "Entity '$ENTITY_NAME' does not exist at $ENTITY_DIR.
  To create a new entity:   koad-io gestate $ENTITY_NAME
  To clone an existing one: koad-io init $ENTITY_NAME <repo-url>"
    fi
fi

# ---------------------------------------------------------------------------
# Determine migration state
# ---------------------------------------------------------------------------

ENTITY_ID_DIR="$ENTITY_DIR/id"
DEVICE_DIR="$ENTITY_ID_DIR/devices/$HOST"

ENTITY_KEY_PRESENT=0
LEAF_PRESENT=0
LEGACY_KEYS=()

[ -f "$ENTITY_ID_DIR/entity.public.asc" ] && ENTITY_KEY_PRESENT=1
[ -f "$DEVICE_DIR/leaf.private.asc" ]     && LEAF_PRESENT=1

for kf in ed25519 ed25519.pub gpg.pub kbpgp_key kbpgp_key.pub wonderland wonderland.pub dsa dsa.pub ecdsa ecdsa.pub rsa rsa.pub; do
    [ -f "$ENTITY_ID_DIR/$kf" ] && LEGACY_KEYS+=("$kf")
done

HAS_LEGACY=${#LEGACY_KEYS[@]}

# Determine which action to take
ACTION="unknown"

if [ "$FORCEFUL" -eq 1 ]; then
    ACTION="migrate"  # full re-run when forced
elif [ "$ENTITY_KEY_PRESENT" -eq 1 ] && [ "$LEAF_PRESENT" -eq 1 ]; then
    ACTION="all-set"
elif [ "$ENTITY_KEY_PRESENT" -eq 1 ] && [ "$LEAF_PRESENT" -eq 0 ]; then
    ACTION="secondary-device"  # State 7: entity key present, no leaf for this device
elif [ "$HAS_LEGACY" -gt 0 ]; then
    ACTION="migrate"  # State 3: legacy keys present
elif [ "$ENTITY_KEY_PRESENT" -eq 0 ] && [ "$LEAF_PRESENT" -eq 0 ]; then
    ACTION="re-seed"  # State 4/5: no keys at all
fi

say "Entity: $ENTITY_NAME  ($ENTITY_DIR)"
say "State:  entity.public.asc=$([ "$ENTITY_KEY_PRESENT" -eq 1 ] && echo present || echo missing)  leaf/$HOST=$([ "$LEAF_PRESENT" -eq 1 ] && echo present || echo missing)  legacy_keys=$HAS_LEGACY"
say "Action: $ACTION"
say ""

# ---------------------------------------------------------------------------
# Tooling requirements (needed for migrate, re-seed, secondary-device)
# ---------------------------------------------------------------------------

CEREMONY_SCRIPT="$_INIT_CMD_DIR/ceremony.mjs"

if [ "$ACTION" != "all-set" ]; then
    command -v jq   >/dev/null 2>&1 || die "jq is required but not found — install it and retry"
    command -v node >/dev/null 2>&1 || die "node is required but not found — install Node.js >= 18 and retry"

    if [ ! -f "$CEREMONY_SCRIPT" ]; then
        die "Ceremony script not found at $CEREMONY_SCRIPT — framework installation may be incomplete"
    fi
fi

# ---------------------------------------------------------------------------
# Helper: verify sovereign device leaf is decryptable
# ---------------------------------------------------------------------------

verify_sovereign_leaf() {
    LEAF_VERIFY_JSON=$(node "$CEREMONY_SCRIPT" verify-leaf \
        --sovereign-leaf-encrypted-path "$SOVEREIGN_LEAF_PRIVATE" \
        --sovereign-device-key-path "$SOVEREIGN_DEVICE_KEY") || die "Sovereign leaf verification failed"

    LEAF_VERIFY_VALID=$(echo "$LEAF_VERIFY_JSON" | jq -r '.valid')
    if [ "$LEAF_VERIFY_VALID" != "true" ]; then
        LEAF_VERIFY_ERR=$(echo "$LEAF_VERIFY_JSON" | jq -r '.error // "unknown error"')
        die "Sovereign device leaf could not be decrypted: $LEAF_VERIFY_ERR"
    fi

    SOVEREIGN_LEAF_FINGERPRINT=$(echo "$LEAF_VERIFY_JSON" | jq -r '.leafFingerprint')
    say "  Sovereign leaf verified — fingerprint: ${SOVEREIGN_LEAF_FINGERPRINT: -16}"
}

# ---------------------------------------------------------------------------
# Helper: sign sigchain entries for entity genesis + leaf-authorize
# ---------------------------------------------------------------------------

sign_entity_sigchain_entries() {
    local skip_genesis="${1:-0}"

    SOVEREIGN_SIGCHAIN_DIR="$SOVEREIGN_DIR/sigchain"
    SOVEREIGN_SIGCHAIN_HEAD_FILE="$SOVEREIGN_SIGCHAIN_DIR/head.cid"
    SOVEREIGN_SIGCHAIN_META_FILE="$SOVEREIGN_SIGCHAIN_DIR/metadata.json"
    SOVEREIGN_SIGCHAIN_ENTRIES_DIR="$SOVEREIGN_SIGCHAIN_DIR/entries"

    CURRENT_HEAD=""
    [ -f "$SOVEREIGN_SIGCHAIN_HEAD_FILE" ] && CURRENT_HEAD=$(cat "$SOVEREIGN_SIGCHAIN_HEAD_FILE" | tr -d '[:space:]')

    SOVEREIGN_DOMAIN=""
    [ -f "$SOVEREIGN_DIR/.env" ] && SOVEREIGN_DOMAIN=$(grep "^SOVEREIGN_DOMAIN=" "$SOVEREIGN_DIR/.env" 2>/dev/null | cut -d= -f2- || true)

    ENTITY_PUBLIC_ARMOR_FILE="$ENTITY_ID_DIR/entity.public.asc"
    ENTITY_FINGERPRINT_FILE="$ENTITY_ID_DIR/entity.fingerprint"

    [ -f "$ENTITY_FINGERPRINT_FILE" ] && ENTITY_FINGERPRINT=$(cat "$ENTITY_FINGERPRINT_FILE")
    [ -z "${ENTITY_FINGERPRINT:-}" ] && die "Cannot determine entity fingerprint — id/entity.fingerprint missing"
    [ -f "$ENTITY_PUBLIC_ARMOR_FILE" ] || die "entity.public.asc not found at $ENTITY_PUBLIC_ARMOR_FILE"

    ENTITY_ARMOR_TMPFILE=$(mktemp /tmp/koad-entity-armor.XXXXXX)
    cp "$ENTITY_PUBLIC_ARMOR_FILE" "$ENTITY_ARMOR_TMPFILE"

    SIGN_ENTITY_EXTRA_ARGS=()
    [ "$skip_genesis" = "1" ] && SIGN_ENTITY_EXTRA_ARGS+=("--skip-genesis")

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

    GENESIS_CID=$(echo "$ENTITY_SIGNING_JSON" | jq -r '.genesisCid')
    LEAF_CID=$(echo "$ENTITY_SIGNING_JSON" | jq -r '.leafCid')
    NEW_HEAD_CID=$(echo "$ENTITY_SIGNING_JSON" | jq -r '.newHeadCid')
    SKIP_GENESIS_RESULT=$(echo "$ENTITY_SIGNING_JSON" | jq -r '.skipGenesis // false')

    [ -z "$LEAF_CID" ] || [ "$LEAF_CID" = "null" ] && die "Sigchain signing returned no leafCid"

    mkdir -p "$SOVEREIGN_SIGCHAIN_ENTRIES_DIR"

    if [ "$SKIP_GENESIS_RESULT" = "false" ]; then
        [ -z "$GENESIS_CID" ] || [ "$GENESIS_CID" = "null" ] && die "Sigchain signing returned no genesisCid"
        echo "$ENTITY_SIGNING_JSON" | jq '.genesisEntry' > "$SOVEREIGN_SIGCHAIN_ENTRIES_DIR/$GENESIS_CID.json"
        say "  signed: koad.entity.genesis (CID: ${GENESIS_CID:0:20}...)"
    fi

    echo "$ENTITY_SIGNING_JSON" | jq '.leafEntry' > "$SOVEREIGN_SIGCHAIN_ENTRIES_DIR/$LEAF_CID.json"
    say "  signed: koad.entity.leaf-authorize (CID: ${LEAF_CID:0:20}...)"

    printf '%s' "$NEW_HEAD_CID" > "$SOVEREIGN_SIGCHAIN_HEAD_FILE"

    NOW_ISO=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    if [ -f "$SOVEREIGN_SIGCHAIN_META_FILE" ]; then
        EXISTING_META=$(cat "$SOVEREIGN_SIGCHAIN_META_FILE")
        echo "$EXISTING_META" | jq \
            --arg cid "$NEW_HEAD_CID" \
            --arg updated "$NOW_ISO" \
            '.sigchainHeadCID = $cid | .sigchainHeadUpdated = $updated' \
            > "$SOVEREIGN_SIGCHAIN_META_FILE.tmp" && mv "$SOVEREIGN_SIGCHAIN_META_FILE.tmp" "$SOVEREIGN_SIGCHAIN_META_FILE"
    else
        jq -n \
            --arg handle "$(basename "$SOVEREIGN_DIR")" \
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

    say "  recorded: me/sigchain/entries/$LEAF_CID.json"
    say "  updated:  me/sigchain/head.cid → ${NEW_HEAD_CID:0:20}..."

    unset ENTITY_SIGNING_JSON
}

# ---------------------------------------------------------------------------
# Helper: write SPEC-175 gitignore rules
# ---------------------------------------------------------------------------

ensure_spec175_gitignore() {
    local gitignore="$1"

    [ ! -f "$gitignore" ] && printf '# SPDX-License-Identifier: AGPL-3.0-or-later\n' > "$gitignore"

    local changed=0

    if ! grep -q "id/devices/\*/leaf.private.asc" "$gitignore" 2>/dev/null; then
        printf '\n# SPEC-175: per-device private key material — never commit\nid/devices/*/leaf.private.asc\nid/devices/*/device.key\n' >> "$gitignore"
        changed=1
    fi

    if ! grep -q "!id/entity.public.asc" "$gitignore" 2>/dev/null; then
        printf '\n# SPEC-175: entity.public.asc is committed (sovereign-certified public identity)\n!id/entity.public.asc\n!id/entity.fingerprint\n!id/migrated-at\n!id/archive/**\n' >> "$gitignore"
        changed=1
    fi

    [ "$changed" -eq 1 ] && say "  updated: .gitignore (added SPEC-175 rules)"
}

ensure_spec175_id_gitignore() {
    local id_gitignore="$1"

    if [ ! -f "$id_gitignore" ]; then
        cat > "$id_gitignore" << 'GITIGNORE'
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
}

# ---------------------------------------------------------------------------
# Helper: commit entity migration artifacts
# ---------------------------------------------------------------------------

commit_entity_migration() {
    local commit_msg="$1"

    [ ! -d "$ENTITY_DIR/.git" ] && {
        warn "Entity dir $ENTITY_DIR is not a git repo — skipping commit."
        warn "Initialize: git -C $ENTITY_DIR init"
        say "Migration complete (uncommitted). Initialize the git repo and commit manually."
        return 0
    }

    # Read entity commit author from .env
    AUTHOR_ENV=()
    if [ -f "$ENTITY_DIR/.env" ]; then
        ENTITY_GIT_NAME=$(grep "^GIT_AUTHOR_NAME=" "$ENTITY_DIR/.env" 2>/dev/null | cut -d= -f2- || true)
        ENTITY_GIT_EMAIL=$(grep "^GIT_AUTHOR_EMAIL=" "$ENTITY_DIR/.env" 2>/dev/null | cut -d= -f2- || true)
        if [ -n "$ENTITY_GIT_NAME" ] && [ -n "$ENTITY_GIT_EMAIL" ]; then
            AUTHOR_ENV=(
                "GIT_AUTHOR_NAME=$ENTITY_GIT_NAME"
                "GIT_COMMITTER_NAME=$ENTITY_GIT_NAME"
                "GIT_AUTHOR_EMAIL=$ENTITY_GIT_EMAIL"
                "GIT_COMMITTER_EMAIL=$ENTITY_GIT_EMAIL"
            )
            say "  Committing as: $ENTITY_GIT_NAME <$ENTITY_GIT_EMAIL>"
        fi
    fi

    # Force-add SPEC-175 public artifacts (may be behind gitignore)
    git -C "$ENTITY_DIR" add -f "$ENTITY_ID_DIR/entity.public.asc" 2>/dev/null || true
    git -C "$ENTITY_DIR" add -f "$ENTITY_ID_DIR/entity.fingerprint"  2>/dev/null || true
    git -C "$ENTITY_DIR" add -f "$ENTITY_ID_DIR/migrated-at"         2>/dev/null || true
    git -C "$ENTITY_DIR" add -f "$DEVICE_DIR/leaf.public.asc"         2>/dev/null || true
    git -C "$ENTITY_DIR" add "$ENTITY_DIR/.gitignore"                  2>/dev/null || true
    git -C "$ENTITY_DIR" add "$ENTITY_ID_DIR/.gitignore"               2>/dev/null || true

    # Stage archive of legacy key removals
    if [ "$HAS_LEGACY" -gt 0 ]; then
        for kf in "${LEGACY_KEYS[@]}"; do
            if git -C "$ENTITY_DIR" ls-files --error-unmatch "$ENTITY_ID_DIR/$kf" >/dev/null 2>&1; then
                git -C "$ENTITY_DIR" rm --cached "$ENTITY_ID_DIR/$kf" 2>/dev/null || true
            fi
        done
        [ -d "$ENTITY_ID_DIR/archive" ] && git -C "$ENTITY_DIR" add "$ENTITY_ID_DIR/archive" 2>/dev/null || true
    fi

    if ! git -C "$ENTITY_DIR" diff --cached --quiet 2>/dev/null; then
        if [ ${#AUTHOR_ENV[@]} -gt 0 ]; then
            env "${AUTHOR_ENV[@]}" git -C "$ENTITY_DIR" commit -m "$commit_msg"
        else
            git -C "$ENTITY_DIR" commit -m "$commit_msg"
        fi
        say "  committed: $commit_msg"
    else
        say "  nothing new to commit (entity repo)"
    fi
}

# ---------------------------------------------------------------------------
# State 6: All set — full SPEC-175 already on this device
# ---------------------------------------------------------------------------

if [ "$ACTION" = "all-set" ]; then
    say "Entity '$ENTITY_NAME' is already fully initialized on this device ($HOST)."
    say "  entity.public.asc: present"
    say "  devices/$HOST/leaf.private.asc: present"

    # Optionally backfill leaf-authorize entry if missing from sovereign sigchain
    SOVEREIGN_SIGCHAIN_ENTRIES_DIR="$SOVEREIGN_DIR/sigchain/entries"
    if [ -d "$SOVEREIGN_SIGCHAIN_ENTRIES_DIR" ]; then
        EXISTING_LEAF_FPR=$(node "$CEREMONY_SCRIPT" get-leaf-fingerprint \
            --leaf-public-armor-file "$DEVICE_DIR/leaf.public.asc" 2>/dev/null | \
            jq -r '.fingerprint // empty' 2>/dev/null || true)

        if [ -n "$EXISTING_LEAF_FPR" ]; then
            LEAF_AUTHORIZED=$(grep -rl "$EXISTING_LEAF_FPR" "$SOVEREIGN_SIGCHAIN_ENTRIES_DIR" 2>/dev/null | head -1)
            if [ -z "$LEAF_AUTHORIZED" ]; then
                warn "No koad.entity.leaf-authorize entry for this device's entity leaf in sovereign sigchain."
                warn "Run with --forceful to re-sign, or file this gap with Vesta."
            fi
        fi
    fi

    # fall through to common: launcher + .env + AGENTS.md

elif [ "$ACTION" = "migrate" ]; then
    # -----------------------------------------------------------------------
    # State 3: Legacy keys present → migrate to SPEC-175
    # Also handles --forceful re-run (key rotation)
    # -----------------------------------------------------------------------

    say "Migrating entity '$ENTITY_NAME' to SPEC-175 multi-device shape..."
    say ""

    verify_sovereign_leaf

    # Step 2: Archive existing SPEC-175 keys if --forceful
    mkdir -p "$ENTITY_ID_DIR"
    mkdir -p "$DEVICE_DIR"

    if [ "$FORCEFUL" -eq 1 ] && [ "$ENTITY_KEY_PRESENT" -eq 1 ]; then
        ROTATION_ARCHIVE="$ENTITY_ID_DIR/archive/rotation-$(date +%Y%m%dT%H%M%S)"
        mkdir -p "$ROTATION_ARCHIVE"
        say "  --forceful: archiving existing SPEC-175 keys..."
        [ -f "$ENTITY_ID_DIR/entity.public.asc" ] && mv "$ENTITY_ID_DIR/entity.public.asc" "$ROTATION_ARCHIVE/"
        [ -d "$DEVICE_DIR" ] && mv "$DEVICE_DIR" "$ROTATION_ARCHIVE/device-$HOST" && mkdir -p "$DEVICE_DIR"
    fi

    # Step 3: Generate entity keypair + device leaf
    SOVEREIGN_DOMAIN=""
    [ -f "$SOVEREIGN_DIR/.env" ] && SOVEREIGN_DOMAIN=$(grep "^SOVEREIGN_DOMAIN=" "$SOVEREIGN_DIR/.env" 2>/dev/null | cut -d= -f2- || true)
    ENTITY_USERID="$ENTITY_NAME @ ${SOVEREIGN_DOMAIN:-kingdom}"

    say "Generating entity keypair and device leaf for '$ENTITY_NAME'..."

    CEREMONY_JSON=$(node "$CEREMONY_SCRIPT" generate-entity \
        --userid "$ENTITY_USERID") || die "Entity key generation ceremony failed"

    ENTITY_FINGERPRINT=$(echo "$CEREMONY_JSON" | jq -r '.entityFingerprint')
    ENTITY_PUBLIC_ARMOR=$(echo "$CEREMONY_JSON" | jq -r '.entityPublicArmor')
    LEAF_FINGERPRINT=$(echo "$CEREMONY_JSON" | jq -r '.leafFingerprint')
    LEAF_PUBLIC_ARMOR=$(echo "$CEREMONY_JSON" | jq -r '.leafPublicArmor')
    LEAF_PRIVATE_ARMOR=$(echo "$CEREMONY_JSON" | jq -r '.leafPrivateArmor')
    DEVICE_KEY=$(echo "$CEREMONY_JSON" | jq -r '.deviceKey')

    printf '%s' "$ENTITY_PUBLIC_ARMOR" > "$ENTITY_ID_DIR/entity.public.asc"
    printf '%s' "$ENTITY_FINGERPRINT"  > "$ENTITY_ID_DIR/entity.fingerprint"
    printf '%s' "$LEAF_PUBLIC_ARMOR"   > "$DEVICE_DIR/leaf.public.asc"
    printf '%s' "$LEAF_PRIVATE_ARMOR"  > "$DEVICE_DIR/leaf.private.asc"
    printf '%s' "$DEVICE_KEY"          > "$DEVICE_DIR/device.key"
    chmod 600 "$DEVICE_DIR/leaf.private.asc" "$DEVICE_DIR/device.key"

    say "  generated: id/entity.public.asc (fingerprint: ${ENTITY_FINGERPRINT: -16})"
    say "  generated: id/devices/$HOST/leaf.public.asc (fingerprint: ${LEAF_FINGERPRINT: -16})"
    say "  generated: id/devices/$HOST/leaf.private.asc (encrypted — passphrase is device.key)"
    say "  generated: id/devices/$HOST/device.key (gitignored — machine-local, never commit)"

    unset CEREMONY_JSON DEVICE_KEY LEAF_PRIVATE_ARMOR ENTITY_PUBLIC_ARMOR LEAF_PUBLIC_ARMOR

    # Step 3b: Sign sigchain entries
    say ""
    say "Signing sigchain entries..."
    sign_entity_sigchain_entries 0

    # Step 4: Write migration record
    [ ! -f "$ENTITY_ID_DIR/migrated-at" ] || [ "$FORCEFUL" -eq 1 ] && \
        printf '%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$ENTITY_ID_DIR/migrated-at"

    # Step 5: Archive legacy key files
    if [ "$HAS_LEGACY" -gt 0 ]; then
        LEGACY_ARCHIVE="$ENTITY_ID_DIR/archive/pre-175-migration"
        mkdir -p "$LEGACY_ARCHIVE"
        say "Archiving legacy key files..."
        for kf in "${LEGACY_KEYS[@]}"; do
            src="$ENTITY_ID_DIR/$kf"
            [ -f "$src" ] && mv "$src" "$LEGACY_ARCHIVE/$kf" && say "  archived: $kf"
        done
    fi

    # Step 6: Gitignore
    ensure_spec175_gitignore "$ENTITY_DIR/.gitignore"
    ensure_spec175_id_gitignore "$ENTITY_ID_DIR/.gitignore"

    # Step 7: Commit
    COMMIT_MSG="id: migrate to SPEC-175 multi-device shape"
    [ "$FORCEFUL" -eq 1 ] && COMMIT_MSG="id: rotate keys per SPEC-175 (--forceful, $HOST)"
    commit_entity_migration "$COMMIT_MSG"

elif [ "$ACTION" = "secondary-device" ]; then
    # -----------------------------------------------------------------------
    # State 7: entity.public.asc present but no leaf for this device
    # -----------------------------------------------------------------------

    say "Entity '$ENTITY_NAME' has entity.public.asc but no leaf for this device ($HOST)."
    say "Generating device leaf (secondary device adoption)..."
    say ""

    verify_sovereign_leaf

    mkdir -p "$DEVICE_DIR"

    SOVEREIGN_DOMAIN=""
    [ -f "$SOVEREIGN_DIR/.env" ] && SOVEREIGN_DOMAIN=$(grep "^SOVEREIGN_DOMAIN=" "$SOVEREIGN_DIR/.env" 2>/dev/null | cut -d= -f2- || true)
    ENTITY_USERID="$ENTITY_NAME @ ${SOVEREIGN_DOMAIN:-kingdom}"

    CEREMONY_JSON=$(node "$CEREMONY_SCRIPT" generate-entity \
        --userid "$ENTITY_USERID") || die "Entity leaf generation ceremony failed"

    LEAF_FINGERPRINT=$(echo "$CEREMONY_JSON" | jq -r '.leafFingerprint')
    LEAF_PUBLIC_ARMOR=$(echo "$CEREMONY_JSON" | jq -r '.leafPublicArmor')
    LEAF_PRIVATE_ARMOR=$(echo "$CEREMONY_JSON" | jq -r '.leafPrivateArmor')
    DEVICE_KEY=$(echo "$CEREMONY_JSON" | jq -r '.deviceKey')

    printf '%s' "$LEAF_PUBLIC_ARMOR"   > "$DEVICE_DIR/leaf.public.asc"
    printf '%s' "$LEAF_PRIVATE_ARMOR"  > "$DEVICE_DIR/leaf.private.asc"
    printf '%s' "$DEVICE_KEY"          > "$DEVICE_DIR/device.key"
    chmod 600 "$DEVICE_DIR/leaf.private.asc" "$DEVICE_DIR/device.key"

    say "  generated: id/devices/$HOST/leaf.public.asc (fingerprint: ${LEAF_FINGERPRINT: -16})"
    say "  generated: id/devices/$HOST/leaf.private.asc (encrypted — passphrase is device.key)"
    say "  generated: id/devices/$HOST/device.key (gitignored — machine-local, never commit)"

    unset CEREMONY_JSON DEVICE_KEY LEAF_PRIVATE_ARMOR LEAF_PUBLIC_ARMOR

    # Read entity fingerprint from disk (entity key already committed)
    ENTITY_FINGERPRINT=$(cat "$ENTITY_ID_DIR/entity.fingerprint" 2>/dev/null || true)

    # Sign leaf-authorize only (skip genesis — entity already gestated)
    say ""
    say "Signing koad.entity.leaf-authorize for $HOST..."
    sign_entity_sigchain_entries 1

    ensure_spec175_gitignore "$ENTITY_DIR/.gitignore"
    ensure_spec175_id_gitignore "$ENTITY_ID_DIR/.gitignore"
    commit_entity_migration "id: add device leaf for $HOST (SPEC-175 secondary device)"

elif [ "$ACTION" = "re-seed" ]; then
    # -----------------------------------------------------------------------
    # State 4/5: No key material at all (or partial SPEC-175 without leaf)
    # -----------------------------------------------------------------------

    say "Entity '$ENTITY_NAME' has no key material — re-seeding from scratch..."
    say "This generates a new entity keypair and device leaf for this machine."
    say ""

    verify_sovereign_leaf

    mkdir -p "$ENTITY_ID_DIR"
    mkdir -p "$DEVICE_DIR"

    SOVEREIGN_DOMAIN=""
    [ -f "$SOVEREIGN_DIR/.env" ] && SOVEREIGN_DOMAIN=$(grep "^SOVEREIGN_DOMAIN=" "$SOVEREIGN_DIR/.env" 2>/dev/null | cut -d= -f2- || true)
    ENTITY_USERID="$ENTITY_NAME @ ${SOVEREIGN_DOMAIN:-kingdom}"

    CEREMONY_JSON=$(node "$CEREMONY_SCRIPT" generate-entity \
        --userid "$ENTITY_USERID") || die "Entity key generation ceremony failed"

    ENTITY_FINGERPRINT=$(echo "$CEREMONY_JSON" | jq -r '.entityFingerprint')
    ENTITY_PUBLIC_ARMOR=$(echo "$CEREMONY_JSON" | jq -r '.entityPublicArmor')
    LEAF_FINGERPRINT=$(echo "$CEREMONY_JSON" | jq -r '.leafFingerprint')
    LEAF_PUBLIC_ARMOR=$(echo "$CEREMONY_JSON" | jq -r '.leafPublicArmor')
    LEAF_PRIVATE_ARMOR=$(echo "$CEREMONY_JSON" | jq -r '.leafPrivateArmor')
    DEVICE_KEY=$(echo "$CEREMONY_JSON" | jq -r '.deviceKey')

    printf '%s' "$ENTITY_PUBLIC_ARMOR" > "$ENTITY_ID_DIR/entity.public.asc"
    printf '%s' "$ENTITY_FINGERPRINT"  > "$ENTITY_ID_DIR/entity.fingerprint"
    printf '%s' "$LEAF_PUBLIC_ARMOR"   > "$DEVICE_DIR/leaf.public.asc"
    printf '%s' "$LEAF_PRIVATE_ARMOR"  > "$DEVICE_DIR/leaf.private.asc"
    printf '%s' "$DEVICE_KEY"          > "$DEVICE_DIR/device.key"
    chmod 600 "$DEVICE_DIR/leaf.private.asc" "$DEVICE_DIR/device.key"

    say "  generated: id/entity.public.asc (fingerprint: ${ENTITY_FINGERPRINT: -16})"
    say "  generated: id/devices/$HOST/leaf.public.asc (fingerprint: ${LEAF_FINGERPRINT: -16})"
    say "  generated: id/devices/$HOST/leaf.private.asc (encrypted)"
    say "  generated: id/devices/$HOST/device.key (gitignored)"

    unset CEREMONY_JSON DEVICE_KEY LEAF_PRIVATE_ARMOR ENTITY_PUBLIC_ARMOR LEAF_PUBLIC_ARMOR

    say ""
    say "Signing sigchain entries..."
    sign_entity_sigchain_entries 0

    printf '%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$ENTITY_ID_DIR/migrated-at"

    ensure_spec175_gitignore "$ENTITY_DIR/.gitignore"
    ensure_spec175_id_gitignore "$ENTITY_ID_DIR/.gitignore"
    commit_entity_migration "id: seed SPEC-175 entity keys for $ENTITY_NAME"

fi

# ---------------------------------------------------------------------------
# Common: .env scaffolding
# ---------------------------------------------------------------------------

if [ ! -f "$ENTITY_DIR/.env" ]; then
    SCAFFOLD_DOMAIN="${KOAD_IO_KINGDOM_DOMAIN:-koad.io}"
    SCAFFOLD_DISPLAY="$(echo "${ENTITY_NAME:0:1}" | tr '[:lower:]' '[:upper:]')${ENTITY_NAME:1}"

    say ".env missing — scaffolding from kingdom defaults"
    cat > "$ENTITY_DIR/.env" << ENVEOF
# SPDX-License-Identifier: AGPL-3.0-or-later
# Entity .env — scaffolded by koad-io init from kingdom defaults.
# Tune these for the specific entity; commit to entity repo if desired.

ENTITY=$ENTITY_NAME
ENTITY_DIR=\$HOME/.$ENTITY_NAME
ENTITY_HOME=\$HOME/.$ENTITY_NAME

GIT_AUTHOR_NAME=$SCAFFOLD_DISPLAY
GIT_AUTHOR_EMAIL=$ENTITY_NAME@$SCAFFOLD_DOMAIN
GIT_COMMITTER_NAME=$SCAFFOLD_DISPLAY
GIT_COMMITTER_EMAIL=$ENTITY_NAME@$SCAFFOLD_DOMAIN

KOAD_IO_EMIT=1
ENVEOF
    say "wrote: $ENTITY_DIR/.env"
fi

# ---------------------------------------------------------------------------
# Common: launcher at ~/.koad-io/bin/<entity>
# ---------------------------------------------------------------------------

LAUNCHER="$HOME/.koad-io/bin/$ENTITY_NAME"

if [ -f "$LAUNCHER" ] && [ "$FORCEFUL" -eq 0 ]; then
    say "Launcher $LAUNCHER — already present"
else
    say "Writing launcher: $LAUNCHER"
    printf '#!/usr/bin/env bash\n\nexport ENTITY="%s"\nexport KOAD_IO_VIA_LAUNCHER=1\nkoad-io "$@";\n' "$ENTITY_NAME" > "$LAUNCHER"
    chmod +x "$LAUNCHER"
    say "wrote: $LAUNCHER"
fi

# ---------------------------------------------------------------------------
# Common: AGENTS.md — context cascade for harness consumption
# ---------------------------------------------------------------------------

KOAD_IO_LIGHTHOUSE="$HOME/.koad-io/KOAD_IO.md"
ENTITY_IDENTITY="$ENTITY_DIR/ENTITY.md"
ENTITY_PRIMER="$ENTITY_DIR/PRIMER.md"
AGENTS_MD="$ENTITY_DIR/AGENTS.md"

if [ -f "$KOAD_IO_LIGHTHOUSE" ] || [ -f "$ENTITY_IDENTITY" ]; then
    say "Generating AGENTS.md (opencode + harness-agnostic context floor)"
    {
        echo "<!-- AGENTS.md — auto-generated by koad-io init. Do not edit by hand. -->"
        echo "<!-- Sources: KOAD_IO.md (kingdom) → ENTITY.md (identity) → PRIMER.md (location) -->"
        echo
        if [ -f "$KOAD_IO_LIGHTHOUSE" ]; then
            cat "$KOAD_IO_LIGHTHOUSE"
            echo
            echo "---"
            echo
        fi
        if [ -f "$ENTITY_IDENTITY" ]; then
            cat "$ENTITY_IDENTITY"
            echo
            echo "---"
            echo
        fi
        if [ -f "$ENTITY_PRIMER" ]; then
            cat "$ENTITY_PRIMER"
        fi
    } > "$AGENTS_MD"
    say "wrote: $AGENTS_MD ($(wc -c < "$AGENTS_MD") bytes)"
fi

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------

say ""
say "================================================================================"
say " Init complete: $ENTITY_NAME"
say "================================================================================"
say ""
say " Entity dir: $ENTITY_DIR"
say " Launcher:   $LAUNCHER"
say " Device:     $HOST"
say ""

if [ "$ACTION" = "migrate" ] || [ "$ACTION" = "re-seed" ] || [ "$ACTION" = "secondary-device" ]; then
    say " Next steps:"
    say "   git -C $ENTITY_DIR push"
    say ""
fi

source "$HOME/.koad-io/helpers/discovery.sh" 2>/dev/null && _koad_io_hint
