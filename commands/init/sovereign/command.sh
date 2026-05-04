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
SOURCE_LABEL="fresh genesis"

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
# Pre-seed: clone sovereign directory if repo-url given
# ---------------------------------------------------------------------------

if [ -n "$REPO_URL" ] && [[ "$REPO_URL" != --* ]]; then
    if [ ! -d "$SOVEREIGN_DIR" ]; then
        say "Cloning sovereign identity from $REPO_URL"
        git clone "$REPO_URL" "$SOVEREIGN_DIR" || die "Clone failed: $REPO_URL"

        # Convert HTTPS origin to SSH for ongoing operations
        if [[ "$REPO_URL" == https://* ]]; then
            SSH_URL=$(echo "$REPO_URL" | sed -E 's|^https://([^/]+)/(.+)$|git@\1:\2|')
            git -C "$SOVEREIGN_DIR" remote set-url origin "$SSH_URL"
            say "Origin remote: $REPO_URL → $SSH_URL (SSH form)"
        fi

        SOURCE_LABEL="cloned from $REPO_URL"
    else
        say "$SOVEREIGN_DIR already exists — skipping clone, continuing with existing dir"
        SOURCE_LABEL="existing dir (skipped clone of $REPO_URL)"
    fi
fi

# ---------------------------------------------------------------------------
# Unified ceremony — idempotent, handles cloned + fresh + re-run cases
# ---------------------------------------------------------------------------

say "Sovereign genesis — check-then-build each component"
say ""

# ---------------------------------------------------------------------------
# Directory structure — mkdir -p is already idempotent
# ---------------------------------------------------------------------------

DEVICE_DIR="$SOVEREIGN_DIR/id/devices/$HOSTNAME"

mkdir -p "$DEVICE_DIR"
mkdir -p "$SOVEREIGN_DIR/trust/bonds"
say "directory structure — present"

# ---------------------------------------------------------------------------
# .gitignore — generated file, always overwrite (not user-edited)
# ---------------------------------------------------------------------------

cat > "$SOVEREIGN_DIR/.gitignore" << 'GITIGNORE'
# SPDX-License-Identifier: AGPL-3.0-or-later
# ~/.koad-io/me/.gitignore
# Controls which files in the sovereign identity repo are tracked vs local-only.
# Tracked: IDENTITY.md, public keys, proofs, declarations.
# Local-only: private keys, device artifacts, .env.

# Private keys — never commit
id/ed25519
id/ecdsa
id/rsa
id/dsa

# Private GPG key
id/gpg.private.asc
id/gpg-revocation.asc

# Per-device private material — never commit
id/devices/*/leaf.private.asc
id/devices/*/device.key
id/devices/*/ed25519

# Old layout artifacts — defensive guards so test files don't leak
id/leaf.private.asc
id/leaf.public.asc
id/device.key
id/device.key.pub

# GPG keyring
keyring/

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
# Private keys — never commit (old layout defensive guards)
ed25519
ecdsa
rsa
dsa
gpg.private.asc
gpg-revocation.asc
leaf.private.asc
leaf.public.asc
device.key
device.key.pub
# SSL legacy artifacts
ssl/
# Per-device private material (covered by parent .gitignore too)
devices/*/leaf.private.asc
devices/*/device.key
devices/*/ed25519
# Keep per-device public sides and kingdom-level public keys
!devices/*/leaf.public.asc
!gpg.public.asc
!master.fingerprint
!label
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
SOVEREIGN_HANDLE=$(ask "Your handle (e.g. koad)" "${KOAD_IO_HANDLE:-}" "" --required --write "$SOVEREIGN_DIR/.env" SOVEREIGN_HANDLE)
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
say "(TLD form: 'kingofalldata.com' requires DNS TXT proof later. Label form: 'kingofalldata' becomes a Keybase team.)"
SOVEREIGN_DOMAIN=$(ask "Kingdom domain (e.g. kingofalldata.com)" "${KOAD_IO_KINGDOM_DOMAIN:-}" "" --required --write "$SOVEREIGN_DIR/.env" SOVEREIGN_DOMAIN)
say "Domain: $SOVEREIGN_DOMAIN"
say ""

# ---------------------------------------------------------------------------
# Domain form detection — VESTA-SPEC-152 §2.1
# TLD form (contains dot): real DNS domain, requires DNS TXT proof for namespace claim.
# Label form (no dot): free-form identifier; becomes a Keybase team name if Keybase is active.
# ---------------------------------------------------------------------------

if [[ "$SOVEREIGN_DOMAIN" == *.* ]]; then
    KINGDOM_FORM="tld"
    ensure_env_line "$SOVEREIGN_DIR/.env" "KINGDOM_FORM" "tld"
    say "Kingdom form: TLD ($SOVEREIGN_DOMAIN)"
    say "You'll need to add a DNS TXT record to verify ownership when you"
    say "go through the namespace claim ceremony. For now, your sovereign"
    say "keypair will be labeled \"$SOVEREIGN_HANDLE @ $SOVEREIGN_DOMAIN\"."
    say ""
else
    KINGDOM_FORM="label"
    ensure_env_line "$SOVEREIGN_DIR/.env" "KINGDOM_FORM" "label"
    say "Kingdom form: label ($SOVEREIGN_DOMAIN)"

    if [ -n "$KB_USERNAME" ] && [ "$SKIP_KEYBASE" -eq 0 ]; then
        # Keybase is present — check team membership
        say "Checking Keybase team '$SOVEREIGN_DOMAIN'..."

        # First: check if the current user is already in this team
        KB_TEAM_JSON=$(keybase team list-memberships --json 2>/dev/null || echo '{"teams":[]}')
        # fq_name for a top-level team is exactly the team name (no dots = top-level)
        if echo "$KB_TEAM_JSON" | grep -q "\"fq_name\":\"${SOVEREIGN_DOMAIN}\""; then
            say "You're already a member of Keybase team '$SOVEREIGN_DOMAIN' — using it as your kingdom container."
        else
            # Not in the team — probe whether the team exists at all
            TEAM_PROBE=$(keybase team api -m "{\"method\": \"list-team-memberships\", \"params\": {\"options\": {\"team\": \"$SOVEREIGN_DOMAIN\"}}}" 2>&1 || true)

            if echo "$TEAM_PROBE" | grep -qi "does not exist"; then
                # Team is available — offer to create it
                say "Team '$SOVEREIGN_DOMAIN' does not exist on Keybase."
                if ask_yn "Create Keybase team '$SOVEREIGN_DOMAIN' now?" "${KOAD_IO_CREATE_KEYBASE_TEAM:-}"; then
                    if keybase team create "$SOVEREIGN_DOMAIN" 2>/dev/null; then
                        say "Created Keybase team: $SOVEREIGN_DOMAIN"
                        say "You are now the owner of keybase://team/$SOVEREIGN_DOMAIN"
                    else
                        say "WARNING: Could not create Keybase team '$SOVEREIGN_DOMAIN'."
                        say "Create manually: keybase team create $SOVEREIGN_DOMAIN"
                    fi
                else
                    say "Skipping team creation. Create later: keybase team create $SOVEREIGN_DOMAIN"
                fi
            elif echo "$TEAM_PROBE" | grep -q '"name"'; then
                # Team exists but user is not a member
                say "WARNING: Team '$SOVEREIGN_DOMAIN' exists on Keybase but you are not a member."
                say "The label '$SOVEREIGN_DOMAIN' is taken on Keybase."
                say "Options:"
                say "  1. Get added to the existing team by its owner."
                say "  2. Choose a different label by re-running: koad-io init sovereign"
                say "Continuing with '$SOVEREIGN_DOMAIN' as your kingdom label — no Keybase team linked."
            else
                # Unexpected response — surface and continue
                say "Could not determine Keybase team status for '$SOVEREIGN_DOMAIN'."
                say "Create manually if desired: keybase team create $SOVEREIGN_DOMAIN"
            fi
        fi
    else
        # No Keybase — just a free-form label
        say "No Keybase detected. '$SOVEREIGN_DOMAIN' is your kingdom label (no team container)."
        say "Add Keybase later and run: keybase team create $SOVEREIGN_DOMAIN"
    fi
    say ""
fi

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
if [ ! -f "$ID_DIR/gpg.public.asc" ] || [ ! -f "$DEVICE_DIR/leaf.private.asc" ] || [ "$FORCEFUL" -eq 1 ]; then

    did "sovereign keypair" "running ceremony via @koad-io/node..."
    say ""

    # ---------------------------------------------------------------------------
    # Step 1 — Entropy source: existing mnemonic or generate fresh
    # The mnemonic (24 words) is the master secret. It never touches disk.
    # ---------------------------------------------------------------------------

    HAVE_EXISTING_MNEMONIC=0
    if ask_yn "Do you have an existing recovery phrase?" "${KOAD_IO_HAVE_EXISTING_MNEMONIC:-}"; then
        HAVE_EXISTING_MNEMONIC=1
    fi

    if [ "$HAVE_EXISTING_MNEMONIC" -eq 1 ]; then

        # Existing mnemonic path — recover
        say ""
        say "  Enter your 24 recovery words, space-separated, on one line."
        say ""
        MNEMONIC_INPUT=""
        _cyan='\033[0;36m'
        _dim='\033[2m'
        _reset='\033[0m'
        _bold='\033[1m'
        while [ -z "$MNEMONIC_INPUT" ]; do
            printf "\n  ${_cyan}▸${_reset} Recovery phrase ${_dim}(input hidden)${_reset}\n    ${_bold}›${_reset} " >&2
            read -rs MNEMONIC_INPUT </dev/tty
            echo "" >&2  # newline after hidden input
            MNEMONIC_INPUT="$(echo "$MNEMONIC_INPUT" | tr -s ' ' | sed 's/^ //;s/ $//')"
            if [ -z "$MNEMONIC_INPUT" ]; then
                printf "  ${_dim}(required — please enter your recovery phrase)${_reset}\n" >&2
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

        # If the cloned repo carries a known master.fingerprint, verify the
        # mnemonic derives to the same master — wrong mnemonic = hard stop.
        if [ -f "$SOVEREIGN_DIR/id/master.fingerprint" ]; then
            EXPECTED_FPR=$(cat "$SOVEREIGN_DIR/id/master.fingerprint")
            DERIVED_FPR=$(echo "$CEREMONY_JSON" | jq -r '.masterFingerprint')
            if [ "$EXPECTED_FPR" != "$DERIVED_FPR" ]; then
                die "Mnemonic mismatch — derived master fingerprint ($DERIVED_FPR) does not match repo's id/master.fingerprint ($EXPECTED_FPR)"
            fi
            say "  Mnemonic verified — master fingerprint matches repo"
        fi

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
    DEVICE_KEY=$(echo "$CEREMONY_JSON" | jq -r '.deviceKey')

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

    # Per-kingdom files (skip if already committed — deterministic from mnemonic)
    [ ! -f "$ID_DIR/gpg.public.asc" ]        && printf '%s' "$MASTER_PUBLIC_ARMOR"  > "$ID_DIR/gpg.public.asc"
    [ ! -f "$ID_DIR/master.fingerprint" ]    && printf '%s' "$MASTER_FINGERPRINT"   > "$ID_DIR/master.fingerprint"
    [ ! -f "$ID_DIR/label" ]                 && printf '%s' "$SOVEREIGN_LABEL"      > "$ID_DIR/label"

    # Per-device files (always fresh for this device)
    printf '%s' "$LEAF_PUBLIC_ARMOR"    > "$DEVICE_DIR/leaf.public.asc"
    printf '%s' "$LEAF_PRIVATE_ARMOR"   > "$DEVICE_DIR/leaf.private.asc"
    printf '%s' "$DEVICE_KEY"           > "$DEVICE_DIR/device.key"
    chmod 600 "$DEVICE_DIR/device.key" "$DEVICE_DIR/leaf.private.asc"

    ensure_env_line "$SOVEREIGN_DIR/.env" "SOVEREIGN_LABEL" "$SOVEREIGN_LABEL"

    say ""
    say "generated: $ID_DIR/gpg.public.asc (master fingerprint: ${MASTER_FINGERPRINT:(-16)})"
    say "generated: $DEVICE_DIR/leaf.public.asc (leaf fingerprint: ${LEAF_FINGERPRINT:(-16)})"
    say "generated: $DEVICE_DIR/leaf.private.asc (encrypted — passphrase is device.key)"
    say "generated: $DEVICE_DIR/device.key (gitignored — machine-local, never commit)"
    say "generated: $ID_DIR/master.fingerprint"
    say "generated: $ID_DIR/label ($SOVEREIGN_LABEL)"
    say "device: $HOSTNAME"

    # ---------------------------------------------------------------------------
    # Step 5 — Zero sensitive vars from shell memory
    # SOVEREIGN_LABEL is NOT unset — it's a non-sensitive reference, needed below
    # ---------------------------------------------------------------------------
    unset MNEMONIC CEREMONY_JSON DEVICE_KEY MASTER_PUBLIC_ARMOR
    unset LEAF_PUBLIC_ARMOR LEAF_PRIVATE_ARMOR MASTER_FINGERPRINT LEAF_FINGERPRINT
    unset MNEMONIC_WORDS

else
    skip "id/gpg.public.asc (sovereign keypair)"
    skip "id/devices/$HOSTNAME/leaf.private.asc"
    # Load label from disk (idempotent path)
    SOVEREIGN_LABEL="${SOVEREIGN_LABEL:-}"
    [ -z "$SOVEREIGN_LABEL" ] && [ -f "$ID_DIR/label" ] && SOVEREIGN_LABEL=$(cat "$ID_DIR/label")
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

[ -f "$SOVEREIGN_DIR/IDENTITY.md" ]         && git -C "$SOVEREIGN_DIR" add "$SOVEREIGN_DIR/IDENTITY.md" 2>/dev/null || true
[ -f "$ID_DIR/gpg.public.asc" ]             && git -C "$SOVEREIGN_DIR" add "$ID_DIR/gpg.public.asc" 2>/dev/null || true
[ -f "$ID_DIR/master.fingerprint" ]         && git -C "$SOVEREIGN_DIR" add "$ID_DIR/master.fingerprint" 2>/dev/null || true
[ -f "$ID_DIR/label" ]                      && git -C "$SOVEREIGN_DIR" add "$ID_DIR/label" 2>/dev/null || true
[ -f "$DEVICE_DIR/leaf.public.asc" ]        && git -C "$SOVEREIGN_DIR" add "$DEVICE_DIR/leaf.public.asc" 2>/dev/null || true

if ! git -C "$SOVEREIGN_DIR" diff --cached --quiet 2>/dev/null; then
    git -C "$SOVEREIGN_DIR" commit -m "kingdom genesis — $HOSTNAME device leaf registered" 2>/dev/null
    say "committed staged files"
else
    skip "git commit (nothing new to stage)"
fi

# ---------------------------------------------------------------------------
# Detect what origin actually points to (symmetric remote handling)
# Must run after the initial clone/init so origin reflects the real URL.
# Cases: none (fresh genesis), keybase, github, gitlab, other
# ---------------------------------------------------------------------------

ORIGIN_URL=$(git -C "$SOVEREIGN_DIR" remote get-url origin 2>/dev/null || echo "")

ORIGIN_TYPE="none"
if [[ "$ORIGIN_URL" == keybase://* ]]; then
    ORIGIN_TYPE="keybase"
elif [[ "$ORIGIN_URL" == *github.com* ]]; then
    ORIGIN_TYPE="github"
elif [[ "$ORIGIN_URL" == *gitlab.com* ]]; then
    ORIGIN_TYPE="gitlab"
elif [ -n "$ORIGIN_URL" ]; then
    ORIGIN_TYPE="other"
fi

# ---------------------------------------------------------------------------
# Post-genesis: remote setup — symmetric based on what origin actually is
#
# Case A (none):   fresh genesis — offer Keybase as origin, then GitHub mirror
# Case B (keybase): origin IS Keybase — offer GitHub as secondary mirror
# Case C (github):  origin IS GitHub — offer Keybase as secondary mirror
# Case D (gitlab/other): offer both Keybase and GitHub as secondary mirrors
# ---------------------------------------------------------------------------

# Case A / Case D (Keybase): set up or offer Keybase
if [ "$ORIGIN_TYPE" = "none" ] || [ "$ORIGIN_TYPE" = "gitlab" ] || [ "$ORIGIN_TYPE" = "other" ]; then
    if [ -n "$KB_USERNAME" ] && [ "$SKIP_KEYBASE" -eq 0 ]; then
        KB_REMOTE="keybase://private/$KB_USERNAME/me"
        REMOTE_NAME_KB="origin"
        [ "$ORIGIN_TYPE" != "none" ] && REMOTE_NAME_KB="keybase"

        if git -C "$SOVEREIGN_DIR" remote get-url "$REMOTE_NAME_KB" >/dev/null 2>&1; then
            skip "Keybase remote ($REMOTE_NAME_KB already configured)"
        else
            did "Keybase remote" "adding $REMOTE_NAME_KB → $KB_REMOTE"

            # Check if the 'me' repo exists in Keybase; create it if not
            say "Checking Keybase for repo 'me'..."
            KB_REPO_EXISTS=0
            if keybase git list 2>/dev/null | grep -q "^  me "; then
                KB_REPO_EXISTS=1
            fi

            if [ "$KB_REPO_EXISTS" -eq 0 ]; then
                say "Repo doesn't exist — creating: keybase git create me"
                if keybase git create me 2>/dev/null; then
                    say "Repo created."
                else
                    say "Could not create Keybase repo (is Keybase running and logged in as $KB_USERNAME?)."
                    say "Push manually once Keybase is running:"
                    say "  keybase git create me"
                    say "  git -C ~/.koad-io/me remote add $REMOTE_NAME_KB $KB_REMOTE"
                    say "  git -C ~/.koad-io/me push -u $REMOTE_NAME_KB main"
                    say ""
                    KB_USERNAME=""
                fi
            fi

            if [ -n "$KB_USERNAME" ]; then
                git -C "$SOVEREIGN_DIR" remote add "$REMOTE_NAME_KB" "$KB_REMOTE" 2>/dev/null
                say "Remote: $REMOTE_NAME_KB → $KB_REMOTE"
                say ""
                say "Pushing to Keybase..."
                say "(Make sure Keybase is running and you're logged in as your handle: $KB_USERNAME)"
                if git -C "$SOVEREIGN_DIR" push -u "$REMOTE_NAME_KB" main 2>/dev/null; then
                    say "Pushed to Keybase. Your sovereign identity is backed up."
                else
                    say "Push failed — run manually once Keybase is running:"
                    say "  git -C ~/.koad-io/me push -u $REMOTE_NAME_KB main"
                fi
            fi
        fi
        say ""
    fi
fi

# Case C (github origin): offer Keybase as secondary mirror
if [ "$ORIGIN_TYPE" = "github" ]; then
    if [ -n "$KB_USERNAME" ] && [ "$SKIP_KEYBASE" -eq 0 ]; then
        KB_REMOTE="keybase://private/$KB_USERNAME/me"
        say ""
        if ask_yn "Would you like to also back up to Keybase?" "${KOAD_IO_SETUP_KEYBASE_MIRROR:-}"; then
            if git -C "$SOVEREIGN_DIR" remote get-url keybase >/dev/null 2>&1; then
                skip "Keybase remote (keybase already configured)"
            else
                did "Keybase remote" "adding keybase → $KB_REMOTE"

                say "Checking Keybase for repo 'me'..."
                KB_REPO_EXISTS=0
                if keybase git list 2>/dev/null | grep -q "^  me "; then
                    KB_REPO_EXISTS=1
                fi

                if [ "$KB_REPO_EXISTS" -eq 0 ]; then
                    say "Repo doesn't exist — creating: keybase git create me"
                    if keybase git create me 2>/dev/null; then
                        say "Repo created."
                    else
                        say "Could not create Keybase repo (is Keybase running and logged in as $KB_USERNAME?)."
                        say "Push manually once Keybase is running:"
                        say "  keybase git create me"
                        say "  git -C ~/.koad-io/me remote add keybase $KB_REMOTE"
                        say "  git -C ~/.koad-io/me push -u keybase main"
                        say ""
                        KB_USERNAME=""
                    fi
                fi

                if [ -n "$KB_USERNAME" ]; then
                    git -C "$SOVEREIGN_DIR" remote add keybase "$KB_REMOTE" 2>/dev/null
                    say "Remote: keybase → $KB_REMOTE"
                    say ""
                    say "Pushing to Keybase..."
                    say "(Make sure Keybase is running and you're logged in as your handle: $KB_USERNAME)"
                    if git -C "$SOVEREIGN_DIR" push -u keybase main 2>/dev/null; then
                        say "Pushed to Keybase. Your sovereign identity is backed up."
                    else
                        say "Push failed — run manually once Keybase is running:"
                        say "  git -C ~/.koad-io/me push -u keybase main"
                    fi
                fi
            fi
        else
            say "Skipping Keybase mirror. Add it later with:"
            say "  git -C ~/.koad-io/me remote add keybase keybase://private/$KB_USERNAME/me"
        fi
        say ""
    fi
fi

# Case A / Case B / Case D (GitHub): offer GitHub as secondary mirror (not when origin IS github)
if [ "$ORIGIN_TYPE" != "github" ]; then
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
fi

# ---------------------------------------------------------------------------
# Genesis confirmation — reflect actual remote state
# ---------------------------------------------------------------------------

# Re-read origin after remote setup (may have just been added)
ORIGIN_URL_FINAL=$(git -C "$SOVEREIGN_DIR" remote get-url origin 2>/dev/null || echo "none")
KB_REMOTE_FINAL=$(git -C "$SOVEREIGN_DIR" remote get-url keybase 2>/dev/null || echo "")
GH_REMOTE_FINAL=$(git -C "$SOVEREIGN_DIR" remote get-url github 2>/dev/null || echo "")

say ""
say "================================================================================"
say " Kingdom genesis complete."
say "================================================================================"
say ""
say " The root of trust exists."
say " Key label: ${SOVEREIGN_LABEL:-(unknown — run again to generate)}"
say " Device:    $HOSTNAME"
say " Source:    $SOURCE_LABEL"
say ""
say " Recovery phrase: WRITE IT DOWN. Every word. In order. On paper."
say "   The 24 words are the only way to recover your master key."
say ""
say " Origin:    $ORIGIN_URL_FINAL"
if [ -n "$KB_REMOTE_FINAL" ]; then
    say " Mirror:    $KB_REMOTE_FINAL"
fi
if [ -n "$GH_REMOTE_FINAL" ]; then
    say " Mirror:    $GH_REMOTE_FINAL"
fi
say ""
say "   To recover on a new machine:"
say "     koad-io init sovereign $ORIGIN_URL_FINAL"
say "   Then enter your 24 words to re-derive the master."
say ""

say "IMPORTANT: ~/.koad-io/me/ is its own git repo, not part of the koad-io"
say "framework repo. Your keys and IDENTITY.md are yours, not ours."
say ""

source "$HOME/.koad-io/helpers/discovery.sh" 2>/dev/null && _koad_io_hint
