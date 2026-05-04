#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# koad-io init sovereign — kingdom genesis command
#
# Usage:
#   koad-io init sovereign              # New sovereign — kingdom genesis (idempotent)
#   koad-io init sovereign <repo-url>   # Existing sovereign on new machine
#
# Ref: VESTA-SPEC-174 §4 — koad-io init sovereign command contract
#
# Idempotent: run it 10 times and it converges on the correct shape every time.
# Each step checks before acting — skips what exists, builds what's missing.

set -euo pipefail

source "$HOME/.koad-io/helpers/ask.sh"

SOVEREIGN_DIR="$HOME/.koad-io/me"
REPO_URL="${1:-}"
FORCEFUL=0
[[ "${*}" == *"--forceful"* ]] && FORCEFUL=1

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

say() { echo "[sovereign] $*"; }
die() { echo "[sovereign] ERROR: $*" >&2; exit 1; }

# Check-then-act helper: reports what happened
# ensure_file_missing_then_write FILE LABEL ACTION_FN
# Used to wrap generation steps with skip/generate output.
skip() { say "$1 — already present, skipping"; }
did()  { say "$1 — missing, $2"; }

# Ensure a line of the form KEY=VALUE exists in an .env file.
# Appends if missing; does NOT overwrite existing values (user may have edited them).
ensure_env_line() {
    local envfile="$1"
    local key="$2"
    local value="$3"
    if grep -q "^${key}=" "$envfile" 2>/dev/null; then
        return 0  # already present
    fi
    echo "${key}=${value}" >> "$envfile"
}

# ---------------------------------------------------------------------------
# PATH 2 — Existing sovereign (repo-url provided)
# ---------------------------------------------------------------------------

if [ -n "$REPO_URL" ] && [[ "$REPO_URL" != --* ]]; then

    say "Existing sovereign path — cloning identity from $REPO_URL"

    if [ -d "$SOVEREIGN_DIR" ]; then
        if [ "$FORCEFUL" -eq 1 ]; then
            say "--forceful: removing existing $SOVEREIGN_DIR"
            rm -rf "$SOVEREIGN_DIR"
        else
            die "$SOVEREIGN_DIR exists — cannot clone into it without --forceful"
        fi
    fi

    git clone "$REPO_URL" "$SOVEREIGN_DIR" || die "Clone failed: $REPO_URL"

    # Verify it looks like a sovereign identity repo
    if [ ! -f "$SOVEREIGN_DIR/passenger.json" ]; then
        die "Cloned repo does not contain passenger.json — is this a sovereign identity repo?"
    fi

    SOVEREIGN_TYPE=$(grep -o '"type"[[:space:]]*:[[:space:]]*"[^"]*"' "$SOVEREIGN_DIR/passenger.json" 2>/dev/null | grep -o '"[^"]*"$' | tr -d '"' || echo "")
    if [ "$SOVEREIGN_TYPE" != "sovereign" ]; then
        say "WARNING: passenger.json type is '$SOVEREIGN_TYPE', expected 'sovereign'. Proceeding anyway."
    fi

    # Generate fresh device key for this machine
    DEVICE_KEY_DIR="$SOVEREIGN_DIR/id"
    mkdir -p "$DEVICE_KEY_DIR"
    DEVICE_KEY_PATH="$DEVICE_KEY_DIR/device.key"

    say "Generating fresh device key for $HOSTNAME"
    ssh-keygen -t ed25519 -f "$DEVICE_KEY_PATH" -C "sovereign@$HOSTNAME" -N "" 2>/dev/null
    DEVICE_PUBKEY=$(cat "${DEVICE_KEY_PATH}.pub")

    # Ensure device.key is gitignored within me/
    INNER_GITIGNORE="$SOVEREIGN_DIR/.gitignore"
    if [ ! -f "$INNER_GITIGNORE" ] || ! grep -q "device.key" "$INNER_GITIGNORE" 2>/dev/null; then
        echo "device.key" >> "$INNER_GITIGNORE"
        echo "${DEVICE_KEY_PATH##*/}.pub" >> "$INNER_GITIGNORE" 2>/dev/null || true
    fi

    say ""
    say "Device key generated for sovereign@$HOSTNAME"
    say ""
    say "Public key fingerprint:"
    say "  $DEVICE_PUBKEY"
    say ""
    say "To authorize this device, run on an already-authorized device:"
    say ""
    say "    koad profile device-key add \\"
    say "        --device-id $HOSTNAME \\"
    say "        --device-pubkey \"$DEVICE_PUBKEY\" \\"
    say "        --description \"Fresh install on $HOSTNAME\""
    say ""
    say "Until this device is authorized, it can read but not sign on behalf of the sovereign."
    say ""
    say "Identity cloned. Your kingdom is available on this machine."

    source "$HOME/.koad-io/helpers/discovery.sh" 2>/dev/null && _koad_io_hint
    exit 0
fi

# ---------------------------------------------------------------------------
# PATH 1 — New sovereign (no repo-url) — kingdom genesis (idempotent)
# ---------------------------------------------------------------------------

say "Sovereign genesis — check-then-build each component"
say ""

# ---------------------------------------------------------------------------
# Directory structure — mkdir -p is already idempotent
# ---------------------------------------------------------------------------

mkdir -p "$SOVEREIGN_DIR/id/ssl"
mkdir -p "$SOVEREIGN_DIR/trust/bonds"
mkdir -p "$SOVEREIGN_DIR/memories"
say "directory structure — present"

# ---------------------------------------------------------------------------
# .gitignore — generated file, always overwrite (not user-edited)
# ---------------------------------------------------------------------------

cat > "$SOVEREIGN_DIR/.gitignore" << 'GITIGNORE'
# SPDX-License-Identifier: AGPL-3.0-or-later
# ~/.koad-io/me/.gitignore
# Controls which files in the sovereign identity repo are tracked vs local-only.
# Tracked: IDENTITY.md, public keys, passenger.json, proofs, declarations.
# Local-only: private keys, device artifacts, .env.

# Private keys — never commit
id/ed25519
id/ecdsa
id/rsa
id/dsa

# Private GPG key
id/gpg.private.asc
id/leaf.private.asc

# GPG revocation certificate — store offline, never commit
id/gpg-revocation.asc

# GPG keyring
keyring/

# SSL private material
id/ssl/master-curve.pem
id/ssl/device-curve.pem
id/ssl/relay-curve.pem
id/ssl/session.pem

# Device key — machine-local artifact, never commit
id/device.key
id/device.key.pub
device.key

# Local config — machine-specific, never commit
.env

# Dependencies
node_modules/

# Runtime
var/
proc/

# macOS
.DS_Store

# Editor
.vscode/
*.swp
GITIGNORE

# ---------------------------------------------------------------------------
# id/.gitignore — protecting private keys inside id/ specifically
# ---------------------------------------------------------------------------

cat > "$SOVEREIGN_DIR/id/.gitignore" << 'GITIGNORE'
# Private keys — never commit
ed25519
ecdsa
rsa
dsa
gpg.private.asc
leaf.private.asc
gpg-revocation.asc
device.key
device.key.pub
# SSL private material
ssl/master-curve.pem
ssl/device-curve.pem
ssl/relay-curve.pem
ssl/session.pem
# Keep public keys
!*.pub
!gpg.public.asc
!leaf.public.asc
# Keep this file
!.gitignore
GITIGNORE

# ---------------------------------------------------------------------------
# Interactive questions — handle, Keybase, domain, GitHub
# ask --write builds .env progressively; if value already in env, skips prompt
# ---------------------------------------------------------------------------

# Ensure .env header is present if file doesn't exist yet
if [ ! -f "$SOVEREIGN_DIR/.env" ]; then
    cat > "$SOVEREIGN_DIR/.env" << 'ENVHEADER'
# SPDX-License-Identifier: AGPL-3.0-or-later
# ~/.koad-io/me/.env — local machine config. Gitignored. Never commit.
ENVHEADER
    say ".env — created with header"
fi

# 1. Handle
say "What handle would you like to use? This is your identity in the kingdom."
RAW_HANDLE=$(ask "Your handle (e.g. koad)" "${KOAD_IO_HANDLE:-}" "" --write "$SOVEREIGN_DIR/.env" SOVEREIGN_HANDLE)
if [ -z "$RAW_HANDLE" ]; then
    RAW_HANDLE=$(whoami)
    say "No handle entered — using system user: $RAW_HANDLE"
fi
SOVEREIGN_HANDLE="$RAW_HANDLE"
say "Handle: $SOVEREIGN_HANDLE"
say ""

# 2. Keybase — detect first, ask only if not logged in
KB_USERNAME=""
SKIP_KEYBASE=0
KB_DETECTED=$(keybase whoami 2>/dev/null || true)
if [ -n "$KB_DETECTED" ]; then
    KB_USERNAME="${KOAD_IO_KEYBASE_USERNAME:-$KB_DETECTED}"
    say "Keybase detected — handle: $KB_USERNAME"
    ensure_env_line "$SOVEREIGN_DIR/.env" "KEYBASE_USERNAME" "$KB_USERNAME"
else
    if ask_yn "Do you have a Keybase account?" "${KOAD_IO_HAS_KEYBASE:-}"; then
        KB_DEFAULT="$SOVEREIGN_HANDLE"
        KB_USERNAME=$(ask "Your Keybase handle" "${KOAD_IO_KEYBASE_USERNAME:-}" "$KB_DEFAULT" --write "$SOVEREIGN_DIR/.env" KEYBASE_USERNAME)
        say "Keybase handle: $KB_USERNAME"
    else
        say ""
        say "Keybase provides sovereign, encrypted git repos and team management."
        say "Your sovereign identity repo will be much more secure on Keybase than"
        say "anywhere else — it's the house, not the window."
        say ""
        say "Sign up at: https://keybase.io"
        say ""
        say "You can run 'koad-io init sovereign' again after signing up."
        say "Or continue without Keybase — you can add it later."
        say ""
        if ask_yn "Continue without Keybase?" "${KOAD_IO_CONTINUE_WITHOUT_KEYBASE:-}"; then
            SKIP_KEYBASE=1
            say "Continuing without Keybase."
        else
            say "Exiting. Sign up at https://keybase.io and run 'koad-io init sovereign' again."
            exit 0
        fi
    fi
fi
say ""

# 3. Domain
say "What domain will anchor your kingdom? Used for email addresses and GPG key."
SOVEREIGN_DOMAIN=$(ask "Kingdom domain (e.g. kingofalldata.com)" "${KOAD_IO_KINGDOM_DOMAIN:-}" "" --write "$SOVEREIGN_DIR/.env" SOVEREIGN_DOMAIN)
if [ -z "$SOVEREIGN_DOMAIN" ]; then
    say "No domain entered — you can update this later in ~/.koad-io/me/.env"
    SOVEREIGN_DOMAIN="example.com"
fi
say "Domain: $SOVEREIGN_DOMAIN"
say ""

# ---------------------------------------------------------------------------
# Ensure structural .env lines are present (idempotent — append if missing)
# ---------------------------------------------------------------------------

ensure_env_line "$SOVEREIGN_DIR/.env" "ENTITY" "me"
ensure_env_line "$SOVEREIGN_DIR/.env" "ENTITY_DIR" "\$HOME/.koad-io/me"
ensure_env_line "$SOVEREIGN_DIR/.env" "ENTITY_HOME" "\$HOME/.koad-io/me"
ensure_env_line "$SOVEREIGN_DIR/.env" "GNUPGHOME" "\$HOME/.koad-io/me/keyring"
ensure_env_line "$SOVEREIGN_DIR/.env" "GIT_AUTHOR_NAME" "$SOVEREIGN_HANDLE"
ensure_env_line "$SOVEREIGN_DIR/.env" "GIT_AUTHOR_EMAIL" "${SOVEREIGN_HANDLE}@${SOVEREIGN_DOMAIN}"
ensure_env_line "$SOVEREIGN_DIR/.env" "GIT_COMMITTER_NAME" "$SOVEREIGN_HANDLE"
ensure_env_line "$SOVEREIGN_DIR/.env" "GIT_COMMITTER_EMAIL" "${SOVEREIGN_HANDLE}@${SOVEREIGN_DOMAIN}"

# ---------------------------------------------------------------------------
# Generate crypto suite — VESTA-SPEC-174 §4.2 + VESTA-SPEC-149 §8.1
# Uses @koad-io/node ceremony.mjs — same key lineage as storefront + daemon.
# Replaces bare ssh-keygen/gpg/openssl path (removed — different key lineage).
# Each artifact is checked before generation; --forceful overrides.
# ---------------------------------------------------------------------------

ID_DIR="$SOVEREIGN_DIR/id"
CEREMONY_SCRIPT="$(dirname "${BASH_SOURCE[0]}")/ceremony.mjs"

# Verify jq is present — required for parsing ceremony JSON
command -v jq >/dev/null 2>&1 || die "jq is required but not found — install it and retry"
command -v node >/dev/null 2>&1 || die "node is required but not found — install Node.js >= 18 and retry"

USERID="${SOVEREIGN_HANDLE} @ ${SOVEREIGN_DOMAIN}"

# Run ceremony if any key artifact is missing (or --forceful)
if [ ! -f "$ID_DIR/gpg.public.asc" ] || [ ! -f "$ID_DIR/device.key" ] || [ "$FORCEFUL" -eq 1 ]; then

    did "sovereign keypair" "running ceremony via @koad-io/node..."
    say ""

    # ---------------------------------------------------------------------------
    # Step 1 — Entropy source: existing mnemonic or generate fresh
    # The mnemonic (24 words) is the master secret. It never touches disk.
    # ---------------------------------------------------------------------------

    HAVE_EXISTING_MNEMONIC=0
    if ask_yn "  ◆ Do you have an existing recovery phrase?" "${KOAD_IO_HAVE_EXISTING_MNEMONIC:-}"; then
        HAVE_EXISTING_MNEMONIC=1
    fi

    if [ "$HAVE_EXISTING_MNEMONIC" -eq 1 ]; then

        # Existing mnemonic path — recover
        say ""
        say "  Enter your 24 recovery words, space-separated, on one line."
        say "  Input is hidden — it will not appear on screen."
        say ""
        MNEMONIC_INPUT=""
        while [ -z "$MNEMONIC_INPUT" ]; do
            echo -n "    Recovery phrase: "
            read -rs MNEMONIC_INPUT
            echo ""  # newline after hidden input
            MNEMONIC_INPUT="$(echo "$MNEMONIC_INPUT" | tr -s ' ' | sed 's/^ //;s/ $//')"
            if [ -z "$MNEMONIC_INPUT" ]; then
                say "  No input received. Try again."
            fi
        done

        # Recover — ceremony.mjs validates BIP39 internally and dies on failure
        say ""
        say "  Validating recovery phrase and deriving master key..."
        CEREMONY_JSON=$(node "$CEREMONY_SCRIPT" recover \
            --mnemonic "$MNEMONIC_INPUT" \
            --userid "$USERID") || die "Recovery failed — mnemonic may be invalid or ceremony script errored"

        # Clear raw input — ceremony has it now; we'll pull from JSON
        MNEMONIC_INPUT=""
        unset MNEMONIC_INPUT

        say "  Recovery phrase accepted."
        say ""

    else

        # Fresh generate path
        CEREMONY_JSON=$(node "$CEREMONY_SCRIPT" generate --userid "$USERID") || die "Ceremony script failed"

    fi

    # Both paths include .mnemonic in JSON; extract once here
    MNEMONIC=$(echo "$CEREMONY_JSON" | jq -r '.mnemonic')
    SOVEREIGN_LABEL=$(echo "$CEREMONY_JSON" | jq -r '.label')
    MASTER_FINGERPRINT=$(echo "$CEREMONY_JSON" | jq -r '.masterFingerprint')
    MASTER_PUBLIC_ARMOR=$(echo "$CEREMONY_JSON" | jq -r '.masterPublicArmor')
    LEAF_PUBLIC_ARMOR=$(echo "$CEREMONY_JSON" | jq -r '.leafPublicArmor')
    LEAF_PRIVATE_ARMOR=$(echo "$CEREMONY_JSON" | jq -r '.leafPrivateArmor')
    LEAF_FINGERPRINT=$(echo "$CEREMONY_JSON" | jq -r '.leafFingerprint')
    DEVICE_KEY=$(echo "$CEREMONY_JSON" | jq -r '.devicePrivateKey')
    DEVICE_KEY_PUB=$(echo "$CEREMONY_JSON" | jq -r '.devicePublicKey')

    say "Key label: $SOVEREIGN_LABEL"

    # ---------------------------------------------------------------------------
    # Steps 2 & 3 — Display mnemonic + quiz (fresh generate only)
    # Recover path: user already has their words written down — skip display and quiz.
    # ---------------------------------------------------------------------------

    if [ "$HAVE_EXISTING_MNEMONIC" -eq 0 ]; then

    say "  ╔══════════════════════════════════════════════════════════════╗"
    say "  ║  WRITE THESE WORDS DOWN. Every word. In order. On paper.    ║"
    say "  ║  Do not screenshot. Do not paste. Do not type elsewhere.    ║"
    say "  ║  These words ARE your identity. Lose them, lose everything. ║"
    say "  ╚══════════════════════════════════════════════════════════════╝"
    say ""

    # Print mnemonic in a numbered 4-column grid
    WORD_IDX=0
    MNEMONIC_WORDS=($MNEMONIC)
    LINE=""
    for i in "${!MNEMONIC_WORDS[@]}"; do
        NUM=$((i + 1))
        WORD="${MNEMONIC_WORDS[$i]}"
        # Pad number and word for alignment
        ENTRY=$(printf "%3d. %-12s" "$NUM" "$WORD")
        LINE="$LINE  $ENTRY"
        # 4 columns per row
        if [ $(( (i + 1) % 4 )) -eq 0 ]; then
            say "$LINE"
            LINE=""
        fi
    done
    # Print any remaining words (if not divisible by 4)
    [ -n "$LINE" ] && say "$LINE"

    say ""
    echo -n "[sovereign] Press Enter when you've written all 24 words down..."
    read -r _

    # Step 3 — Quiz — 3 random positions
    say ""
    say "  ◆ Confirm your backup"
    say ""

    # Pick 3 random positions (1-indexed, no repeats)
    POSITIONS=()
    while [ ${#POSITIONS[@]} -lt 3 ]; do
        P=$(( (RANDOM % 24) + 1 ))
        # Check not already chosen
        ALREADY=0
        for Q in "${POSITIONS[@]}"; do [ "$Q" -eq "$P" ] && ALREADY=1 && break; done
        [ "$ALREADY" -eq 0 ] && POSITIONS+=("$P")
    done
    # Sort ascending
    IFS=$'\n' POSITIONS=($(sort -n <<<"${POSITIONS[*]}")); unset IFS

    QUIZ_PASSED=0
    while [ "$QUIZ_PASSED" -eq 0 ]; do
        ANSWERS=""
        for POS in "${POSITIONS[@]}"; do
            echo -n "    Word ${POS}: "
            read -r ANS
            ANSWERS="${ANSWERS}${ANS}
"
        done

        POSITIONS_CSV=$(IFS=,; echo "${POSITIONS[*]}")
        VALIDATE_RESULT=$(echo "$ANSWERS" | node "$CEREMONY_SCRIPT" validate \
            --positions "$POSITIONS_CSV" \
            --mnemonic "$MNEMONIC")

        VALID=$(echo "$VALIDATE_RESULT" | jq -r '.valid')
        if [ "$VALID" = "true" ]; then
            QUIZ_PASSED=1
            say ""
            say "  Backup confirmed."
        else
            ERR=$(echo "$VALIDATE_RESULT" | jq -r '.error // "unknown error"')
            say ""
            say "  Incorrect: $ERR"
            say "  Here are your words again:"
            say ""
            LINE=""
            for i in "${!MNEMONIC_WORDS[@]}"; do
                NUM=$((i + 1))
                WORD="${MNEMONIC_WORDS[$i]}"
                ENTRY=$(printf "%3d. %-12s" "$NUM" "$WORD")
                LINE="$LINE  $ENTRY"
                if [ $(( (i + 1) % 4 )) -eq 0 ]; then
                    say "$LINE"
                    LINE=""
                fi
            done
            [ -n "$LINE" ] && say "$LINE"
            say ""
            echo -n "[sovereign] Press Enter when ready to try again..."
            read -r _
            say ""
            say "  ◆ Confirm your backup (retry)"
            say ""
        fi
    done

    fi  # end fresh generate display+quiz block

    # ---------------------------------------------------------------------------
    # Step 4 — Write artifacts to id/
    # Master key never touches disk — only public armor + leaf (encrypted) + device key
    # ---------------------------------------------------------------------------

    printf '%s' "$MASTER_PUBLIC_ARMOR"  > "$ID_DIR/gpg.public.asc"
    printf '%s' "$LEAF_PUBLIC_ARMOR"    > "$ID_DIR/leaf.public.asc"
    printf '%s' "$LEAF_PRIVATE_ARMOR"   > "$ID_DIR/leaf.private.asc"
    printf '%s' "$DEVICE_KEY"           > "$ID_DIR/device.key"
    printf '%s' "$DEVICE_KEY_PUB"       > "$ID_DIR/device.key.pub"
    printf '%s' "$MASTER_FINGERPRINT"   > "$ID_DIR/master.fingerprint"
    printf '%s' "$SOVEREIGN_LABEL"      > "$ID_DIR/label"
    chmod 600 "$ID_DIR/device.key" "$ID_DIR/leaf.private.asc"

    ensure_env_line "$SOVEREIGN_DIR/.env" "SOVEREIGN_LABEL" "$SOVEREIGN_LABEL"

    say ""
    say "generated: $ID_DIR/gpg.public.asc (master fingerprint: ${MASTER_FINGERPRINT:(-16)})"
    say "generated: $ID_DIR/leaf.public.asc (leaf fingerprint: ${LEAF_FINGERPRINT:(-16)})"
    say "generated: $ID_DIR/leaf.private.asc (encrypted — passphrase is device.key)"
    say "generated: $ID_DIR/device.key (gitignored — machine-local, never commit)"
    say "generated: $ID_DIR/master.fingerprint"
    say "generated: $ID_DIR/label ($SOVEREIGN_LABEL)"

    # ---------------------------------------------------------------------------
    # Step 5 — Zero sensitive vars from shell memory
    # SOVEREIGN_LABEL is NOT unset — it's a non-sensitive reference, needed below
    # ---------------------------------------------------------------------------
    unset MNEMONIC CEREMONY_JSON DEVICE_KEY DEVICE_KEY_PUB MASTER_PUBLIC_ARMOR
    unset LEAF_PUBLIC_ARMOR LEAF_PRIVATE_ARMOR MASTER_FINGERPRINT LEAF_FINGERPRINT
    unset MNEMONIC_WORDS

else
    skip "id/gpg.public.asc (sovereign keypair)"
    skip "id/device.key"
    # Load label from disk for use in passenger.json (idempotent path)
    SOVEREIGN_LABEL="${SOVEREIGN_LABEL:-}"
    [ -z "$SOVEREIGN_LABEL" ] && [ -f "$ID_DIR/label" ] && SOVEREIGN_LABEL=$(cat "$ID_DIR/label")
fi

# ---------------------------------------------------------------------------
# passenger.json — write if missing; skip if present (SPEC-174 §2.3)
# ---------------------------------------------------------------------------

if [ ! -f "$SOVEREIGN_DIR/passenger.json" ]; then
    did "passenger.json" "creating"
    cat > "$SOVEREIGN_DIR/passenger.json" << PASSEOF
{
  "entity": "me",
  "handle": "$SOVEREIGN_HANDLE",
  "type": "sovereign",
  "home": "~/.koad-io/me",
  "label": "$SOVEREIGN_LABEL"
}
PASSEOF
    say "wrote: $SOVEREIGN_DIR/passenger.json"
else
    skip "passenger.json"
fi

# ---------------------------------------------------------------------------
# IDENTITY.md — write stub if missing; NEVER overwrite (user may have filled it in)
# ---------------------------------------------------------------------------

if [ ! -f "$SOVEREIGN_DIR/IDENTITY.md" ]; then
    did "IDENTITY.md" "creating stub"
    cat > "$SOVEREIGN_DIR/IDENTITY.md" << 'IDENTEOF'
# [Your Name]

> [Your tagline — one sentence about who you are]

[Your ideals, in your own words. This file is yours. It travels with you across kingdoms.]

---

<!-- Optionally: proofs, links, Keybase declarations, chain references -->
IDENTEOF
    say "wrote: $SOVEREIGN_DIR/IDENTITY.md"
else
    skip "IDENTITY.md (yours to edit)"
fi

# ---------------------------------------------------------------------------
# Init git repo in me/ — skip if .git already present
# ---------------------------------------------------------------------------

if [ ! -d "$SOVEREIGN_DIR/.git" ]; then
    did "git repo" "initializing"
    git -C "$SOVEREIGN_DIR" init -b main 2>/dev/null || git -C "$SOVEREIGN_DIR" init
    say "initialized: $SOVEREIGN_DIR/.git"
else
    skip "git repo"
fi

# Stage and commit whatever's new — skip if nothing to commit
git -C "$SOVEREIGN_DIR" add \
    .gitignore \
    id/.gitignore \
    2>/dev/null || true

[ -f "$SOVEREIGN_DIR/passenger.json" ]   && git -C "$SOVEREIGN_DIR" add "$SOVEREIGN_DIR/passenger.json" 2>/dev/null || true
[ -f "$SOVEREIGN_DIR/IDENTITY.md" ]     && git -C "$SOVEREIGN_DIR" add "$SOVEREIGN_DIR/IDENTITY.md" 2>/dev/null || true
[ -f "$ID_DIR/gpg.public.asc" ]         && git -C "$SOVEREIGN_DIR" add "$ID_DIR/gpg.public.asc" 2>/dev/null || true
[ -f "$ID_DIR/leaf.public.asc" ]        && git -C "$SOVEREIGN_DIR" add "$ID_DIR/leaf.public.asc" 2>/dev/null || true
[ -f "$ID_DIR/master.fingerprint" ]     && git -C "$SOVEREIGN_DIR" add "$ID_DIR/master.fingerprint" 2>/dev/null || true
[ -f "$ID_DIR/label" ]                  && git -C "$SOVEREIGN_DIR" add "$ID_DIR/label" 2>/dev/null || true

if ! git -C "$SOVEREIGN_DIR" diff --cached --quiet 2>/dev/null; then
    git -C "$SOVEREIGN_DIR" commit -m "kingdom genesis — sovereign identity initialized on $HOSTNAME" 2>/dev/null
    say "committed staged files"
else
    skip "git commit (nothing new to stage)"
fi

# ---------------------------------------------------------------------------
# Genesis confirmation
# ---------------------------------------------------------------------------

say ""
say "================================================================================"
say " Kingdom genesis complete."
say "================================================================================"
say ""
say " The root of trust exists."
say " Key label: ${SOVEREIGN_LABEL:-(unknown — run again to generate)}"
say " Public keys are at ~/.koad-io/me/id/"
say " Edit ~/.koad-io/me/IDENTITY.md — write who you are in your own words."
say ""

# ---------------------------------------------------------------------------
# Post-genesis: Keybase remote setup — add if not present, skip if configured
# ---------------------------------------------------------------------------

if [ -n "$KB_USERNAME" ] && [ "$SKIP_KEYBASE" -eq 0 ]; then
    KB_REMOTE="keybase://private/$KB_USERNAME/me"
    if git -C "$SOVEREIGN_DIR" remote get-url origin >/dev/null 2>&1; then
        skip "Keybase remote (origin already configured)"
    else
        did "Keybase remote" "adding origin → $KB_REMOTE"
        git -C "$SOVEREIGN_DIR" remote add origin "$KB_REMOTE" 2>/dev/null
        say "Remote: origin → $KB_REMOTE"
        say ""
        say "Pushing to Keybase..."
        say "(Make sure Keybase is running and you're logged in as your handle: $KB_USERNAME)"
        if git -C "$SOVEREIGN_DIR" push -u origin main 2>/dev/null; then
            say "Pushed to Keybase. Your sovereign identity is backed up."
        else
            say "Push failed — run manually once Keybase is running:"
            say "  git -C ~/.koad-io/me push -u origin main"
        fi
    fi
    say ""
fi

# ---------------------------------------------------------------------------
# Post-genesis: Optional GitHub mirror — add if not present, skip if configured
# ---------------------------------------------------------------------------

say ""
if ask_yn "Would you like to also set up a public GitHub mirror?" "${KOAD_IO_SETUP_GITHUB:-}"; then
    GH_DEFAULT="$SOVEREIGN_HANDLE"
    GH_USERNAME=$(ask "Your GitHub handle" "${KOAD_IO_GITHUB_USERNAME:-}" "$GH_DEFAULT")
    GH_REPO="$GH_USERNAME/me"
    GH_REMOTE="https://github.com/$GH_REPO.git"

    if git -C "$SOVEREIGN_DIR" remote get-url github >/dev/null 2>&1; then
        skip "GitHub remote (github already configured)"
    else
        did "GitHub remote" "adding github → $GH_REMOTE"
        git -C "$SOVEREIGN_DIR" remote add github "$GH_REMOTE" 2>/dev/null
        say ""
        say "Create the repo first at: https://github.com/new"
        say "Suggested repo name: me"
        say "Suggested visibility: public (this repo carries only your public identity)"
        say ""
        say "Remote added: github → $GH_REMOTE"
        say "Push manually after creating the repo:"
        say "  git -C ~/.koad-io/me push -u github main"
    fi
else
    say "Skipping GitHub mirror. Add it later with:"
    say "  git -C ~/.koad-io/me remote add github https://github.com/<handle>/me.git"
fi
say ""

say "IMPORTANT: ~/.koad-io/me/ is its own git repo, not part of the koad-io"
say "framework repo. Your keys and IDENTITY.md are yours, not ours."
say ""

source "$HOME/.koad-io/helpers/discovery.sh" 2>/dev/null && _koad_io_hint
