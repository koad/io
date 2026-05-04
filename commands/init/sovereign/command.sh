#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# koad-io init sovereign — kingdom genesis command
#
# Usage:
#   koad-io init sovereign              # New sovereign — kingdom genesis
#   koad-io init sovereign <repo-url>   # Existing sovereign on new machine
#
# Ref: VESTA-SPEC-174 §4 — koad-io init sovereign command contract

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

# ---------------------------------------------------------------------------
# Guard: already exists?
# ---------------------------------------------------------------------------

if [ -d "$SOVEREIGN_DIR" ] && [ "$FORCEFUL" -eq 0 ]; then
    say "~/.koad-io/me/ already exists."
    say "Kingdom genesis has already run on this machine."
    say "Use --forceful to overwrite (danger: replaces existing keys)."
    exit 1
fi

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
# PATH 1 — New sovereign (no repo-url) — kingdom genesis
# ---------------------------------------------------------------------------

say "New sovereign path — kingdom genesis"
say "This will create the root of trust for your kingdom."
say ""

# Create directory structure per VESTA-SPEC-174 §2.1
say "Creating ~/.koad-io/me/ directory structure"
mkdir -p "$SOVEREIGN_DIR/id/ssl"
mkdir -p "$SOVEREIGN_DIR/trust/bonds"
mkdir -p "$SOVEREIGN_DIR/memories"

# ---------------------------------------------------------------------------
# Write .gitignore — inner gitignore for me/ repo (SPEC-174 §2.4)
# ---------------------------------------------------------------------------

say "Writing .gitignore to protect private keys from accidental commits"
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
say "wrote: $SOVEREIGN_DIR/.gitignore"

# ---------------------------------------------------------------------------
# Write id/.gitignore — protecting private keys inside id/ specifically
# ---------------------------------------------------------------------------

say "Writing id/.gitignore"
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
say "wrote: $SOVEREIGN_DIR/id/.gitignore"

# ---------------------------------------------------------------------------
# Interactive questions — handle, Keybase, domain, GitHub
# ---------------------------------------------------------------------------

# 1. Handle
say "What handle would you like to use? This is your identity in the kingdom."
RAW_HANDLE=$(ask "Your handle (e.g. koad)" "${KOAD_IO_HANDLE:-}" "")
if [ -z "$RAW_HANDLE" ]; then
    RAW_HANDLE=$(whoami)
    say "No handle entered — using system user: $RAW_HANDLE"
fi
SOVEREIGN_HANDLE="$RAW_HANDLE"
say "Handle: $SOVEREIGN_HANDLE"
say ""

# 2. Keybase
KB_USERNAME=""
SKIP_KEYBASE=0
if ask_yn "Do you have a Keybase account?" "${KOAD_IO_HAS_KEYBASE:-}"; then
    KB_DEFAULT="$SOVEREIGN_HANDLE"
    KB_USERNAME=$(ask "Your Keybase username" "${KOAD_IO_KEYBASE_USERNAME:-}" "$KB_DEFAULT")
    say "Keybase username: $KB_USERNAME"
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
say ""

# 3. Domain
say "What domain will anchor your kingdom? Used for email addresses and GPG key."
SOVEREIGN_DOMAIN=$(ask "Kingdom domain (e.g. kingofalldata.com)" "${KOAD_IO_KINGDOM_DOMAIN:-}" "")
if [ -z "$SOVEREIGN_DOMAIN" ]; then
    say "No domain entered — you can update this later in ~/.koad-io/me/.env"
    SOVEREIGN_DOMAIN="example.com"
fi
say "Domain: $SOVEREIGN_DOMAIN"
say ""

# 4. GitHub (asked after genesis — stored for post-genesis setup)
GH_USERNAME=""
SETUP_GITHUB=0

# ---------------------------------------------------------------------------
# Generate crypto suite — per VESTA-SPEC-174 §4.2 and gestate pattern
# ---------------------------------------------------------------------------

ID_DIR="$SOVEREIGN_DIR/id"
GNUPGHOME_SAVE="${GNUPGHOME:-}"
GNUPGHOME="$SOVEREIGN_DIR/keyring"
export GNUPGHOME
mkdir -p "$SOVEREIGN_DIR/keyring" && chmod 700 "$SOVEREIGN_DIR/keyring"

# Ed25519 device key
say "Generating Ed25519 keypair for sovereign@$HOSTNAME"
ssh-keygen -t ed25519 -f "$ID_DIR/ed25519" -C "sovereign@$HOSTNAME" -N "" 2>/dev/null
say "generated: $ID_DIR/ed25519"
say "generated: $ID_DIR/ed25519.pub"

# GPG identity key
say "Generating GPG identity key for $SOVEREIGN_HANDLE@$SOVEREIGN_DOMAIN"
GPG_EMAIL="${SOVEREIGN_HANDLE}@${SOVEREIGN_DOMAIN}"
gpg --batch --gen-key 2>/dev/null <<GPGEOF
%no-protection
Key-Type: RSA
Key-Length: 4096
Subkey-Type: RSA
Subkey-Length: 4096
Name-Real: $SOVEREIGN_HANDLE
Name-Email: $GPG_EMAIL
Expire-Date: 0
%commit
GPGEOF
say "generated: GPG key for $GPG_EMAIL"

# Export GPG public key
GPG_FPR=$(gpg --list-keys --with-colons "$GPG_EMAIL" 2>/dev/null | grep '^fpr' | head -1 | cut -d: -f10)
if [ -n "$GPG_FPR" ]; then
    gpg --export --armor "$GPG_FPR" > "$ID_DIR/gpg.public.asc" 2>/dev/null
    say "generated: $ID_DIR/gpg.public.asc (fingerprint: ${GPG_FPR:(-16)})"

    # Revocation cert — gitignored, stored offline
    gpg --batch --yes --output "$ID_DIR/gpg-revocation.asc" \
        --command-fd 0 --gen-revoke "$GPG_FPR" <<REVEOF 2>/dev/null
y
0

y
REVEOF
    if [ -f "$ID_DIR/gpg-revocation.asc" ]; then
        say "generated: $ID_DIR/gpg-revocation.asc (gitignored — store offline separately)"
    else
        say "WARNING: GPG revocation cert generation failed. Generate manually:"
        say "  gpg --gen-revoke $GPG_FPR > $ID_DIR/gpg-revocation.asc"
    fi
else
    say "WARNING: Could not find GPG key fingerprint — skipping public key export and revocation cert"
fi

# SSL curves — same pattern as gestate
SSL_DIR="$ID_DIR/ssl"
say "Generating master elliptic curve parameters"
openssl ecparam -name prime256v1 -out "$SSL_DIR/master-curve-parameters.pem" 2>/dev/null
say "generated: $SSL_DIR/master-curve-parameters.pem"

say "Generating master elliptic curve"
openssl genpkey -aes256 -pass "pass:$SOVEREIGN_HANDLE" \
    -paramfile "$SSL_DIR/master-curve-parameters.pem" \
    -out "$SSL_DIR/master-curve.pem" 2>/dev/null
say "generated: $SSL_DIR/master-curve.pem"

say "Generating device elliptic curve"
openssl genpkey -aes256 -pass "pass:$SOVEREIGN_HANDLE" \
    -paramfile "$SSL_DIR/master-curve-parameters.pem" \
    -out "$SSL_DIR/device-curve.pem" 2>/dev/null
say "generated: $SSL_DIR/device-curve.pem"

say "Generating relay elliptic curve"
openssl genpkey -aes256 -pass "pass:$SOVEREIGN_HANDLE" \
    -paramfile "$SSL_DIR/master-curve-parameters.pem" \
    -out "$SSL_DIR/relay-curve.pem" 2>/dev/null
say "generated: $SSL_DIR/relay-curve.pem"

say "Generating session key"
openssl genpkey -algorithm EC -pass "pass:$SOVEREIGN_HANDLE" \
    -pkeyopt ec_paramgen_curve:P-256 \
    -out "$SSL_DIR/session.pem" 2>/dev/null
say "generated: $SSL_DIR/session.pem"

# Restore GNUPGHOME
[ -n "$GNUPGHOME_SAVE" ] && export GNUPGHOME="$GNUPGHOME_SAVE" || unset GNUPGHOME

# ---------------------------------------------------------------------------
# passenger.json — SPEC-174 §2.3
# ---------------------------------------------------------------------------

say "Writing passenger.json"
cat > "$SOVEREIGN_DIR/passenger.json" << PASSEOF
{
  "entity": "me",
  "handle": "$SOVEREIGN_HANDLE",
  "type": "sovereign",
  "home": "~/.koad-io/me"
}
PASSEOF
say "wrote: $SOVEREIGN_DIR/passenger.json"

# ---------------------------------------------------------------------------
# IDENTITY.md — stub for operator to fill (SPEC-174 §3)
# ---------------------------------------------------------------------------

say "Stubbing IDENTITY.md — fill this in your own words"
cat > "$SOVEREIGN_DIR/IDENTITY.md" << 'IDENTEOF'
# [Your Name]

> [Your tagline — one sentence about who you are]

[Your ideals, in your own words. This file is yours. It travels with you across kingdoms.]

---

<!-- Optionally: proofs, links, Keybase declarations, chain references -->
IDENTEOF
say "wrote: $SOVEREIGN_DIR/IDENTITY.md"

# ---------------------------------------------------------------------------
# .env — local-only machine config (gitignored)
# ---------------------------------------------------------------------------

say "Writing .env (local-only, gitignored)"
cat > "$SOVEREIGN_DIR/.env" << ENVEOF
# SPDX-License-Identifier: AGPL-3.0-or-later
# ~/.koad-io/me/.env — local machine config. Gitignored. Never commit.

ENTITY=me
ENTITY_DIR=\$HOME/.koad-io/me
ENTITY_HOME=\$HOME/.koad-io/me

SOVEREIGN_HANDLE=$SOVEREIGN_HANDLE
SOVEREIGN_DOMAIN=$SOVEREIGN_DOMAIN
GNUPGHOME=\$HOME/.koad-io/me/keyring

GIT_AUTHOR_NAME=$SOVEREIGN_HANDLE
GIT_AUTHOR_EMAIL=${SOVEREIGN_HANDLE}@${SOVEREIGN_DOMAIN}
GIT_COMMITTER_NAME=$SOVEREIGN_HANDLE
GIT_COMMITTER_EMAIL=${SOVEREIGN_HANDLE}@${SOVEREIGN_DOMAIN}
ENVEOF
say "wrote: $SOVEREIGN_DIR/.env"

# ---------------------------------------------------------------------------
# Init git repo in me/
# ---------------------------------------------------------------------------

if [ ! -d "$SOVEREIGN_DIR/.git" ]; then
    say "Initializing git repo in ~/.koad-io/me/"
    git -C "$SOVEREIGN_DIR" init -b main 2>/dev/null || git -C "$SOVEREIGN_DIR" init
    say "initialized: $SOVEREIGN_DIR/.git"
else
    say "Git repo already present — skipping init"
fi

# Initial commit — public files only (private keys are gitignored)
git -C "$SOVEREIGN_DIR" add \
    .gitignore \
    id/.gitignore \
    passenger.json \
    IDENTITY.md \
    2>/dev/null || true

# Add public keys if they exist
[ -f "$ID_DIR/ed25519.pub" ]      && git -C "$SOVEREIGN_DIR" add "$ID_DIR/ed25519.pub" 2>/dev/null || true
[ -f "$ID_DIR/gpg.public.asc" ]   && git -C "$SOVEREIGN_DIR" add "$ID_DIR/gpg.public.asc" 2>/dev/null || true

git -C "$SOVEREIGN_DIR" commit -m "kingdom genesis — sovereign identity initialized on $HOSTNAME" 2>/dev/null || {
    say "Note: nothing staged for initial commit — run 'git -C ~/.koad-io/me commit' manually if needed"
}

# ---------------------------------------------------------------------------
# Genesis confirmation
# ---------------------------------------------------------------------------

say ""
say "================================================================================"
say " Kingdom genesis complete."
say "================================================================================"
say ""
say " The root of trust exists."
say " Public keys are at ~/.koad-io/me/id/"
say " Edit ~/.koad-io/me/IDENTITY.md — write who you are in your own words."
say ""

# ---------------------------------------------------------------------------
# Post-genesis: Keybase remote setup
# ---------------------------------------------------------------------------

if [ -n "$KB_USERNAME" ] && [ "$SKIP_KEYBASE" -eq 0 ]; then
    say "Setting up Keybase remote..."
    KB_REMOTE="keybase://private/$KB_USERNAME/me"
    git -C "$SOVEREIGN_DIR" remote add origin "$KB_REMOTE" 2>/dev/null || {
        say "Remote 'origin' already exists — skipping add."
    }
    say "Remote: origin → $KB_REMOTE"
    say ""
    say "Pushing to Keybase..."
    say "(Make sure Keybase is running and you're logged in as $KB_USERNAME)"
    if git -C "$SOVEREIGN_DIR" push -u origin main 2>/dev/null; then
        say "Pushed to Keybase. Your sovereign identity is backed up."
    else
        say "Push failed — run manually once Keybase is running:"
        say "  git -C ~/.koad-io/me push -u origin main"
    fi
    say ""
fi

# ---------------------------------------------------------------------------
# Post-genesis: Optional GitHub mirror
# ---------------------------------------------------------------------------

say ""
if ask_yn "Would you like to also set up a public GitHub mirror?" "${KOAD_IO_SETUP_GITHUB:-}"; then
    GH_DEFAULT="$SOVEREIGN_HANDLE"
    GH_USERNAME=$(ask "Your GitHub username" "${KOAD_IO_GITHUB_USERNAME:-}" "$GH_DEFAULT")
    GH_REPO="$GH_USERNAME/me"
    GH_REMOTE="https://github.com/$GH_REPO.git"
    say ""
    say "Create the repo first at: https://github.com/new"
    say "Suggested repo name: me"
    say "Suggested visibility: public (this repo carries only your public identity)"
    say ""
    git -C "$SOVEREIGN_DIR" remote add github "$GH_REMOTE" 2>/dev/null || {
        say "Remote 'github' already exists — skipping add."
    }
    say "Remote added: github → $GH_REMOTE"
    say "Push manually after creating the repo:"
    say "  git -C ~/.koad-io/me push -u github main"
else
    say "Skipping GitHub mirror. Add it later with:"
    say "  git -C ~/.koad-io/me remote add github https://github.com/<username>/me.git"
fi
say ""

say "IMPORTANT: ~/.koad-io/me/ is its own git repo, not part of the koad-io"
say "framework repo. Your keys and IDENTITY.md are yours, not ours."
say ""

source "$HOME/.koad-io/helpers/discovery.sh" 2>/dev/null && _koad_io_hint
