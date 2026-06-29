#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# koad-io gestate <name> — create a new entity using the SPEC-175 sovereign-signed model
#
# Usage:
#   koad-io gestate <name>
#
# Pre-conditions:
#   - ~/.koad-io/me/ must exist (run 'koad-io init sovereign' first)
#   - Sovereign device leaf must exist at ~/.koad-io/me/id/devices/$HOSTNAME/leaf.private.asc
#   - ~/.<name>/ must NOT already exist
#
# What this does:
#   1. Validates pre-flight conditions (sovereign, name, no existing dir)
#   2. Asks conversational questions (display name, domain, home machine, role, mother)
#   3. Creates entity dir with SPEC-175 id/ layout
#   4. Generates entity public keypair + first device leaf via ceremony.mjs
#   5. Signs koad.entity.genesis + koad.entity.leaf-authorize in sovereign's sigchain
#   6. Writes entity artifacts (.env, .gitignore, KOAD_IO_VERSION, passenger.json, CLAUDE.md, ENTITY.md stub, memory stub)
#   7. Initializes git repo and creates genesis commit (authored as the new entity)
#   8. Registers entity launcher via 'koad-io init <name>'
#   9. Prints genesis confirmation
#
# Ref: VESTA-SPEC-002 v1.3 — canonical gestation protocol
# Ref: VESTA-SPEC-175 §7 — sovereign-signed entity key flow
# Ref: VESTA-SPEC-001 v1.8 — canonical entity model and id/ layout

set -euo pipefail

source "$HOME/.koad-io/helpers/ask.sh"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

say()  { echo "[gestate] $*"; }
warn() { echo "[gestate] WARNING: $*" >&2; }
die()  { echo "[gestate] ERROR: $*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# Pre-flight: entity name argument
# ---------------------------------------------------------------------------

ENTITY_NAME="${1:-}"

if [ -z "$ENTITY_NAME" ]; then
    die "Usage: koad-io gestate <name>"
fi

# Reject flag-shaped args as name
if [[ "$ENTITY_NAME" == --* ]]; then
    die "Usage: koad-io gestate <name>"
fi

# Reserved name check
if [ "$ENTITY_NAME" = "me" ]; then
    die "'me' is reserved — ~/.koad-io/me/ is the sovereign. Use another name."
fi

# Name format: lowercase, 3-12 chars, no hyphens/underscores/specials (SPEC-002 §2)
if ! [[ "$ENTITY_NAME" =~ ^[a-z]{3,12}$ ]]; then
    die "Entity name must be 3-12 lowercase letters with no hyphens, underscores, or digits. Got: '$ENTITY_NAME'"
fi

ENTITY_DIR="$HOME/.${ENTITY_NAME}"

# ---------------------------------------------------------------------------
# Pre-flight: entity dir must not already exist
# ---------------------------------------------------------------------------

if [ -d "$ENTITY_DIR" ]; then
    die "Entity dir $ENTITY_DIR already exists. Use 'koad-io migrate-entity $ENTITY_NAME' for existing entities, or remove the dir first."
fi

# ---------------------------------------------------------------------------
# Pre-flight: sovereign must exist
# ---------------------------------------------------------------------------

SOVEREIGN_DIR="$HOME/.koad-io/me"
SOVEREIGN_ID_DIR="$SOVEREIGN_DIR/id"

if [ ! -d "$SOVEREIGN_DIR" ]; then
    die "No sovereign found at $SOVEREIGN_DIR. Run 'koad-io init sovereign' first."
fi

if [ ! -f "$SOVEREIGN_ID_DIR/gpg.public.asc" ] && [ ! -f "$SOVEREIGN_ID_DIR/entity.public.asc" ]; then
    die "Sovereign exists but has no master public key. Run 'koad-io init sovereign' first."
fi

MASTER_FINGERPRINT_FILE="$SOVEREIGN_ID_DIR/master.fingerprint"
if [ ! -f "$MASTER_FINGERPRINT_FILE" ]; then
    die "Sovereign id/master.fingerprint is missing. Run 'koad-io init sovereign' to repair."
fi

# ---------------------------------------------------------------------------
# Pre-flight: sovereign device leaf must exist on this machine
# ---------------------------------------------------------------------------

HOST=$(hostname -s)
SOVEREIGN_LEAF_DIR="$SOVEREIGN_ID_DIR/devices/$HOST"
SOVEREIGN_LEAF_PRIVATE="$SOVEREIGN_LEAF_DIR/leaf.private.asc"
SOVEREIGN_DEVICE_KEY="$SOVEREIGN_LEAF_DIR/device.key"

if [ ! -f "$SOVEREIGN_LEAF_PRIVATE" ]; then
    die "Sovereign device leaf not found at $SOVEREIGN_LEAF_PRIVATE. Run 'koad-io init sovereign' to provision this device's leaf."
fi

if [ ! -f "$SOVEREIGN_DEVICE_KEY" ]; then
    die "Sovereign device key not found at $SOVEREIGN_DEVICE_KEY. Run 'koad-io init sovereign' to provision this device's leaf."
fi

# Check for required tooling
command -v jq   >/dev/null 2>&1 || die "jq is required but not found — install it and retry"
command -v node >/dev/null 2>&1 || die "node is required (Node.js >= 18) — install it and retry"

CEREMONY_SCRIPT="$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/ceremony.mjs"

if [ ! -f "$CEREMONY_SCRIPT" ]; then
    die "Ceremony script not found at $CEREMONY_SCRIPT"
fi

# ---------------------------------------------------------------------------
# Conversational questions
# ---------------------------------------------------------------------------

say ""
say "Gestating new entity: $ENTITY_NAME"
say ""

# Read sovereign env for defaults
SOVEREIGN_DOMAIN=""
SOVEREIGN_HANDLE=""
if [ -f "$SOVEREIGN_DIR/.env" ]; then
    SOVEREIGN_DOMAIN=$(grep "^SOVEREIGN_DOMAIN=" "$SOVEREIGN_DIR/.env" 2>/dev/null | cut -d= -f2- | tr -d '"' || true)
    SOVEREIGN_HANDLE=$(grep "^SOVEREIGN_HANDLE=" "$SOVEREIGN_DIR/.env" 2>/dev/null | cut -d= -f2- | tr -d '"' || true)
fi

# Default display name: capitalized entity name
DEFAULT_DISPLAY_NAME="$(echo "${ENTITY_NAME:0:1}" | tr '[:lower:]' '[:upper:]')${ENTITY_NAME:1}"

# Mother: if running from entity context, default to that
DEFAULT_MOTHER="${ENTITY:-}"

DISPLAY_NAME=$(ask "Display name" "${KOAD_IO_DISPLAY_NAME:-}" "$DEFAULT_DISPLAY_NAME")
EMAIL_DOMAIN=$(ask "Email domain" "${KOAD_IO_EMAIL_DOMAIN:-}" "${SOVEREIGN_DOMAIN:-kingofalldata.com}")
HOME_MACHINE=$(ask "Home machine (hostname)" "${KOAD_IO_HOME_MACHINE:-}" "$HOST")
ROLE=$(ask "Role (short description of what this entity does)" "${KOAD_IO_ROLE:-}" "")
MOTHER=$(ask "Mother entity" "${KOAD_IO_MOTHER_ENTITY:-${ENTITY:-}}" "$DEFAULT_MOTHER")

say ""
say "  Entity:        $ENTITY_NAME"
say "  Display name:  $DISPLAY_NAME"
say "  Email:         ${ENTITY_NAME}@${EMAIL_DOMAIN}"
say "  Home machine:  $HOME_MACHINE"
[ -n "$ROLE" ] && say "  Role:          $ROLE"
[ -n "$MOTHER" ] && say "  Mother:        $MOTHER"
say ""

# ---------------------------------------------------------------------------
# Step 1: Verify sovereign device leaf is decryptable
# ---------------------------------------------------------------------------

say "Verifying sovereign device leaf..."

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
say ""

# ---------------------------------------------------------------------------
# Step 2: Create entity directory structure (SPEC-002 §4 Step 1 + SPEC-175 §3.1)
# ---------------------------------------------------------------------------

say "Creating entity directory structure..."

mkdir -p "$ENTITY_DIR/id/devices/$HOST"
chmod 700 "$ENTITY_DIR/id"
mkdir -p "$ENTITY_DIR/trust/bonds"
mkdir -p "$ENTITY_DIR/memories"
mkdir -p "$ENTITY_DIR/specs"
mkdir -p "$ENTITY_DIR/projects"
mkdir -p "$ENTITY_DIR/commands"
mkdir -p "$ENTITY_DIR/hooks"

say "  created: $ENTITY_DIR"

# Cleanup on failure from here on
_gestate_cleanup() {
    local code=$?
    if [ $code -ne 0 ] && [ -d "$ENTITY_DIR" ]; then
        warn "Gestation failed — removing partial entity dir $ENTITY_DIR"
        rm -rf "$ENTITY_DIR"
    fi
}
trap _gestate_cleanup EXIT

# ---------------------------------------------------------------------------
# Step 3: Generate entity keypair + device leaf via ceremony
# ---------------------------------------------------------------------------

ENTITY_USERID="$DISPLAY_NAME <${ENTITY_NAME}@${EMAIL_DOMAIN}>"

say "Generating entity keypair and device leaf..."
say "  Entity userid: $ENTITY_USERID"

CEREMONY_JSON=$(node "$CEREMONY_SCRIPT" generate-entity \
    --userid "$ENTITY_USERID") || die "Entity key generation ceremony failed"

ENTITY_FINGERPRINT=$(echo "$CEREMONY_JSON" | jq -r '.entityFingerprint')
ENTITY_PUBLIC_ARMOR=$(echo "$CEREMONY_JSON" | jq -r '.entityPublicArmor')
LEAF_FINGERPRINT=$(echo "$CEREMONY_JSON" | jq -r '.leafFingerprint')
LEAF_PUBLIC_ARMOR=$(echo "$CEREMONY_JSON" | jq -r '.leafPublicArmor')
LEAF_PRIVATE_ARMOR=$(echo "$CEREMONY_JSON" | jq -r '.leafPrivateArmor')
DEVICE_KEY=$(echo "$CEREMONY_JSON" | jq -r '.deviceKey')

# Write entity public key (committed — the entity's durable public identity)
printf '%s' "$ENTITY_PUBLIC_ARMOR" > "$ENTITY_DIR/id/entity.public.asc"
printf '%s' "$ENTITY_FINGERPRINT"  > "$ENTITY_DIR/id/entity.fingerprint"
chmod 644 "$ENTITY_DIR/id/entity.public.asc"
chmod 644 "$ENTITY_DIR/id/entity.fingerprint"

# Write device leaf (public: committed; private + device.key: gitignored)
DEVICE_LEAF_DIR="$ENTITY_DIR/id/devices/$HOST"
printf '%s' "$LEAF_PUBLIC_ARMOR"  > "$DEVICE_LEAF_DIR/leaf.public.asc"
printf '%s' "$LEAF_PRIVATE_ARMOR" > "$DEVICE_LEAF_DIR/leaf.private.asc"
printf '%s' "$DEVICE_KEY"         > "$DEVICE_LEAF_DIR/device.key"
chmod 644 "$DEVICE_LEAF_DIR/leaf.public.asc"
chmod 600 "$DEVICE_LEAF_DIR/leaf.private.asc"
chmod 600 "$DEVICE_LEAF_DIR/device.key"

say "  generated: id/entity.public.asc (fingerprint: ${ENTITY_FINGERPRINT: -16})"
say "  generated: id/devices/$HOST/leaf.public.asc (fingerprint: ${LEAF_FINGERPRINT: -16})"
say "  generated: id/devices/$HOST/leaf.private.asc (encrypted — passphrase is device.key)"
say "  generated: id/devices/$HOST/device.key (gitignored — never commit)"

# Zero sensitive vars
unset CEREMONY_JSON DEVICE_KEY LEAF_PRIVATE_ARMOR

say ""

# ---------------------------------------------------------------------------
# Step 4: Sign sigchain entries in sovereign's chain
# ---------------------------------------------------------------------------

SOVEREIGN_SIGCHAIN_DIR="$SOVEREIGN_DIR/sigchain"
SOVEREIGN_SIGCHAIN_HEAD_FILE="$SOVEREIGN_SIGCHAIN_DIR/head.cid"
SOVEREIGN_SIGCHAIN_META_FILE="$SOVEREIGN_SIGCHAIN_DIR/metadata.json"
SOVEREIGN_SIGCHAIN_ENTRIES_DIR="$SOVEREIGN_SIGCHAIN_DIR/entries"

CURRENT_HEAD=""
if [ -f "$SOVEREIGN_SIGCHAIN_HEAD_FILE" ]; then
    CURRENT_HEAD=$(cat "$SOVEREIGN_SIGCHAIN_HEAD_FILE" | tr -d '[:space:]')
fi

EXPECTED_MASTER_FPR=$(cat "$MASTER_FINGERPRINT_FILE")

say "Signing sigchain entries in sovereign's chain (using device leaf)..."
say "  Current sovereign chain head: ${CURRENT_HEAD:-'(none — first entity entry)'}"
say "  Signing leaf: ${SOVEREIGN_LEAF_FINGERPRINT: -16}"

# Pass entity public armor via a temp file to avoid argv quoting issues
ENTITY_ARMOR_TMPFILE=$(mktemp /tmp/koad-entity-armor.XXXXXX)
cp "$ENTITY_DIR/id/entity.public.asc" "$ENTITY_ARMOR_TMPFILE"

ENTITY_SIGNING_JSON=$(node "$CEREMONY_SCRIPT" sign-entity-entries \
    --sovereign-leaf-encrypted-path "$SOVEREIGN_LEAF_PRIVATE" \
    --sovereign-device-key-path "$SOVEREIGN_DEVICE_KEY" \
    --sovereign-leaf-fingerprint "$SOVEREIGN_LEAF_FINGERPRINT" \
    --entity-handle "$ENTITY_NAME" \
    --entity-fingerprint "$ENTITY_FINGERPRINT" \
    --entity-public-armor "$(cat "$ENTITY_ARMOR_TMPFILE")" \
    --leaf-fingerprint "$LEAF_FINGERPRINT" \
    --host "$HOST" \
    --sigchain-head "$CURRENT_HEAD") \
    || { rm -f "$ENTITY_ARMOR_TMPFILE"; die "Sigchain signing ceremony failed"; }

rm -f "$ENTITY_ARMOR_TMPFILE"

GENESIS_CID=$(echo "$ENTITY_SIGNING_JSON" | jq -r '.genesisCid')
LEAF_CID=$(echo "$ENTITY_SIGNING_JSON" | jq -r '.leafCid')
NEW_HEAD_CID=$(echo "$ENTITY_SIGNING_JSON" | jq -r '.newHeadCid')

if [ -z "$GENESIS_CID" ] || [ "$GENESIS_CID" = "null" ]; then
    die "Sigchain signing returned no genesisCid — check ceremony output"
fi
if [ -z "$LEAF_CID" ] || [ "$LEAF_CID" = "null" ]; then
    die "Sigchain signing returned no leafCid — check ceremony output"
fi

# Write entries to sovereign's sigchain (append-only)
mkdir -p "$SOVEREIGN_SIGCHAIN_ENTRIES_DIR"

echo "$ENTITY_SIGNING_JSON" | jq '.genesisEntry' > "$SOVEREIGN_SIGCHAIN_ENTRIES_DIR/$GENESIS_CID.json"
echo "$ENTITY_SIGNING_JSON" | jq '.leafEntry'    > "$SOVEREIGN_SIGCHAIN_ENTRIES_DIR/$LEAF_CID.json"

# Update head pointer
printf '%s' "$NEW_HEAD_CID" > "$SOVEREIGN_SIGCHAIN_HEAD_FILE"

# Update metadata.json
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

say "  signed: koad.entity.genesis (CID: ${GENESIS_CID:0:20}...)"
say "  signed: koad.entity.leaf-authorize (CID: ${LEAF_CID:0:20}...)"
say "  updated: me/sigchain/head.cid → ${NEW_HEAD_CID:0:20}..."

unset ENTITY_SIGNING_JSON

say ""

# ---------------------------------------------------------------------------
# Step 5: Mother gene cloning (SPEC-002 §4 — informational; non-key dirs only)
# ---------------------------------------------------------------------------
# Mother is informational for identity purposes. Non-key directory genes
# (skeletons, packages, commands, etc.) are still cloned if mother is set
# and the directories exist. This preserves the legacy usefulness while not
# copying key material across entities.

if [ -n "$MOTHER" ] && [ -d "$HOME/.$MOTHER" ]; then
    say "Cloning genes from mother '$MOTHER' (non-key dirs only)..."
    for gene_dir in skeletons packages commands recipes assets cheats hooks docs; do
        if [ -d "$HOME/.$MOTHER/$gene_dir" ]; then
            cp -r "$HOME/.$MOTHER/$gene_dir" "$ENTITY_DIR/"
            say "  cloned: $gene_dir from $MOTHER"
        fi
    done
    say ""
fi

# ---------------------------------------------------------------------------
# Step 6: Write entity artifacts
# ---------------------------------------------------------------------------

say "Writing entity artifacts..."

# --- .gitignore (SPEC-175 patterns) ---
cat > "$ENTITY_DIR/.gitignore" << GITIGNORE
# SPDX-License-Identifier: AGPL-3.0-or-later
# Private key material — NEVER commit (SPEC-175)
id/devices/*/leaf.private.asc
id/devices/*/device.key

# Legacy private keys (pre-SPEC-175 — included for backward compat)
id/ed25519
id/ecdsa
id/rsa
id/dsa
id/gpg-revocation.asc
keyring/
ssl/master-curve.pem
ssl/device-curve.pem
ssl/relay-curve.pem
ssl/session.pem

# Entity config — local secrets / env
.env
.credentials
.env.local
.env.*.local

# Runtime state
.cache/
.logs/
.queue/
.tmp/
.pid
proc/
var/

# Editor temp files
*~
*.swp
*.swo
.DS_Store
.vscode/

# Dependencies / build artifacts
node_modules/
__pycache__/
*.log
GITIGNORE

# --- id/.gitignore (defensive layer) ---
cat > "$ENTITY_DIR/id/.gitignore" << 'GITIGNORE'
# SPDX-License-Identifier: AGPL-3.0-or-later
# id/.gitignore — SPEC-175 multi-device shape
# Private material — never commit
devices/*/leaf.private.asc
devices/*/device.key
# Keep public material committed
!devices/*/leaf.public.asc
!entity.public.asc
!entity.fingerprint
!archive/**
!.gitignore
GITIGNORE

say "  wrote: .gitignore"
say "  wrote: id/.gitignore"

# --- KOAD_IO_VERSION ---
cat > "$ENTITY_DIR/KOAD_IO_VERSION" << VERSIONEOF
# koad:io entity — gestation record (SPEC-002 v1.3)

GESTATED_BY=vulcan
GESTATE_VERSION=$(cd "$HOME/.koad-io" && git rev-parse --short HEAD 2>/dev/null || echo "unknown")
BIRTHDAY=$(date +%y:%m:%d:%H:%M:%S)
NAME=$ENTITY_NAME
VERSIONEOF

say "  wrote: KOAD_IO_VERSION"

# --- .env ---
NOW_ISO_ENV=$(date -u +%Y-%m-%dT%H:%M:%SZ)
cat > "$ENTITY_DIR/.env" << ENVEOF
# SPDX-License-Identifier: AGPL-3.0-or-later
# Entity .env — auto-generated by koad-io gestate (SPEC-002 v1.3)
# This file is gitignored. It contains entity identity config for this machine.

# Entity Identity
ENTITY=$ENTITY_NAME
ENTITY_DIR=$ENTITY_DIR
ENTITY_HOME=$ENTITY_DIR

# Git Identity
GIT_AUTHOR_NAME=$DISPLAY_NAME
GIT_AUTHOR_EMAIL=${ENTITY_NAME}@${EMAIL_DOMAIN}
GIT_COMMITTER_NAME=$DISPLAY_NAME
GIT_COMMITTER_EMAIL=${ENTITY_NAME}@${EMAIL_DOMAIN}

# Creator & relationships
CREATOR=vulcan
MOTHER=${MOTHER:-juno}

# Home machine
KOAD_IO_HOME_MACHINE=$HOME_MACHINE

# Role
ROLE=${ROLE:-}

# Framework
KOAD_IO_EMIT=1
KOAD_IO_QUIET=0

# Gestated
GESTATED_AT=$NOW_ISO_ENV
ENVEOF

say "  wrote: .env"

# --- passenger.json ---
NOW_ISO_JSON=$(date -u +%Y-%m-%dT%H:%M:%SZ)
jq -n \
    --arg handle "$ENTITY_NAME" \
    --arg name "$DISPLAY_NAME" \
    --arg role "${ROLE:-}" \
    --arg created "$NOW_ISO_JSON" \
    '{
        handle: $handle,
        name: $name,
        role: $role,
        status: "gestated",
        created_at: $created,
        created_by: "vulcan",
        avatar: null,
        buttons: []
    }' > "$ENTITY_DIR/passenger.json"

say "  wrote: passenger.json"

# --- CLAUDE.md ---
cat > "$ENTITY_DIR/CLAUDE.md" << CLAUDEEOF
# CLAUDE.md — $DISPLAY_NAME

This file provides guidance to Claude Code when working in \`$ENTITY_DIR/\`.

## What I Am

I am $DISPLAY_NAME — ${ROLE:-[role not yet defined]}.

## Key Files

- \`CLAUDE.md\` — This file (runtime instructions)
- \`ENTITY.md\` — Canonical identity, role, scope
- \`PRIMER.md\` — Session orientation (current state, active work)
- \`.env\` — Environment variables (gitignored; source for local config)
- \`passenger.json\` — Entity metadata
- \`trust/bonds/\` — Authorization documents
- \`id/\` — Cryptographic identity (SPEC-175 multi-device shape)
- \`memories/\` — Persistent context across sessions

## Git Identity

\`\`\`
ENTITY=$ENTITY_NAME
GIT_AUTHOR_NAME=$DISPLAY_NAME
GIT_AUTHOR_EMAIL=${ENTITY_NAME}@${EMAIL_DOMAIN}
\`\`\`

## Session Start

1. \`git pull\` — sync with remote
2. Read \`PRIMER.md\` for current state
3. Read \`memories/\` for relevant context
4. Check open GitHub Issues — what priority work is pending?
5. Proceed with highest-priority open work
6. Report progress via issue comments and commits
CLAUDEEOF

say "  wrote: CLAUDE.md"

# --- ENTITY.md stub ---
cat > "$ENTITY_DIR/ENTITY.md" << ENTITYEOF
# $DISPLAY_NAME

${ROLE:-[role not yet defined]}

<!-- Author the full ENTITY.md here on first flight:
     - Personality, operational philosophy
     - Role, team, authority chain, scope
     - Trust bonds, relationships
     - What you own and are accountable for
     Reference: ~/.juno/ENTITY.md, ~/.vulcan/ENTITY.md -->
ENTITYEOF

say "  wrote: ENTITY.md (stub — complete on first flight)"

# --- memories/001-identity.md stub (SPEC-002 §4 Step 11) ---
GESTATED_ISO=$(date -u +%Y-%m-%dT%H:%M:%SZ)
cat > "$ENTITY_DIR/memories/001-identity.md" << MEMEOF
---
name: $ENTITY_NAME identity
description: Core identity and self-knowledge
type: user
status: stub
gestated: $GESTATED_ISO
first_flight_required: true
---

# $DISPLAY_NAME Identity — STUB

**This file is a gestation scaffold.** $DISPLAY_NAME must replace it with a
first-person, entity-authored identity memory on first dispatch.
See VESTA-SPEC-002 §7 (First-Flight Obligations).

**Name:** $DISPLAY_NAME
**Role:** ${ROLE:-[not yet defined]}
**Gestated:** $GESTATED_ISO

## TODO (first-flight obligation)

On first dispatch, replace this stub with a full first-person identity memory:
- Who I am, in my own voice
- What I own (protocol areas, systems, responsibilities)
- Key relationships (creator, mother, peers)
- How I work (operational rhythm)
- Infrastructure context (if applicable)

Reference shape: \`~/.vesta/memories/001-identity.md\`, \`~/.juno/memories/001-identity.md\`
MEMEOF

say "  wrote: memories/001-identity.md (stub — entity replaces on first flight)"
say ""

# ---------------------------------------------------------------------------
# Step 7: Initialize git repo + genesis commit (authored as the new entity)
# ---------------------------------------------------------------------------

say "Initializing git repository..."

git -C "$ENTITY_DIR" init --initial-branch=main -q 2>/dev/null || git -C "$ENTITY_DIR" init -q

# Stage everything (gitignore protects private keys)
git -C "$ENTITY_DIR" add .

# Verify private keys are not staged
if git -C "$ENTITY_DIR" ls-files | grep -qE "leaf\.private\.asc|device\.key|\.env$"; then
    die "Private key material or .env was staged — check .gitignore. Aborting."
fi

# Create genesis commit authored as the new entity
GENESIS_COMMIT_MSG="kingdom genesis — entity created and signed by sovereign on $HOST

Gestated by Vulcan per VESTA-SPEC-002 v1.3.
Sovereign-signed per VESTA-SPEC-175 §7.

Entity:         $ENTITY_NAME
Display name:   $DISPLAY_NAME
Home machine:   $HOME_MACHINE
Entity fingerprint: $ENTITY_FINGERPRINT
Leaf fingerprint:   $LEAF_FINGERPRINT
Genesis CID:    $GENESIS_CID
Leaf CID:       $LEAF_CID"

GIT_AUTHOR_NAME="$DISPLAY_NAME" \
GIT_AUTHOR_EMAIL="${ENTITY_NAME}@${EMAIL_DOMAIN}" \
GIT_COMMITTER_NAME="$DISPLAY_NAME" \
GIT_COMMITTER_EMAIL="${ENTITY_NAME}@${EMAIL_DOMAIN}" \
    git -C "$ENTITY_DIR" commit -m "$GENESIS_COMMIT_MSG" -q

GENESIS_SHA=$(git -C "$ENTITY_DIR" rev-parse --short HEAD)
say "  initialized: git repo with genesis commit $GENESIS_SHA"
say "  authored as: $DISPLAY_NAME <${ENTITY_NAME}@${EMAIL_DOMAIN}>"
say ""

# Remove the cleanup trap now that gestation succeeded
trap - EXIT

# ---------------------------------------------------------------------------
# Step 8: Register entity launcher via koad-io init
# ---------------------------------------------------------------------------

say "Registering entity launcher..."

koad-io init "$ENTITY_NAME" --forceful 2>/dev/null || warn "koad-io init $ENTITY_NAME failed — register manually with: koad-io init $ENTITY_NAME"

say "  registered: ~/.koad-io/bin/$ENTITY_NAME"
say ""

# ---------------------------------------------------------------------------
# Step 9: Genesis confirmation
# ---------------------------------------------------------------------------

say "================================================================================"
say " Genesis complete: $ENTITY_NAME"
say "================================================================================"
say ""
say " Entity dir:         $ENTITY_DIR"
say " Entity public key:  $ENTITY_DIR/id/entity.public.asc"
say "   fingerprint:      $ENTITY_FINGERPRINT"
say " Device leaf:        $ENTITY_DIR/id/devices/$HOST/leaf.public.asc"
say "   fingerprint:      $LEAF_FINGERPRINT"
say " Device key:         $ENTITY_DIR/id/devices/$HOST/device.key (gitignored)"
say ""
say " Sovereign sigchain:"
say "   koad.entity.genesis:       $GENESIS_CID"
say "   koad.entity.leaf-authorize: $LEAF_CID"
say ""
say " Genesis commit: $GENESIS_SHA"
say " Launcher: ~/.koad-io/bin/$ENTITY_NAME"
say ""
say " Next steps:"
say "   1. git -C $ENTITY_DIR remote add origin <remote-url>"
say "   2. git -C $ENTITY_DIR push -u origin main"
say "   3. Dispatch $DISPLAY_NAME for first-flight obligations (SPEC-002 §7):"
say "      - Author ENTITY.md in $DISPLAY_NAME's own voice"
say "      - Author PRIMER.md with current state"
say "      - Replace memories/001-identity.md stub with canonical identity"
say ""

source "$HOME/.koad-io/helpers/discovery.sh" 2>/dev/null && _koad_io_hint
