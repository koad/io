#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# koad-io gestate ensure <name> — fill the missing pieces of an EXISTING entity
#
# WHY THIS EXISTS (2026-10-31)
# ----------------------------
# `gestate entity` hard-refuses an existing directory, and it should keep
# refusing: gestation is a sovereign act with a sigchain trail. But entities in
# the kingdom were born before the Nostr identity was part of gestation, so every
# one of them has an id/ directory and none has a publishable npub. Repairing
# that by hand means touching key material by hand, which is exactly the failure
# mode the August 2026 leak taught us to avoid.
#
# So: a sibling sub-command that runs ONLY the idempotent subset. `entity` is a
# birth; `ensure` is a maintenance pass. It may be run on every entity, in a
# loop, forever, and it converges.
#
#   piece                          behaviour here
#   entity dir + standard subdirs  create if missing, never delete
#   .env                           add missing keys; never rewrite a value
#   passenger.json                 create if missing; never overwrite
#   id/nostr/                      mint if absent; publish the public half of
#                                  an existing key; report `present` if whole
#   .gitignore (nostr contract)    append the allowlines if absent
#   GPG / SSH / SSL keys           REPORT ONLY — never regenerated
#   sigchain entries               NEVER touched (that is `gestate entity`)
#
# Hard rules, inherited from the brief that specified this:
#   1. never overwrite an existing key — present means done; rotation is a
#      deliberate separate act
#   2. never print or log a secret — the npub is public and is the only identity
#      value that gets echoed
#   3. zero new dependencies (bash + jq + node's own crypto)
#   4. never fail a gestation over nostr minting — warn and continue
#
# One line per piece: added / present / skipped (reason).
#
# Ref: VESTA-SPEC-221 §4 — Path B independent keypair, rotation as a separate act
# Ref: VESTA-SPEC-175 §7 — sovereign-signed entity key flow
# Ref: ~/.koad-io/commands/gestate/entity/nostr-mint.mjs

set -euo pipefail

# Single reader for .env values — see helpers/env.sh for the contract.
source "$HOME/.koad-io/helpers/env.sh"

say()  { echo "[ensure] $*"; }
warn() { echo "[ensure] WARNING: $*" >&2; }
die()  { echo "[ensure] ERROR: $*" >&2; exit 1; }

added()   { echo "[ensure] added:   $*"; ADDED=$((ADDED + 1)); }
present() { echo "[ensure] present: $*"; PRESENT=$((PRESENT + 1)); }
skipped() { echo "[ensure] skipped: $*"; SKIPPED=$((SKIPPED + 1)); }
ADDED=0; PRESENT=0; SKIPPED=0

_usage() {
    cat <<'USAGE'
koad-io gestate ensure <name> — fill the missing pieces of an existing entity

Usage:
  koad-io gestate ensure <name>          Repair gaps; safe to run repeatedly

What it does (idempotent subset only):
  - creates missing standard directories
  - adds missing .env keys (never rewrites an existing value)
  - creates passenger.json if absent (never overwrites)
  - mints the Nostr keypair if absent; publishes npub + pubkey.hex for an
    existing crown.nsec; reports `present` when already complete
  - appends the SPEC-221 Nostr lines to .gitignore if absent

What it never does:
  - regenerate or rotate GPG, SSH or SSL keys (reported, never touched)
  - touch sigchain entries (that is `koad-io gestate entity`)
  - overwrite an existing key, .env value, or passenger.json
  - print or log a secret. Only the npub is echoed — it is public.

Name rules: 3–12 lowercase letters. `me` is reserved.

Exit codes: 0 converged (with or without changes) · 1 usage error / no such entity.
USAGE
}

# ---------------------------------------------------------------------------
# Pre-flight
# ---------------------------------------------------------------------------

ENTITY_NAME="${1:-}"

case "$ENTITY_NAME" in
    ""|-h|--help|help)
        _usage
        [[ -z "$ENTITY_NAME" ]] && exit 1
        exit 0
        ;;
    --*)
        die "expected an entity name, got a flag: $ENTITY_NAME"
        ;;
esac

if [ "$ENTITY_NAME" = "me" ]; then
    die "'me' is reserved — ~/.koad-io/me/ is the sovereign. Use another name."
fi

if ! [[ "$ENTITY_NAME" =~ ^[a-z]{3,12}$ ]]; then
    die "Entity name must be 3-12 lowercase letters with no hyphens, underscores, or digits. Get: '$ENTITY_NAME'"
fi

ENTITY_DIR="$HOME/.$ENTITY_NAME"
HOST=$(hostname -s)

# Honest refusal: no such entity, and nothing was created on the way to saying
# so. `ensure` repairs; it does not conceive.
if [ ! -d "$ENTITY_DIR" ]; then
    die "No entity at $ENTITY_DIR — nothing to ensure. Create it with: koad-io gestate entity $ENTITY_NAME"
fi

say ""
say "Ensuring entity: $ENTITY_NAME ($ENTITY_DIR)"
say ""

# ---------------------------------------------------------------------------
# Piece: standard directories
# ---------------------------------------------------------------------------

MISSING_DIRS=()
for d in id trust/bonds memories specs projects commands hooks; do
    [ -d "$ENTITY_DIR/$d" ] || MISSING_DIRS+=("$d")
done

if [ "${#MISSING_DIRS[@]}" -gt 0 ]; then
    for d in "${MISSING_DIRS[@]}"; do
        mkdir -p "$ENTITY_DIR/$d"
    done
    # id/ holds key material — gestate entity creates it mode 700
    chmod 700 "$ENTITY_DIR/id" 2>/dev/null || true
    added "directories (${MISSING_DIRS[*]})"
else
    present "directories"
fi

if [ -d "$ENTITY_DIR/id/devices/$HOST" ]; then
    present "id/devices/$HOST (this host's device leaf dir)"
else
    skipped "id/devices/$HOST (no leaf on this host — a device leaf is minted by 'gestate entity', not repaired)"
fi

# ---------------------------------------------------------------------------
# Piece: .env — add missing keys only
# ---------------------------------------------------------------------------

ENV_FILE="$ENTITY_DIR/.env"

# Display name: prefer what the entity already declares, else the capitalized
# handle. Never invent a role or a mother — those are identity values.
DISPLAY_NAME=""
if [ -f "$ENTITY_DIR/passenger.json" ] && command -v jq >/dev/null 2>&1; then
    DISPLAY_NAME=$(jq -r '.name // empty' "$ENTITY_DIR/passenger.json" 2>/dev/null || true)
fi
if [ -z "$DISPLAY_NAME" ]; then
    DISPLAY_NAME="$(echo "${ENTITY_NAME:0:1}" | tr '[:lower:]' '[:upper:]')${ENTITY_NAME:1}"
fi

# §3.4 — a step that cannot yield a domain does not resolve. An empty value, a
# value with no domain part, or a domain containing a space or a '/' is a FAILED
# step: fall through to the next one, never terminate the chain on a malformed
# value. Returns nothing when the candidate is not a domain.
_email_domain_of() {
    local v="${1:-}" d
    [ -n "$v" ] || return 0
    case "$v" in
        *@*) d="${v##*@}" ;;
        *)   d="$v" ;;
    esac
    case "$d" in
        ""|*" "*|*/*) return 0 ;;
    esac
    printf '%s\n' "$d"
}

EMAIL_DOMAIN="$(_email_domain_of "${KOAD_IO_EMAIL_DOMAIN:-}")"
if [ -z "$EMAIL_DOMAIN" ] && [ -f "$ENV_FILE" ]; then
    EMAIL_DOMAIN="$(_email_domain_of "$(env_value "$ENV_FILE" GIT_AUTHOR_EMAIL || true)")"
fi
if [ -z "$EMAIL_DOMAIN" ] && [ -f "${KOAD_IO_HOME:-$HOME/.koad-io}/me/.env" ]; then
    EMAIL_DOMAIN="$(_email_domain_of "$(env_value "${KOAD_IO_HOME:-$HOME/.koad-io}/me/.env" SOVEREIGN_DOMAIN || true)")"
fi

# §3.4 — the chain terminates at <entity>.invalid, never at a domain this machine
# does not own. `.invalid` is RFC 2606 reserved: unroutable by construction, and
# legible as absent in a way an empty string is not. Git cannot be authorless
# (§3.6.2), so omission is not available here.
if [ -z "$EMAIL_DOMAIN" ]; then
    EMAIL_DOMAIN="${ENTITY_NAME}.invalid"
    say "note: no email domain resolved; using $EMAIL_DOMAIN"
    say "      (RFC 2606 reserved — unroutable by construction, and never a claim about"
    say "      a domain this machine does not own.)"
    say "      Repair: set KOAD_IO_EMAIL_DOMAIN, then correct GIT_AUTHOR_EMAIL in $ENV_FILE"
fi

# Who is this entity's CREATOR? §3.2: the AUTHORIZING PRINCIPAL — the sovereign
# under whose sigchain the genesis is recorded — and nobody else. It is NOT the
# entity that ran this command: the instrument is GESTATED_BY, and ensure does
# not write that either. Resolved from SOVEREIGN_HANDLE in the sovereign's .env,
# and if nothing resolves there the key is omitted rather than guessed.
#
# The hardcoded builder name this replaces declared OUR builder the creator of
# every newborn on every machine (valhalla, 2026-11-05).
CREATOR=""
if [ -f "${KOAD_IO_HOME:-$HOME/.koad-io}/me/.env" ]; then
    CREATOR=$(env_value "${KOAD_IO_HOME:-$HOME/.koad-io}/me/.env" SOVEREIGN_HANDLE || true)
fi

# Structural keys only. CREATOR / MOTHER / ROLE / GESTATED_AT are deliberately
# absent: they record identity decisions this command must not guess, and a
# maintenance pass that invents a parentage claim spreads it across every entity
# it touches (§3.6.1). GIT_AUTHOR_EMAIL stays — git cannot be authorless (§3.6.2).
ENV_PAIRS=(
    "ENTITY=$ENTITY_NAME"
    "ENTITY_DIR=$ENTITY_DIR"
    "ENTITY_HOME=$ENTITY_DIR"
    "GIT_AUTHOR_NAME=$DISPLAY_NAME"
    "GIT_COMMITTER_NAME=$DISPLAY_NAME"
    "GIT_AUTHOR_EMAIL=${ENTITY_NAME}@${EMAIL_DOMAIN}"
    "GIT_COMMITTER_EMAIL=${ENTITY_NAME}@${EMAIL_DOMAIN}"
)
ENV_PAIRS+=(
    "KOAD_IO_HOME_MACHINE=$HOST"
    "KOAD_IO_EMIT=1"
    "KOAD_IO_QUIET=0"
)

ENV_ADDED=()
CREATED_ENV=0

if [ ! -f "$ENV_FILE" ]; then
    cat > "$ENV_FILE" << ENVEOF
# SPDX-License-Identifier: AGPL-3.0-or-later
# Entity .env — created by koad-io gestate ensure (SPEC-002 v1.3)
# This file is gitignored. It contains entity identity config for this machine.
ENVEOF
    CREATED_ENV=1
fi

for pair in "${ENV_PAIRS[@]}"; do
    key="${pair%%=*}"
    if ! grep -qE "^${key}=" "$ENV_FILE" 2>/dev/null; then
        printf '%s\n' "$pair" >> "$ENV_FILE"
        ENV_ADDED+=("$key")
    fi
done

# §3.6.3 — an existing identity value is reported, never rewritten and never
# silently kept. `ensure` runs in loops; a loop is the right place to SURFACE a
# corpus-wide defect and the wrong place to write one. Identity is repaired
# consciously, one entity at a time (§3.7) — there is no repair verb yet.
if [ -f "$ENV_FILE" ]; then
    _existing_creator=$(env_value "$ENV_FILE" CREATOR || true)
    if [ -n "$_existing_creator" ]; then
        if [ -z "$CREATOR" ]; then
            skipped "CREATOR (existing value '$_existing_creator' has no resolvable input — this command does not rewrite identity values; see VESTA-SPEC-243 §3)"
        elif [ "$_existing_creator" != "$CREATOR" ]; then
            skipped "CREATOR (existing value '$_existing_creator' differs from the resolved sovereign '$CREATOR' — not rewritten; repair by hand with the sovereign present)"
        fi
    fi
fi

if [ "${#ENV_ADDED[@]}" -gt 0 ]; then
    if [ "$CREATED_ENV" = "1" ]; then
        added ".env (created, ${#ENV_ADDED[@]} keys)"
    else
        added ".env (+${#ENV_ADDED[@]} keys: ${ENV_ADDED[*]})"
    fi
else
    present ".env"
fi

# ---------------------------------------------------------------------------
# Piece: passenger.json — create if missing, never overwrite
# ---------------------------------------------------------------------------

PASSENGER="$ENTITY_DIR/passenger.json"

if [ -f "$PASSENGER" ]; then
    present "passenger.json"
else
    NOW_ISO_JSON=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    jq -n \
        --arg handle "$ENTITY_NAME" \
        --arg name "$DISPLAY_NAME" \
        --arg created "$NOW_ISO_JSON" \
        --arg creator "$CREATOR" \
        '{
            handle: $handle,
            name: $name,
            role: "",
            status: "gestated",
            created_at: $created,
            avatar: null,
            buttons: []
        }
        | .created_by = (if $creator == "" then null else $creator end)' > "$PASSENGER"
    added "passenger.json (created)"
fi

# ---------------------------------------------------------------------------
# Piece: id/nostr/ — mint if absent, publish the public half, or report present
# ---------------------------------------------------------------------------

NOSTR_NPUB=""
NOSTR_MINT_SCRIPT="$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/../entity/nostr-mint.mjs"

if [ ! -f "$NOSTR_MINT_SCRIPT" ]; then
    skipped "id/nostr/ (nostr-mint.mjs not found at $NOSTR_MINT_SCRIPT)"
elif ! command -v node >/dev/null 2>&1; then
    skipped "id/nostr/ (no node — nothing minted)"
else
    NOSTR_JSON=""
    NOSTR_RC=0
    NOSTR_JSON=$(node "$NOSTR_MINT_SCRIPT" --entity-dir "$ENTITY_DIR" 2>/dev/null) || NOSTR_RC=$?

    NOSTR_STATUS=""
    if [ -n "$NOSTR_JSON" ]; then
        NOSTR_STATUS=$(echo "$NOSTR_JSON" | jq -r '.status // empty')
        NOSTR_NPUB=$(echo "$NOSTR_JSON" | jq -r '.npub // empty')
    fi

    case "$NOSTR_STATUS" in
        minted)
            added "id/nostr/ (minted a fresh keypair; crown.nsec mode 600)"
            ;;
        published)
            added "id/nostr/ (published npub + pubkey.hex for the existing key — secret untouched)"
            ;;
        present)
            present "id/nostr/"
            ;;
        mismatch)
            skipped "id/nostr/ (npub or pubkey.hex disagrees with crown.nsec — NOT repaired; rotation is a deliberate act)"
            warn "id/nostr/ holds contradictory artifacts. Inspect them by hand; this command will not pick a winner."
            ;;
        *)
            skipped "id/nostr/ (mint failed, exit $NOSTR_RC — run 'koad-io gestate entity $ENTITY_NAME' diagnostics)"
            ;;
    esac

    [ -n "$NOSTR_NPUB" ] && say "           npub: $NOSTR_NPUB"
fi

# ---------------------------------------------------------------------------
# Piece: .gitignore — the SPEC-221 (VESTA-SPEC-221) nostr contract
# ---------------------------------------------------------------------------
# Deny the secret, track the provable half. Without these lines a freshly
# minted npub would be ignored and could never be committed — which defeats the
# point of minting it. Appended only when absent; no existing line is rewritten.

GI_CHANGED=0
ROOT_GI="$ENTITY_DIR/.gitignore"
ID_GI="$ENTITY_DIR/id/.gitignore"

if [ ! -f "$ROOT_GI" ]; then
    printf '# SPDX-License-Identifier: AGPL-3.0-or-later\n' > "$ROOT_GI"
fi

# A bare `id/` rule makes every !id/… negation inert — git will not re-include a
# file whose parent directory is excluded. That repair belongs to
# `koad-io init <name>`; say so rather than pretending the contract holds.
BARE_ID_RULE=0
if grep -qxF 'id/' "$ROOT_GI" 2>/dev/null; then
    BARE_ID_RULE=1
fi

if ! grep -qxF '!id/nostr/pubkey.hex' "$ROOT_GI" 2>/dev/null; then
    cat >> "$ROOT_GI" << 'GITIGNORE'

# Nostr identity — VESTA-SPEC-221 (Path B: an independent secp256k1 keypair)
# The secret is a bearer token: never tracked. The public half MUST be tracked —
# "it's meant to be signed and provable, not hidden". Anyone who clones this
# repo has to be able to read the npub and verify it against the key that signs.
id/nostr/crown.nsec
!id/nostr/
id/nostr/*
!id/nostr/npub
!id/nostr/pubkey.hex
GITIGNORE
    GI_CHANGED=1
fi

if [ ! -f "$ID_GI" ]; then
    printf '# SPDX-License-Identifier: AGPL-3.0-or-later\n' > "$ID_GI"
fi

if ! grep -qxF '!nostr/pubkey.hex' "$ID_GI" 2>/dev/null; then
    cat >> "$ID_GI" << 'GITIGNORE'

# Nostr identity — SPEC-221. The secret stays here; the provable half does not.
nostr/crown.nsec
!nostr/
nostr/*
!nostr/npub
!nostr/pubkey.hex
GITIGNORE
    GI_CHANGED=1
fi

if [ "$GI_CHANGED" = "1" ]; then
    added ".gitignore (SPEC-221 nostr contract)"
else
    present ".gitignore (SPEC-221 nostr contract)"
fi

if [ "$BARE_ID_RULE" = "1" ]; then
    skipped "gitignore whitelist (bare 'id/' rule makes every !id/… negation inert — repair with: koad-io init $ENTITY_NAME)"
fi

# ---------------------------------------------------------------------------
# Piece: the contract actually holds — assert it, do not assume it
# ---------------------------------------------------------------------------

if git -C "$ENTITY_DIR" rev-parse --git-dir >/dev/null 2>&1; then
    # check-ignore exits 0 when the path IS ignored. Wrapped in a helper so the
    # polarity is stated once instead of being re-derived at three call sites.
    # --no-index: ask what the PATTERNS say, not what the index already holds.
    # Without it a tracked npub always answers "not ignored" and a broken
    # whitelist would pass the assertion unnoticed.
    _is_ignored() { git -C "$ENTITY_DIR" check-ignore --no-index -q "$1"; }

    CROWN_IGNORED=0
    NPUB_TRACKABLE=0
    PUBHEX_TRACKABLE=0

    if _is_ignored 'id/nostr/crown.nsec';   then CROWN_IGNORED=1;   fi
    if ! _is_ignored 'id/nostr/npub';       then NPUB_TRACKABLE=1;  fi
    if ! _is_ignored 'id/nostr/pubkey.hex'; then PUBHEX_TRACKABLE=1; fi

    if [ "$CROWN_IGNORED" = "0" ]; then
        skipped "git contract: id/nostr/crown.nsec is NOT ignored — STOP, the secret is stageable"
    elif [ "$NPUB_TRACKABLE" = "1" ] && [ "$PUBHEX_TRACKABLE" = "1" ]; then
        present "git contract (npub + pubkey.hex trackable, crown.nsec denied)"
    else
        skipped "git contract: the public half is still ignored (fix the .gitignore whitelist before committing)"
    fi
else
    skipped "git contract (not a git repository yet)"
fi

# ---------------------------------------------------------------------------
# Piece: key material — report only, never regenerate
# ---------------------------------------------------------------------------

if [ -f "$ENTITY_DIR/id/entity.public.asc" ]; then
    present "GPG entity public key (id/entity.public.asc)"
else
    skipped "GPG entity key (missing — report only; a key is minted by 'gestate entity', never repaired here)"
fi

if [ -f "$ENTITY_DIR/id/devices/$HOST/leaf.private.asc" ]; then
    present "GPG device leaf for $HOST"
else
    skipped "GPG device leaf for $HOST (missing — report only)"
fi

if [ -d "$ENTITY_DIR/ssl" ]; then
    present "ssl/ key material (report only, untouched)"
else
    skipped "ssl/ (absent — report only, untouched)"
fi

# ---------------------------------------------------------------------------
# Piece: sigchain — a maintenance pass never signs
# ---------------------------------------------------------------------------

skipped "sigchain entries (never touched by ensure — that is 'gestate entity')"

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

say ""
if [ "$ADDED" = "0" ]; then
    say "ensure complete: $ENTITY_NAME — nothing needed doing ($PRESENT present, $SKIPPED skipped)"
else
    say "ensure complete: $ENTITY_NAME — $ADDED added, $PRESENT present, $SKIPPED skipped"
fi
say ""

exit 0
