#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# koad-io init <entity> [<repo-url>] — state-aware idempotent entity init
# koad-io init sovereign              — kingdom genesis (delegated to sovereign/command.sh)
#
# Usage:
#   koad-io init sovereign              # Kingdom genesis — see init/sovereign/command.sh
#   koad-io init entity <name>          # Canonical form — state-detect + run the cell
#   koad-io init <name>                 # Compatibility form of the above (same code path)
#   koad-io init <name> <url>           # Clone entity repo then state-detect
#   koad-io init <name> --forceful      # Rotate what is mine: succession, new key + leaf
#   koad-io init <name> --adopt         # Adopt the on-disk key (only when it is not disproven)
#   koad-io init <name> --re-seed       # Replace an entity key that is NOT this handle's key
#
# VESTA-SPEC-240 §13 — four states, three flags, no silent cells:
#
#   Every invocation resolves to ONE state (filesystem facts only — a flag never
#   chooses the state) and ONE flag, and prints exactly one leading line:
#
#       [init] <state>/<flag-set>: did|no-op|warned|refused — <what happened>
#
#   `did` / `no-op` / `warned` exit 0 and say what changed (or why nothing did).
#   `refused` exits 2, names the reason and the exact command that would work,
#   and writes NOTHING. Exit 1 is reserved for tooling failure.
#   Two or more of --forceful/--adopt/--re-seed together are refused (§13.6):
#   the three are distinct intents and no precedence order exists. A <flag-set>
#   is emitted in the canonical order --forceful → --adopt → --re-seed, joined
#   by `+`, whatever order the operator typed (§13.2).
#
#   States (§13.1):
#     3   legacy keys, no SPEC-175 entity key   → migrate (key event: genesis|succession)
#     4/5 no key material                       → create (provisional without a sovereign)
#     6   entity key + a leaf for THIS device   → report/audit; --forceful rotates
#     7   entity key, no leaf for THIS device   → paternity gate, then adopt or replace
#
# Key events (SPEC-240 §5 / W-2): a handle the chain already resolves gets a
# `koad.entity.key-succession`; a handle the chain does not know gets a
# `koad.entity.genesis`. A second genesis for a known handle is never filed.
#
# Paternity (SPEC-240 §8) is the sovereign chain's EFFECTIVE key, not "any
# genesis that names this key":
#
#   proven        the disk key IS the chain's effective key for this handle.
#   disproven     the chain resolves a different key. Current-state evidence: it
#                 licenses succession, not deletion and not adoption.
#   unverifiable  no sovereign, no/unreadable/empty chain, no key-affecting entry
#                 for this handle, or an unreadable disk key. Absence is not
#                 disproof (P-2), so nothing is guessed.
#
#   --adopt is the explicit escape hatch ("yes, this key"). It is never implicit,
#   and never over a `disproven` verdict (SPEC-175 §4.4, SPEC-240 K-3).
#
# Pre-flight checks (entity path):
#   - Sovereign at ~/.koad-io/me/ with a device leaf for $HOSTNAME enables signing.
#     Creation (3, 4/5, and 7 --re-seed unverifiable) proceeds provisionally without
#     one; rotation, replacement and leaf authorization are refused (SPEC-240 §13.7b / W-5).
#     The discriminator is resolution, not the state or flag: a chain that already
#     resolves an effective key for the handle makes the next key event a succession.
#
# After state resolution:
#   - Launcher at ~/.koad-io/bin/<entity> is always ensured
#   - .env is scaffolded from kingdom defaults if missing
#   - AGENTS.md is regenerated from KOAD_IO.md → ENTITY.md → PRIMER.md when
#     those sources change (byte-identical output is not rewritten)
#
# Ref: VESTA-SPEC-240 — entity key succession, effective-key resolution, the matrix
# Ref: VESTA-SPEC-175 §6 — entity key shape
# Ref: VESTA-SPEC-149 — master/leaf split

set -euo pipefail

# Single reader for .env values — see helpers/env.sh for the contract.
source "$HOME/.koad-io/helpers/env.sh"

# ---------------------------------------------------------------------------
# Route: namespace words
# ---------------------------------------------------------------------------
# `koad-io init entity <name>` is the canonical form the framework documents. The
# umbrella shim routes it here already; this guard makes the subcommand behave the
# same when invoked directly, and stops a stray `entity` from being read as an
# entity named "entity" (which would aim at ~/.entity).

_INIT_CMD_DIR="$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")"

if [ "${1:-}" = "sovereign" ]; then
    shift
    exec "$_INIT_CMD_DIR/../sovereign/command.sh" "$@"
fi

if [ "${1:-}" = "entity" ]; then
    shift
fi

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

say()  { echo "[init] $*"; }
warn() { echo "[init] WARNING: $*" >&2; }
die()  { echo "[init] ERROR: $*" >&2; exit 1; }

CEREMONY_SCRIPT="$_INIT_CMD_DIR/ceremony.mjs"

# ---------------------------------------------------------------------------
# Chain resolution — VESTA-SPEC-240 §7
# ---------------------------------------------------------------------------
# One implementation of effective-key resolution: modules/node/sigchain.js
# resolveEntityKey(), reached through ceremony.mjs. The bash side consumes its
# JSON and never re-derives order itself. §11: two implementations of this are
# exactly the drift the spec exists to end.

RESOLVE_AVAILABLE=0
EFFECTIVE_FPR=""
EFFECTIVE_CID=""
KEY_EVENT_COUNT=0
CHAIN_ANOMALIES=""
LEAF_FPR_ON_DISK=""
LEAF_EPOCH_AUTHORIZED=0
LEAF_EPOCH_STALE=0
LEAF_EPOCH_REVOKED=0
LEAF_EPOCH_CURRENT=0

leaf_fingerprint_on_disk() {
    # Fingerprint of id/devices/<host>/leaf.public.asc; empty when unknowable.
    [ -f "$DEVICE_DIR/leaf.public.asc" ] || return 0
    [ -f "$CEREMONY_SCRIPT" ] || return 0
    command -v node >/dev/null 2>&1 || return 0
    command -v jq   >/dev/null 2>&1 || return 0
    node "$CEREMONY_SCRIPT" get-leaf-fingerprint \
        --leaf-public-armor-file "$DEVICE_DIR/leaf.public.asc" 2>/dev/null \
        | jq -r '.fingerprint // empty' 2>/dev/null || true
}

resolve_chain_state() {
    # Sets RESOLVE_AVAILABLE, EFFECTIVE_FPR, EFFECTIVE_CID, KEY_EVENT_COUNT,
    # CHAIN_ANOMALIES and the leaf-epoch flags. Never mutates, never exits:
    # an unreadable chain resolves to "nothing available", which paternity
    # reports as unverifiable — absence is not evidence (§8 P-2).
    RESOLVE_AVAILABLE=0
    EFFECTIVE_FPR=""
    EFFECTIVE_CID=""
    KEY_EVENT_COUNT=0
    CHAIN_ANOMALIES=""
    LEAF_EPOCH_AUTHORIZED=0
    LEAF_EPOCH_STALE=0
    LEAF_EPOCH_REVOKED=0
    LEAF_EPOCH_CURRENT=0

    # Resolution is a chain fact, not a device capability (SPEC-240 D-1, §13.7).
    # No device leaf on this host means we cannot SIGN, but a cloned sovereign
    # chain may still resolve an effective key — and that resolution is what
    # decides whether a cell is creation or succession (§13.7b). Do not gate
    # resolution on HAVE_SOVEREIGN; gate it on the chain being readable.
    command -v node >/dev/null 2>&1 || return 0
    command -v jq   >/dev/null 2>&1 || return 0
    [ -f "$CEREMONY_SCRIPT" ] || return 0

    local sigchain_dir="$SOVEREIGN_DIR/sigchain"
    [ -d "$sigchain_dir/entries" ] || return 0

    local json
    json=$(node "$CEREMONY_SCRIPT" resolve-entity \
        --handle "$ENTITY_NAME" \
        --sigchain-dir "$sigchain_dir" \
        --leaf-fingerprint "${LEAF_FPR_ON_DISK:-}" 2>/dev/null) || return 0
    [ -n "$json" ] || return 0

    RESOLVE_AVAILABLE=1
    EFFECTIVE_FPR=$(printf '%s' "$json" | jq -r '.effective_fingerprint // ""' 2>/dev/null || true)
    EFFECTIVE_CID=$(printf '%s' "$json" | jq -r '.established_by // ""' 2>/dev/null || true)
    KEY_EVENT_COUNT=$(printf '%s' "$json" | jq -r '.keyEventCount // 0' 2>/dev/null || true)
    CHAIN_ANOMALIES=$(printf '%s' "$json" | jq -r '(.anomalies // []) | join(",")' 2>/dev/null || true)
    LEAF_EPOCH_AUTHORIZED=$(printf '%s' "$json" | jq -r 'if .leafEpoch.authorized then 1 else 0 end' 2>/dev/null || echo 0)
    LEAF_EPOCH_STALE=$(printf '%s' "$json" | jq -r 'if .leafEpoch.stale then 1 else 0 end' 2>/dev/null || echo 0)
    LEAF_EPOCH_REVOKED=$(printf '%s' "$json" | jq -r 'if .leafEpoch.revoked then 1 else 0 end' 2>/dev/null || echo 0)
    LEAF_EPOCH_CURRENT=$(printf '%s' "$json" | jq -r 'if .leafEpoch.current then 1 else 0 end' 2>/dev/null || echo 0)
    return 0
}

# ---------------------------------------------------------------------------
# Paternity — VESTA-SPEC-240 §8, restated against the EFFECTIVE key
# ---------------------------------------------------------------------------
#
# WHY (2026-10-21 koad's ruling; restated 2026-11-03 by SPEC-240 §8)
# ------------------------------------------------------------
# init and gestate are two halves of the same ceremony: gestate mints an entity
# keypair and records it; init re-establishes it on another device. The record is
# the key-affecting entry in the sovereign's sigchain that is effective *now*.
#
# The old check asked "does ANY genesis naming this handle match the disk key".
# That is K-2: after a rotation the superseded key is still named by the old
# genesis, so restoring the archived entity.public.asc read as `proven` and a
# leaf could be minted for a key the entity no longer uses. §8 P-1 forbids it:
# paternity compares resolveEntityKey(handle).effective_fingerprint, nothing else.
#
# Outcomes: proven → the disk key is the effective key; disproven → the chain
# names a different key (current-state evidence, §8 P-3); unverifiable → the
# chain says nothing (absent, empty, unreadable, or no entry for this handle),
# and absence is not disproof (§8 P-2).

_jget_first() {
    # _jget_first FILE KEY → first value for KEY, works on pretty or minified JSON.
    # Reads the payload copy, never the escaped copy inside "signature".
    # The trailing `|| true` matters: this script runs under `set -euo pipefail`,
    # and a key that is absent is a normal answer, not an error.
    { tr -d '\n\r' < "$1" | sed 's/[[:space:]]\{1,\}/ /g' \
        | grep -o "$2 *: *\"[^\"]*\"" | head -1 | sed 's/^[^:]*: *"//; s/"$//' ; } || true
}

_jget_all() {
    { tr -d '\n\r' < "$1" | sed 's/[[:space:]]\{1,\}/ /g' \
        | grep -o "$2 *: *\"[^\"]*\"" | sed 's/^[^:]*: *"//; s/"$//' ; } || true
}

entity_fingerprint_on_disk() {
    # id/entity.fingerprint if present, else derived from id/entity.public.asc
    # in a throwaway keyring. Prints uppercase hex; prints nothing if unknowable.
    local file="$ENTITY_ID_DIR/entity.fingerprint"
    if [ -f "$file" ]; then
        tr -d '[:space:]' < "$file" | tr 'abcdef' 'ABCDEF'
        return 0
    fi
    if [ -f "$ENTITY_ID_DIR/entity.public.asc" ] && command -v gpg >/dev/null 2>&1; then
        local probe_home
        probe_home=$(mktemp -d "${TMPDIR:-/tmp}/koad-fpr.XXXXXX")
        GNUPGHOME="$probe_home" gpg --batch --quiet --with-colons \
            --import-options show-only --import "$ENTITY_ID_DIR/entity.public.asc" 2>/dev/null \
            | awk -F: '/^fpr:/{print $10; exit}' || true
        rm -rf "$probe_home"
    fi
    return 0
}

verify_paternity() {
    # Sets: PATERNITY (proven|disproven|unverifiable), PATERNITY_REASON,
    #       ENTITY_FPR_ON_DISK
    #
    # "Cannot prove" is deliberately distinct from "proved false": a sovereign
    # whose chain is absent, unreadable, or empty has recorded nothing, and
    # absence is not evidence. Only a readable chain that resolves an effective
    # key can disprove.
    PATERNITY="unverifiable"
    PATERNITY_REASON=""
    ENTITY_FPR_ON_DISK="$(entity_fingerprint_on_disk || true)"
    ENTITY_FPR_ON_DISK="${ENTITY_FPR_ON_DISK//[[:space:]]/}"

    if [ "$RESOLVE_AVAILABLE" -ne 1 ]; then
        if [ "$HAVE_SOVEREIGN" -ne 1 ]; then
            PATERNITY_REASON="no sovereign at $SOVEREIGN_DIR on this device — there is no chain to prove anything against"
        else
            PATERNITY_REASON="the sovereign sigchain at $SOVEREIGN_DIR/sigchain is absent, empty, or unreadable — nothing recorded, nothing to compare"
        fi
        return 0
    fi

    if [ "$KEY_EVENT_COUNT" -eq 0 ]; then
        PATERNITY_REASON="the chain resolves no key-affecting entry for '$ENTITY_NAME' — nothing recorded, so nothing is disproved"
        return 0
    fi

    if [ -z "$ENTITY_FPR_ON_DISK" ]; then
        PATERNITY_REASON="id/entity.public.asc is present but its fingerprint could not be read"
        return 0
    fi

    if [ "$EFFECTIVE_FPR" = "$ENTITY_FPR_ON_DISK" ]; then
        PATERNITY="proven"
        PATERNITY_REASON="the chain's effective key for '$ENTITY_NAME' is this exact key (${ENTITY_FPR_ON_DISK: -16})"
        return 0
    fi

    PATERNITY="disproven"
    PATERNITY_REASON="the chain's effective key for '$ENTITY_NAME' is ${EFFECTIVE_FPR: -16}; id/ holds ${ENTITY_FPR_ON_DISK: -16}"
    return 0
}

# Read-only audit: disk leaf fingerprint → chain resolution → §8 verdict.
# One entry point so no caller can run paternity against a stale resolution.
audit_paternity() {
    LEAF_FPR_ON_DISK="$(leaf_fingerprint_on_disk || true)"
    LEAF_FPR_ON_DISK="${LEAF_FPR_ON_DISK//[[:space:]]/}"
    resolve_chain_state
    verify_paternity
}

# ---------------------------------------------------------------------------
# Args
# ---------------------------------------------------------------------------

ENTITY_NAME="${1:-}"
REPO_URL=""
FORCEFUL=0
ADOPT=0
FORCE_RESEED=0

# Parse remaining args
shift || true
for arg in "$@"; do
    case "$arg" in
        --forceful) FORCEFUL=1 ;;
        --adopt)    ADOPT=1 ;;
        --re-seed)  FORCE_RESEED=1 ;;
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
    die "Usage: koad-io init entity <name> [<repo-url>] [--forceful] [--adopt] [--re-seed]"
fi

ENTITY_DIR="$HOME/.$ENTITY_NAME"

# ---------------------------------------------------------------------------
# Pre-flight: detect sovereign (non-fatal — gated ops skip when absent)
# ---------------------------------------------------------------------------

SOVEREIGN_DIR="$HOME/.koad-io/me"
SOVEREIGN_ID_DIR="$SOVEREIGN_DIR/id"
MASTER_FINGERPRINT_FILE="$SOVEREIGN_ID_DIR/master.fingerprint"
HOST=$(hostname -s)
SOVEREIGN_LEAF_DIR="$SOVEREIGN_ID_DIR/devices/$HOST"
SOVEREIGN_LEAF_PRIVATE="$SOVEREIGN_LEAF_DIR/leaf.private.asc"
SOVEREIGN_DEVICE_KEY="$SOVEREIGN_LEAF_DIR/device.key"

HAVE_SOVEREIGN=1
# §13.2: the cell's loud line is the FIRST [init] line. Pre-flight notes are
# held here and flushed immediately after it, never before.
PREFLIGHT_NOTES=()

if [ ! -d "$SOVEREIGN_DIR" ]; then
    PREFLIGHT_NOTES+=("No sovereign found at $SOVEREIGN_DIR — sigchain signing and key ceremonies will be skipped. Run 'koad-io init sovereign' to set up a sovereign identity.")
    HAVE_SOVEREIGN=0
elif [ ! -f "$SOVEREIGN_ID_DIR/gpg.public.asc" ]; then
    PREFLIGHT_NOTES+=("Sovereign exists but has no master public key — sigchain signing will be skipped. Run 'koad-io init sovereign' to repair.")
    HAVE_SOVEREIGN=0
elif [ ! -f "$MASTER_FINGERPRINT_FILE" ]; then
    PREFLIGHT_NOTES+=("Sovereign id/master.fingerprint is missing — sigchain signing will be skipped. Run 'koad-io init sovereign' to repair.")
    HAVE_SOVEREIGN=0
elif [ ! -f "$SOVEREIGN_LEAF_PRIVATE" ]; then
    PREFLIGHT_NOTES+=("Sovereign device leaf not found on this machine — sigchain signing will be skipped. Run 'koad-io init sovereign' on this device to establish a device leaf.")
    HAVE_SOVEREIGN=0
elif [ ! -f "$SOVEREIGN_DEVICE_KEY" ]; then
    PREFLIGHT_NOTES+=("Sovereign device key not found — sigchain signing will be skipped. Run 'koad-io init sovereign' on this device first.")
    HAVE_SOVEREIGN=0
fi

EXPECTED_MASTER_FPR=""
[ "$HAVE_SOVEREIGN" -eq 1 ] && [ -f "$MASTER_FINGERPRINT_FILE" ] && EXPECTED_MASTER_FPR=$(cat "$MASTER_FINGERPRINT_FILE")

# ---------------------------------------------------------------------------
# State 1/2: Dir missing — clone or error
# ---------------------------------------------------------------------------

if [ ! -d "$ENTITY_DIR" ]; then
    if [ -n "$REPO_URL" ]; then
        # Pre-cell work: progress goes out with a [clone] prefix so the cell's
        # loud line stays the first [init] line read from stdout (§13.2).
        echo "[clone] Cloning entity '$ENTITY_NAME' from $REPO_URL"
        git clone "$REPO_URL" "$ENTITY_DIR" || die "Clone failed: $REPO_URL"
        echo "[clone] Cloned to $ENTITY_DIR — continuing with state detection"
    else
        die "Entity '$ENTITY_NAME' does not exist at $ENTITY_DIR.
  To create a new entity:   koad-io gestate $ENTITY_NAME
  To clone an existing one: koad-io init $ENTITY_NAME <repo-url>"
    fi
fi

# ---------------------------------------------------------------------------
# §13.1 State detection — filesystem only. A flag never chooses the state.
# ---------------------------------------------------------------------------
# The old code let --forceful force ACTION=migrate before state was known,
# which collapsed "already initialized" and "rotate" onto one code path. §13.1
# defines the four states as filesystem facts; the flag picks the CELL, never
# the state.

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

if [ "$ENTITY_KEY_PRESENT" -eq 1 ] && [ "$LEAF_PRESENT" -eq 1 ]; then
    STATE="6"      # all-set: entity key + a leaf for THIS device
elif [ "$ENTITY_KEY_PRESENT" -eq 1 ]; then
    STATE="7"      # secondary-device: entity key, no leaf for THIS device
elif [ "$HAS_LEGACY" -gt 0 ]; then
    STATE="3"      # migrate: legacy key material, no SPEC-175 entity key
else
    STATE="4/5"    # re-seed: no key material at all
fi

# ---------------------------------------------------------------------------
# §13.6 Flag combinations — refused, every flag named, no precedence order
# ---------------------------------------------------------------------------

FLAGS_GIVEN=()
[ "$FORCEFUL" -eq 1 ]     && FLAGS_GIVEN+=("--forceful")
[ "$ADOPT" -eq 1 ]        && FLAGS_GIVEN+=("--adopt")
[ "$FORCE_RESEED" -eq 1 ] && FLAGS_GIVEN+=("--re-seed")

FLAG="(none)"
FLAG_COMBO=0
FLAGS_LIST=""
case "${#FLAGS_GIVEN[@]}" in
    0) : ;;
    1) FLAG="${FLAGS_GIVEN[0]}" ;;
    *)
        # §13.2 canonical <flag-set>: fixed order --forceful → --adopt →
        # --re-seed, joined by `+`, no spaces. FLAGS_GIVEN is already built in
        # that order, so a reversed invocation still emits one conforming line.
        FLAG=""
        for f in "${FLAGS_GIVEN[@]}"; do
            FLAG="${FLAG:+$FLAG+}$f"
            FLAGS_LIST="${FLAGS_LIST:+$FLAGS_LIST, }$f"
        done
        FLAG_COMBO=1
        ;;
esac

# ---------------------------------------------------------------------------
# Tooling — exit 1 is reserved for this, never for a protocol refusal (§13.2)
# ---------------------------------------------------------------------------

TOOLING_NEEDED=0
[ "$ENTITY_KEY_PRESENT" -eq 0 ] && TOOLING_NEEDED=1
[ "$STATE" = "7" ]              && TOOLING_NEEDED=1
[ "$FORCEFUL" -eq 1 ]           && TOOLING_NEEDED=1
[ "$FORCE_RESEED" -eq 1 ]       && TOOLING_NEEDED=1
[ "$ADOPT" -eq 1 ]              && TOOLING_NEEDED=1

if [ "$TOOLING_NEEDED" -eq 1 ]; then
    command -v jq   >/dev/null 2>&1 || die "jq is required but not found — install it and retry"
    command -v node >/dev/null 2>&1 || die "node is required but not found — install Node.js >= 18 and retry"
    if [ ! -f "$CEREMONY_SCRIPT" ]; then
        die "Ceremony script not found at $CEREMONY_SCRIPT — framework installation may be incomplete"
    fi
fi

# ---------------------------------------------------------------------------
# Read-only resolution: effective key + paternity (§7, §8)
# ---------------------------------------------------------------------------
# Silent by construction: it runs before the loud line and must not print.

audit_paternity

# ---------------------------------------------------------------------------
# §13.3 The cell — verb, action shape, archive label, detail
# ---------------------------------------------------------------------------
# Every cell resolves to exactly one of did | no-op | warned | refused, and to
# exactly one leading [init] line. Nothing below mutates until that line has
# been printed (AC-18: a refused cell writes nothing).

CELL_VERB=""
CELL_DETAIL=""
CELL_KEY_EVENT="none"        # genesis | succession | none
CELL_SIGN_LEAF=0             # file koad.entity.leaf-authorize
CELL_MINT_ENTITY=0           # mint a fresh entity keypair
CELL_MINT_LEAF=0             # mint this device's leaf
CELL_ARCHIVE=""              # "" | pre-175-migration | rotation | foreign-key
CELL_ARCHIVE_DEVICE=0        # move id/devices/<host>/ into the archive
CELL_REVOKE_LEAF=0           # file koad.entity.leaf-revoke for the displaced leaf
CELL_REASON=""               # succession reason (§5.2 closed set)
ARCHIVE_DIR=""
ARCHIVE_REL=""

INVOKE="koad-io init entity $ENTITY_NAME"

upper() { printf '%s' "$1" | tr '[:lower:]' '[:upper:]'; }

key_event_word() {
    case "$1" in
        genesis)    printf 'koad.entity.genesis' ;;
        succession) printf 'koad.entity.key-succession' ;;
        *)          printf 'no key event' ;;
    esac
}

next_key_event() {
    # W-2: a chain that already resolves a key for this handle gets a
    # succession; a chain that knows nothing about it gets a genesis. A second
    # genesis for a known handle is forbidden — that is K-1.
    if [ "$KEY_EVENT_COUNT" -gt 0 ]; then printf 'succession'; else printf 'genesis'; fi
}

archive_label() {
    # §13.5 — the label is a truth claim about the displaced key, not about the
    # flag that was typed. rotation iff the disk key IS the chain's effective key.
    if [ -n "$EFFECTIVE_FPR" ] && [ -n "$ENTITY_FPR_ON_DISK" ] && [ "$ENTITY_FPR_ON_DISK" = "$EFFECTIVE_FPR" ]; then
        printf 'rotation'
    else
        printf 'foreign-key'
    fi
}

unique_archive_dir() {
    local base="$ENTITY_ID_DIR/archive/$1-$(date -u +%Y%m%dT%H%M%SZ)"
    local p="$base" n=1
    while [ -e "$p" ]; do p="${base}-$n"; n=$((n + 1)); done
    printf '%s' "$p"
}

set_archive() {
    # Decide the archive path now, create it later: the loud line has to name
    # the path before anything is written (§13.2).
    case "${1:-}" in
        "") ARCHIVE_DIR=""; ARCHIVE_REL=""; return 0 ;;
        pre-175-migration) ARCHIVE_DIR="$ENTITY_ID_DIR/archive/pre-175-migration" ;;
        *) ARCHIVE_DIR="$(unique_archive_dir "$1")" ;;
    esac
    ARCHIVE_REL="id/archive/${ARCHIVE_DIR##*/}"
}

epoch_note() {
    if [ "$LEAF_EPOCH_STALE" -eq 1 ]; then
        printf 'leaf epoch: STALE — this device leaf was authorized before the last key succession, so it cannot sign for the current epoch; repair with a new koad.entity.leaf-authorize in the current epoch, or %s --forceful' "$INVOKE"
    elif [ "$LEAF_EPOCH_REVOKED" -eq 1 ]; then
        printf 'leaf epoch: REVOKED — this device leaf was retired; mint a new leaf with %s --forceful' "$INVOKE"
    elif [ "$LEAF_EPOCH_AUTHORIZED" -eq 0 ]; then
        printf 'leaf epoch: UNRECORDED — the chain holds no koad.entity.leaf-authorize for this device leaf, so it cannot sign for any epoch; re-run with a sovereign present or %s --forceful' "$INVOKE"
    else
        printf 'leaf epoch: current'
    fi
}

if [ "$FLAG_COMBO" -eq 1 ]; then
    # §13.6 — two or more of --forceful/--adopt/--re-seed. No precedence order.
    CELL_VERB="refused"
    CELL_DETAIL="$FLAGS_LIST are distinct intents — rotate what is mine, adopt what is not, replace what is not — and no pair of them is meaningful together, so no precedence order exists. Give at most one: $INVOKE"
else
case "$STATE/$FLAG" in

    # =======================================================================
    # State 3 — migrate: legacy material, no SPEC-175 entity key
    # =======================================================================
    "3/--adopt")
        CELL_VERB="refused"
        CELL_DETAIL="there is no id/entity.public.asc to adopt — legacy keys are migrated, not adopted. Use: $INVOKE"
        ;;
    "3/--forceful"|"3/--re-seed"|"3/(none)")
        # §13.7 — migration always files a key event, so the discriminator is
        # resolution, not the fact that `id/` holds no SPEC-175 key. A handle
        # the chain already resolves gets a succession, which is a sovereign
        # act; a chain that holds no key for it gets a genesis, which creation
        # may defer to countersignature.
        _STATE3_EVENT="$(next_key_event)"
        if [ "$HAVE_SOVEREIGN" -ne 1 ] && [ "$_STATE3_EVENT" = "succession" ]; then
            CELL_VERB="refused"
            CELL_DETAIL="the chain already resolves an effective key for '$ENTITY_NAME', so migration's key event is a succession — a sovereign act (SPEC-240 §13.7b / W-5) — and there is no sovereign on this device to sign it. Use: koad-io init sovereign, then $INVOKE"
        else
            CELL_VERB="did"
            CELL_MINT_ENTITY=1
            CELL_MINT_LEAF=1
            CELL_ARCHIVE="pre-175-migration"
            set_archive "pre-175-migration"
            case "$FLAG" in
                --forceful) CELL_DETAIL="migration proceeds — there is no SPEC-175 entity key on disk to rotate" ;;
                --re-seed)  CELL_DETAIL="migration proceeds — there is no SPEC-175 entity key on disk to ignore" ;;
                *)          CELL_DETAIL="migrating legacy keys to SPEC-175" ;;
            esac
            CELL_DETAIL="$CELL_DETAIL; legacy material archived to $ARCHIVE_REL/"
            if [ "$HAVE_SOVEREIGN" -eq 1 ]; then
                CELL_SIGN_LEAF=1
                CELL_KEY_EVENT="$_STATE3_EVENT"
                CELL_REASON="migration"
                CELL_DETAIL="$CELL_DETAIL; key event: $(key_event_word "$CELL_KEY_EVENT")"
            else
                # §13.7a — creation may proceed without a sovereign. The genesis
                # (and its leaf-authorize) are deferred to countersignature.
                CELL_KEY_EVENT="none"
                CELL_DETAIL="$CELL_DETAIL; provisional (no sovereign on this device) — id/provisional.json marks it unsigned, and the koad.entity.genesis is deferred to sovereign countersignature"
            fi
        fi
        ;;

    # =======================================================================
    # State 4/5 — re-seed: no key material
    # =======================================================================
    "4/5/--adopt")
        CELL_VERB="refused"
        CELL_DETAIL="there is no on-disk key to adopt, and creating a fresh one would silently contradict the flag. Use: $INVOKE"
        ;;
    "4/5/--forceful"|"4/5/--re-seed"|"4/5/(none)")
        # §13.7 — creation is provisional only when the key event is a genesis.
        # If the chain already resolves a key for this handle the next event is
        # a succession, and there is nothing provisional to defer (AC-36).
        _STATE45_EVENT="$(next_key_event)"
        if [ "$HAVE_SOVEREIGN" -ne 1 ] && [ "$_STATE45_EVENT" = "succession" ]; then
            CELL_VERB="refused"
            CELL_DETAIL="the chain already resolves an effective key for '$ENTITY_NAME', so the key event would be a succession — a sovereign act (SPEC-240 §13.7b / W-5) — and there is no sovereign on this device to sign it. There is nothing provisional to defer, because the chain already knows the key. Use: koad-io init sovereign, then $INVOKE"
        else
            CELL_VERB="did"
            CELL_MINT_ENTITY=1
            CELL_MINT_LEAF=1
            case "$FLAG" in
                --forceful) CELL_DETAIL="there is nothing to rotate — no key on disk; creation proceeds" ;;
                --re-seed)  CELL_DETAIL="there is nothing to ignore — no key on disk; creation proceeds" ;;
                *)          CELL_DETAIL="creating a fresh entity keypair and device leaf" ;;
            esac
            if [ "$HAVE_SOVEREIGN" -eq 1 ]; then
                CELL_KEY_EVENT="$_STATE45_EVENT"
                CELL_SIGN_LEAF=1
                CELL_REASON="migration"
                CELL_DETAIL="$CELL_DETAIL; key event: $(key_event_word "$CELL_KEY_EVENT")"
            else
                # BC-7 / SPEC-175 §4.4b: creation needs no sovereign. It is
                # provisional and says so about itself.
                CELL_KEY_EVENT="none"
                CELL_DETAIL="$CELL_DETAIL — provisional (no sovereign on this device); id/provisional.json marks it unsigned, and the koad.entity.genesis is deferred to sovereign countersignature"
            fi
        fi
        ;;

    # =======================================================================
    # State 6 — all-set: entity key + a leaf for this device
    # =======================================================================
    "6/--forceful")
        if [ "$HAVE_SOVEREIGN" -ne 1 ]; then
            CELL_VERB="refused"
            CELL_DETAIL="rotation is a sovereign act and there is no sovereign on this device — an unrecorded key change is exactly what this refusal prevents (W-5). Use: koad-io init sovereign, then $INVOKE --forceful"
        else
            CELL_VERB="did"
            CELL_MINT_ENTITY=1
            CELL_MINT_LEAF=1
            CELL_SIGN_LEAF=1
            CELL_REVOKE_LEAF=1
            CELL_ARCHIVE_DEVICE=1
            CELL_KEY_EVENT="$(next_key_event)"
            CELL_REASON="rotation"
            CELL_ARCHIVE="$(archive_label)"
            set_archive "$CELL_ARCHIVE"
            CELL_DETAIL="rotation is succession — the displaced key is archived to $ARCHIVE_REL/, a new entity key and device leaf are minted, the replaced leaf is revoked, and the key event is $(key_event_word "$CELL_KEY_EVENT")"
            if [ "$CELL_KEY_EVENT" = "genesis" ]; then
                CELL_DETAIL="$CELL_DETAIL (the chain holds no key for this handle yet, so this is its first record, not a succession — W-2)"
            fi
        fi
        ;;
    "6/--adopt")
        case "$PATERNITY" in
            proven) CELL_VERB="no-op" ;;
            *)      CELL_VERB="warned" ;;
        esac
        CELL_DETAIL="--adopt: a leaf already exists for this device, so there is nothing to adopt and nothing changes; paternity: $(upper "$PATERNITY") — $PATERNITY_REASON"
        ;;
    "6/--re-seed")
        case "$PATERNITY" in
            proven)
                CELL_VERB="refused"
                CELL_DETAIL="the chain says this key IS this handle's effective key, so \"not mine\" contradicts the chain. Use: $INVOKE --forceful"
                ;;
            disproven)
                if [ "$HAVE_SOVEREIGN" -ne 1 ]; then
                    # §13.7b — replacement is a succession, and a succession is a
                    # sovereign act. W-5 is about resolution, not the flag name.
                    CELL_VERB="refused"
                    CELL_DETAIL="the on-disk key is not this handle's key, so the rescue is a succession — a sovereign act (SPEC-240 §13.7b / W-5) — and there is no sovereign on this device to sign it. Use: koad-io init sovereign, then $INVOKE --re-seed"
                else
                    CELL_VERB="did"
                    CELL_MINT_ENTITY=1
                    CELL_MINT_LEAF=1
                    CELL_SIGN_LEAF=1
                    CELL_REVOKE_LEAF=1
                    CELL_ARCHIVE_DEVICE=1
                    CELL_KEY_EVENT="$(next_key_event)"
                    CELL_REASON="migration"
                    CELL_ARCHIVE="$(archive_label)"
                    set_archive "$CELL_ARCHIVE"
                    CELL_DETAIL="the on-disk key is not this handle's key — it is archived to $ARCHIVE_REL/ as foreign, a fresh entity key and device leaf are minted, and the key event is $(key_event_word "$CELL_KEY_EVENT") from the chain's effective key"
                fi
                ;;
            *)
                CELL_VERB="refused"
                CELL_DETAIL="the chain says nothing about this handle, and absence is not disproof (§8 P-2). Use: $INVOKE --adopt, or koad-io init sovereign"
                ;;
        esac
        ;;
    "6/(none)")
        # §13.4: report, audit paternity and leaf epoch, mutate nothing.
        CELL_VERB="did"
        if [ "$PATERNITY" != "proven" ]; then CELL_VERB="warned"; fi
        if [ "$LEAF_EPOCH_STALE" -eq 1 ] || [ "$LEAF_EPOCH_REVOKED" -eq 1 ] || [ "$LEAF_EPOCH_AUTHORIZED" -eq 0 ]; then
            CELL_VERB="warned"
        fi
        CELL_DETAIL="already fully initialized on $HOST; paternity: $(upper "$PATERNITY") — $PATERNITY_REASON; $(epoch_note)"
        ;;

    # =======================================================================
    # State 7 — secondary-device: entity key, no leaf for this device
    # =======================================================================
    "7/--forceful")
        if [ "$HAVE_SOVEREIGN" -ne 1 ]; then
            CELL_VERB="refused"
            CELL_DETAIL="rotation is a sovereign act and there is no sovereign on this device (W-5). Use: koad-io init sovereign, then $INVOKE --forceful"
        else
            CELL_VERB="did"
            CELL_MINT_ENTITY=1
            CELL_MINT_LEAF=1
            CELL_SIGN_LEAF=1
            CELL_ARCHIVE_DEVICE=1
            CELL_KEY_EVENT="$(next_key_event)"
            CELL_REASON="rotation"
            CELL_ARCHIVE="$(archive_label)"
            set_archive "$CELL_ARCHIVE"
            CELL_DETAIL="rotation and onboarding in one act — the on-disk key is archived to $ARCHIVE_REL/, a new entity key and this device's leaf are minted, and the key event is $(key_event_word "$CELL_KEY_EVENT")"
        fi
        ;;
    "7/--adopt")
        case "$PATERNITY" in
            proven)
                # V-2: state 7 is DEFINED as no leaf for this host, so the leaf
                # work is never already done. A no-op here would leave the
                # device unable to sign while claiming the adoption succeeded.
                if [ "$HAVE_SOVEREIGN" -ne 1 ]; then
                    CELL_VERB="refused"
                    CELL_DETAIL="the on-disk key is already this handle's effective key, but adopting it for this device means filing koad.entity.leaf-authorize — a sovereign act (SPEC-240 §13.7b / W-5) — and there is no sovereign on this device to sign it. Use: koad-io init sovereign, then $INVOKE --adopt"
                else
                    CELL_VERB="did"
                    CELL_MINT_LEAF=1
                    CELL_SIGN_LEAF=1
                    CELL_DETAIL="--adopt: the key was already this handle's effective key, so no key event is filed; minting this device's leaf and filing koad.entity.leaf-authorize; paternity: PROVEN — $PATERNITY_REASON"
                fi
                ;;
            disproven)
                CELL_VERB="refused"
                CELL_DETAIL="SPEC-175 §4.4 says do not adopt when paternity is disproven: leaf-signed authority would trace to a key this sovereign does not control. paternity: DISPROVEN — $PATERNITY_REASON. Use: $INVOKE --re-seed, or $INVOKE --forceful"
                ;;
            *)
                CELL_VERB="warned"
                CELL_MINT_LEAF=1
                CELL_DETAIL="--adopt: minting a leaf under an on-disk key this chain cannot trace; paternity: UNVERIFIABLE — $PATERNITY_REASON. Nothing is filed in the chain for an untraceable key"
                ;;
        esac
        ;;
    "7/--re-seed")
        case "$PATERNITY" in
            proven)
                CELL_VERB="refused"
                CELL_DETAIL="the chain says this key IS this handle's effective key, so \"not mine\" contradicts the chain. Use: $INVOKE --forceful"
                ;;
            disproven)
                if [ "$HAVE_SOVEREIGN" -ne 1 ]; then
                    CELL_VERB="refused"
                    CELL_DETAIL="the on-disk key is not this handle's key, so the rescue is a succession — a sovereign act (SPEC-240 §13.7b / W-5) — and there is no sovereign on this device to sign it. Use: koad-io init sovereign, then $INVOKE --re-seed"
                else
                    CELL_VERB="did"
                    CELL_MINT_ENTITY=1
                    CELL_MINT_LEAF=1
                    CELL_SIGN_LEAF=1
                    CELL_ARCHIVE_DEVICE=1
                    CELL_KEY_EVENT="$(next_key_event)"
                    CELL_REASON="migration"
                    CELL_ARCHIVE="$(archive_label)"
                    set_archive "$CELL_ARCHIVE"
                    CELL_DETAIL="the on-disk key is archived to $ARCHIVE_REL/ as foreign, and the key event is $(key_event_word "$CELL_KEY_EVENT") from the chain's effective key to a freshly minted one"
                fi
                ;;
            *)
                if [ "$HAVE_SOVEREIGN" -ne 1 ]; then
                    CELL_VERB="did"
                    CELL_MINT_ENTITY=1
                    CELL_MINT_LEAF=1
                    CELL_ARCHIVE_DEVICE=1
                    CELL_KEY_EVENT="none"
                    CELL_ARCHIVE="$(archive_label)"
                    set_archive "$CELL_ARCHIVE"
                    CELL_DETAIL="creation on a directory that inherited a face (SPEC-175 §4.4) — the on-disk key is archived to $ARCHIVE_REL/ as foreign; provisional (no sovereign on this device), so id/provisional.json marks it unsigned, and the koad.entity.genesis is deferred to sovereign countersignature"
                else
                    CELL_VERB="did"
                    CELL_MINT_ENTITY=1
                    CELL_MINT_LEAF=1
                    CELL_SIGN_LEAF=1
                    CELL_ARCHIVE_DEVICE=1
                    CELL_KEY_EVENT="genesis"
                    CELL_ARCHIVE="$(archive_label)"
                    set_archive "$CELL_ARCHIVE"
                    CELL_DETAIL="creation, not succession — the chain has no key-affecting entry for this handle, so this is the first one; the on-disk key is archived to $ARCHIVE_REL/ as foreign; key event: koad.entity.genesis"
                fi
                ;;
        esac
        ;;
    "7/(none)")
        case "$PATERNITY" in
            proven)
                if [ "$HAVE_SOVEREIGN" -ne 1 ]; then
                    CELL_VERB="refused"
                    CELL_DETAIL="the chain proves the on-disk key is this handle's effective key, but onboarding this device means filing koad.entity.leaf-authorize — a sovereign act (SPEC-240 §13.7b / W-5) — and there is no sovereign on this device to sign it. Use: koad-io init sovereign, then $INVOKE"
                else
                    CELL_VERB="did"
                    CELL_MINT_LEAF=1
                    CELL_SIGN_LEAF=1
                    CELL_DETAIL="paternity: PROVEN — a new device mints its own leaf for an entity key this sovereign created; key event: koad.entity.leaf-authorize"
                fi
                ;;
            disproven)
                if [ "$HAVE_SOVEREIGN" -ne 1 ]; then
                    CELL_VERB="refused"
                    CELL_DETAIL="paternity: DISPROVEN — the rescue is a succession, a sovereign act (SPEC-240 §13.7b / W-5), and there is no sovereign on this device to sign it. Use: koad-io init sovereign, then $INVOKE"
                else
                    CELL_VERB="did"
                    CELL_MINT_ENTITY=1
                    CELL_MINT_LEAF=1
                    CELL_SIGN_LEAF=1
                    CELL_ARCHIVE_DEVICE=1
                    CELL_KEY_EVENT="$(next_key_event)"
                    CELL_REASON="migration"
                    CELL_ARCHIVE="$(archive_label)"
                    set_archive "$CELL_ARCHIVE"
                    CELL_DETAIL="paternity: DISPROVEN — rescuing as scheduled: the on-disk key is archived to $ARCHIVE_REL/ as foreign, the chain's effective key is succeeded by a freshly minted one, and this device's leaf is authorized; key event: $(key_event_word "$CELL_KEY_EVENT")"
                fi
                ;;
            *)
                CELL_VERB="refused"
                CELL_DETAIL="paternity is UNVERIFIABLE and absence is not disproof (§8 P-2), so nothing is generated: $PATERNITY_REASON. Choose one, explicitly: $INVOKE --adopt, $INVOKE --re-seed, or koad-io init sovereign"
                ;;
        esac
        ;;
esac
fi

# ---------------------------------------------------------------------------
# §13.2 The loud line — the FIRST [init] line of the cell
# ---------------------------------------------------------------------------

echo "[init] $STATE/$FLAG: $CELL_VERB — $CELL_DETAIL"

if [ "${#PREFLIGHT_NOTES[@]}" -gt 0 ]; then
    for _note in "${PREFLIGHT_NOTES[@]}"; do
        warn "$_note"
    done
fi

if [ "$CELL_VERB" = "refused" ]; then
    if [ "$STATE" = "6" ] || [ "$STATE" = "7" ]; then
        echo "[init] paternity: $(upper "$PATERNITY") — $PATERNITY_REASON" >&2
        echo "[init] nothing was written." >&2
    fi
    exit 2
fi

say "Entity: $ENTITY_NAME  ($ENTITY_DIR)"
say "State:  entity.public.asc=$([ "$ENTITY_KEY_PRESENT" -eq 1 ] && echo present || echo missing)  leaf/$HOST=$([ "$LEAF_PRESENT" -eq 1 ] && echo present || echo missing)  legacy_keys=$HAS_LEGACY"
if [ -n "$CHAIN_ANOMALIES" ]; then
    say "Chain anomalies: $CHAIN_ANOMALIES"
fi
say ""

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
    # $1 key_event: genesis | succession | none   (legacy: 0=genesis, 1=none)
    # $2 old_entity_key_fingerprint (succession only — MUST be the effective key)
    # $3 reason (succession only; omitted = treated as `other` by consumers)
    # $4 revoke_leaf_fingerprint (optional; files leaf-revoke after leaf-authorize)
    # $5 revoke_host (optional, defaults to this host)
    #
    # W-6 order: key event → leaf-authorize → leaf-revoke → head.
    local key_event="${1:-genesis}"
    case "$key_event" in
        0) key_event="genesis" ;;
        1) key_event="none" ;;
    esac
    local old_fpr="${2:-}"
    local reason="${3:-}"
    local revoke_leaf="${4:-}"
    local revoke_host="${5:-$HOST}"

    SOVEREIGN_SIGCHAIN_DIR="$SOVEREIGN_DIR/sigchain"
    SOVEREIGN_SIGCHAIN_HEAD_FILE="$SOVEREIGN_SIGCHAIN_DIR/head.cid"
    SOVEREIGN_SIGCHAIN_META_FILE="$SOVEREIGN_SIGCHAIN_DIR/metadata.json"
    SOVEREIGN_SIGCHAIN_ENTRIES_DIR="$SOVEREIGN_SIGCHAIN_DIR/entries"

    CURRENT_HEAD=""
    [ -f "$SOVEREIGN_SIGCHAIN_HEAD_FILE" ] && CURRENT_HEAD=$(cat "$SOVEREIGN_SIGCHAIN_HEAD_FILE" | tr -d '[:space:]')

    SOVEREIGN_DOMAIN=""
    [ -f "$SOVEREIGN_DIR/.env" ] && SOVEREIGN_DOMAIN=$(env_value "$SOVEREIGN_DIR/.env" SOVEREIGN_DOMAIN || true)

    ENTITY_PUBLIC_ARMOR_FILE="$ENTITY_ID_DIR/entity.public.asc"
    ENTITY_FINGERPRINT_FILE="$ENTITY_ID_DIR/entity.fingerprint"

    if [ "$key_event" != "none" ]; then
        [ -f "$ENTITY_FINGERPRINT_FILE" ] && ENTITY_FINGERPRINT=$(cat "$ENTITY_FINGERPRINT_FILE")
        [ -z "${ENTITY_FINGERPRINT:-}" ] && die "Cannot determine entity fingerprint — id/entity.fingerprint missing"
        [ -f "$ENTITY_PUBLIC_ARMOR_FILE" ] || die "entity.public.asc not found at $ENTITY_PUBLIC_ARMOR_FILE"
    fi

    ENTITY_ARMOR_TMPFILE=$(mktemp /tmp/koad-entity-armor.XXXXXX)
    : > "$ENTITY_ARMOR_TMPFILE"
    [ -f "$ENTITY_PUBLIC_ARMOR_FILE" ] && cp "$ENTITY_PUBLIC_ARMOR_FILE" "$ENTITY_ARMOR_TMPFILE"

    SIGN_ENTITY_EXTRA_ARGS=(--key-event "$key_event")
    [ -n "$old_fpr" ]     && SIGN_ENTITY_EXTRA_ARGS+=(--old-entity-fingerprint "$old_fpr")
    [ -n "$reason" ]      && SIGN_ENTITY_EXTRA_ARGS+=(--reason "$reason")
    [ -n "$revoke_leaf" ] && SIGN_ENTITY_EXTRA_ARGS+=(--revoke-leaf-fingerprint "$revoke_leaf" --revoke-host "$revoke_host")

    ENTITY_SIGNING_JSON=$(node "$CEREMONY_SCRIPT" sign-entity-entries \
        --sovereign-leaf-encrypted-path "$SOVEREIGN_LEAF_PRIVATE" \
        --sovereign-device-key-path "$SOVEREIGN_DEVICE_KEY" \
        --sovereign-leaf-fingerprint "$SOVEREIGN_LEAF_FINGERPRINT" \
        --entity-handle "$ENTITY_NAME" \
        --entity-fingerprint "${ENTITY_FINGERPRINT:-}" \
        --entity-public-armor "$(cat "$ENTITY_ARMOR_TMPFILE")" \
        --leaf-fingerprint "$LEAF_FINGERPRINT" \
        --host "$HOST" \
        --sigchain-head "$CURRENT_HEAD" \
        "${SIGN_ENTITY_EXTRA_ARGS[@]}") \
        || { rm -f "$ENTITY_ARMOR_TMPFILE"; die "Sigchain signing ceremony failed"; }

    rm -f "$ENTITY_ARMOR_TMPFILE"

    KEY_EVENT_TYPE=$(echo "$ENTITY_SIGNING_JSON" | jq -r '.keyEvent // "none"')
    KEY_EVENT_CID=$(echo "$ENTITY_SIGNING_JSON" | jq -r '.keyEventCid // ""')
    LEAF_CID=$(echo "$ENTITY_SIGNING_JSON" | jq -r '.leafCid // ""')
    REVOKE_CID=$(echo "$ENTITY_SIGNING_JSON" | jq -r '.revokeCid // ""')
    NEW_HEAD_CID=$(echo "$ENTITY_SIGNING_JSON" | jq -r '.newHeadCid // ""')

    [ -z "$LEAF_CID" ] || [ "$LEAF_CID" = "null" ] && die "Sigchain signing returned no leafCid"
    [ -z "$NEW_HEAD_CID" ] || [ "$NEW_HEAD_CID" = "null" ] && die "Sigchain signing returned no newHeadCid"

    mkdir -p "$SOVEREIGN_SIGCHAIN_ENTRIES_DIR"

    if [ "$KEY_EVENT_TYPE" = "genesis" ] || [ "$KEY_EVENT_TYPE" = "succession" ]; then
        [ -z "$KEY_EVENT_CID" ] || [ "$KEY_EVENT_CID" = "null" ] && die "Sigchain signing returned no keyEventCid"
        echo "$ENTITY_SIGNING_JSON" | jq '.keyEventEntry' > "$SOVEREIGN_SIGCHAIN_ENTRIES_DIR/$KEY_EVENT_CID.json"
        say "  signed: koad.entity.$([ "$KEY_EVENT_TYPE" = "genesis" ] && echo genesis || echo key-succession) (CID: ${KEY_EVENT_CID:0:20}...)"
    fi

    echo "$ENTITY_SIGNING_JSON" | jq '.leafEntry' > "$SOVEREIGN_SIGCHAIN_ENTRIES_DIR/$LEAF_CID.json"
    say "  signed: koad.entity.leaf-authorize (CID: ${LEAF_CID:0:20}...)"

    if [ -n "$REVOKE_CID" ] && [ "$REVOKE_CID" != "null" ]; then
        echo "$ENTITY_SIGNING_JSON" | jq '.revokeEntry' > "$SOVEREIGN_SIGCHAIN_ENTRIES_DIR/$REVOKE_CID.json"
        say "  signed: koad.entity.leaf-revoke (CID: ${REVOKE_CID:0:20}...)"
    fi

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

    # SPEC-175: a bare `id/` exclusion makes every !id/ negation inert — git will
    # not re-include a file whose parent directory is excluded. Drop it; the
    # deny-by-default half is re-established as `id/*` by the whitelist below.
    if grep -qxF 'id/' "$gitignore" 2>/dev/null; then
        local tmp
        tmp=$(mktemp)
        grep -vxF 'id/' "$gitignore" > "$tmp" && cat "$tmp" > "$gitignore"
        rm -f "$tmp"
        changed=1
    fi

    # Drop the superseded bare-negation block (four consecutive lines) so the
    # whitelist below is the one place the id/ rules are stated.
    # `|| true` is load-bearing, not defensive noise: under `set -euo pipefail` a
    # no-match grep fails the pipeline, and no match is the normal case in every
    # fresh .gitignore — i.e. exactly when this function is creating one.
    local neg_start
    neg_start=$(grep -nxF '!id/entity.public.asc' "$gitignore" 2>/dev/null | head -1 | cut -d: -f1 || true)
    if [ -n "$neg_start" ] &&
       [ "$(sed -n "${neg_start},$((neg_start + 3))p" "$gitignore")" = "$(printf '!id/entity.public.asc\n!id/entity.fingerprint\n!id/migrated-at\n!id/archive/**')" ]; then
        local neg_end=$((neg_start + 3))
        # take the block's own comment line with it, so no orphan is left behind
        if [ "$neg_start" -gt 1 ] && sed -n "$((neg_start - 1))p" "$gitignore" | grep -qF '# SPEC-175: entity.public.asc is committed'; then
            neg_start=$((neg_start - 1))
        fi
        local tmp
        tmp=$(mktemp)
        awk -v s="$neg_start" -v e="$neg_end" 'NR < s || NR > e' "$gitignore" > "$tmp" && cat "$tmp" > "$gitignore"
        rm -f "$tmp"
        changed=1
    fi

    if ! grep -qxF 'id/*' "$gitignore" 2>/dev/null; then
        printf '\n# SPEC-175: public identity is committed; everything else in id/ stays ignored.\n# The whitelist MUST come after the id/* exclusion — git cannot re-include a\n# file whose parent directory is excluded. A bare `id/` rule anywhere above\n# would make every !id/ negation inert.\nid/*\n!id/devices/\nid/devices/*/*\n!id/devices/*/leaf.public.asc\n!id/.gitignore\n!id/entity.public.asc\n!id/entity.fingerprint\n!id/migrated-at\n!id/archive/\n' >> "$gitignore"
        changed=1
    fi

    # VESTA-SPEC-221 — Nostr identity. Same shape as the devices whitelist: the
    # secret is a bearer token and stays denied; the npub and the x-only pubkey
    # are meant to be signed and provable, so they stay tracked.
    if ! grep -qxF '!id/nostr/pubkey.hex' "$gitignore" 2>/dev/null; then
        printf '\n# Nostr identity — VESTA-SPEC-221 (Path B: an independent secp256k1 keypair)\n# Deny the secret, track the provable half. Order matters: negations last.\nid/nostr/crown.nsec\n!id/nostr/\nid/nostr/*\n!id/nostr/npub\n!id/nostr/pubkey.hex\n' >> "$gitignore"
        changed=1
    fi

    # Runtime state every harness session rewrites — never source.
    local missing_rules=()
    local rule
    for rule in '.buzz/' '.cache/' 'sessions/' 'logs/' 'keyring/'; do
        if ! grep -qxF "$rule" "$gitignore" 2>/dev/null && ! grep -qxF "${rule%/}" "$gitignore" 2>/dev/null; then
            missing_rules+=("$rule")
        fi
    done
    if [ "${#missing_rules[@]}" -gt 0 ]; then
        printf '\n# Runtime state — regenerated per session, never source\n' >> "$gitignore"
        printf '%s\n' "${missing_rules[@]}" >> "$gitignore"
        changed=1
    fi

    if [ "$changed" -eq 1 ]; then
        say "  updated: .gitignore (SPEC-175 id/ whitelist + runtime rules)"
    fi
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

# VESTA-SPEC-240 §15 — archive hygiene (A-1/A-2).
# An archive is a custody surface, not a publication surface. Rotation puts the
# displaced leaf and its passphrase in here on a schedule, and `!archive/**`
# used to publish both. Deny the tree, admit only public material, and deny
# private material explicitly rather than by omission.
archive/**
!archive/**/
!archive/**/entity.public.asc
!archive/**/leaf.public.asc
!archive/**/entity.fingerprint
*.private.asc
device.key

# Keep this file
!.gitignore
GITIGNORE
        say "  created: id/.gitignore"
    fi

    # VESTA-SPEC-240 §15 — migrate an existing id/.gitignore. `!archive/**` is
    # the K-5 defect: it admits archived leaf.private.asc and device.key while
    # only devices/*/leaf.private.asc is denied. Drop it, state the contract.
    if grep -qxF '!archive/**' "$id_gitignore" 2>/dev/null; then
        local tmp
        tmp=$(mktemp)
        grep -vxF '!archive/**' "$id_gitignore" > "$tmp" && cat "$tmp" > "$id_gitignore"
        rm -f "$tmp"
        say "  updated: id/.gitignore (dropped !archive/** — SPEC-240 §15)"
    fi

    if ! grep -qF 'archive/**/entity.public.asc' "$id_gitignore" 2>/dev/null; then
        printf '\n# VESTA-SPEC-240 §15 — archive hygiene (A-1/A-2).\n# An archive is a custody surface, not a publication surface. Deny the tree,\n# admit only public material, and deny private material explicitly.\narchive/**\n!archive/**/\n!archive/**/entity.public.asc\n!archive/**/leaf.public.asc\n!archive/**/entity.fingerprint\n*.private.asc\ndevice.key\n' >> "$id_gitignore"
        say "  updated: id/.gitignore (SPEC-240 §15 archive rules)"
    fi

    # VESTA-SPEC-221 — the Nostr half of the identity, same contract as the root
    # .gitignore: crown.nsec denied, npub + pubkey.hex trackable. Appended only
    # when absent so a re-run is a no-op.
    if ! grep -qxF '!nostr/pubkey.hex' "$id_gitignore" 2>/dev/null; then
        cat >> "$id_gitignore" << 'GITIGNORE'

# Nostr identity — SPEC-221. The secret stays here; the provable half does not.
nostr/crown.nsec
!nostr/
nostr/*
!nostr/npub
!nostr/pubkey.hex
GITIGNORE
        say "  updated: id/.gitignore (SPEC-221 nostr contract)"
    fi
}

# ---------------------------------------------------------------------------
# Helper: bootstrap entity GPG keyring after key generation
# ---------------------------------------------------------------------------

bootstrap_keyring() {
    local entity_dir="$1"
    local entity_id_dir="$2"
    local device_dir="$3"
    local entity_name="$4"

    local keyring_dir="$entity_dir/keyring"
    local entity_pub="$entity_id_dir/entity.public.asc"
    local leaf_pub="$device_dir/leaf.public.asc"

    mkdir -p "$keyring_dir"
    chmod 700 "$keyring_dir"

    # Import entity public key (idempotent — gpg --import on existing key is a no-op)
    if [ -f "$entity_pub" ]; then
        GNUPGHOME="$keyring_dir" gpg --import "$entity_pub" 2>&1 | while IFS= read -r line; do
            say "  gpg: $line"
        done
    else
        warn "entity.public.asc not found at $entity_pub — skipping keyring import"
        return 1
    fi

    # Import device leaf public key (always present after key generation)
    if [ -f "$leaf_pub" ]; then
        GNUPGHOME="$keyring_dir" gpg --import "$leaf_pub" 2>&1 | while IFS= read -r line; do
            say "  gpg: $line"
        done
    fi

    say "  keyring bootstrapped: $keyring_dir"
}

# ---------------------------------------------------------------------------
# Helper: commit + push sovereign sigchain after entries are filed
# ---------------------------------------------------------------------------

commit_push_sovereign_sigchain() {
    local entity_label="$1"   # display label for messages (e.g. the entity name)

    [ ! -d "$SOVEREIGN_DIR/.git" ] && {
        warn "Sovereign dir $SOVEREIGN_DIR is not a git repo — cannot commit sigchain."
        return 0
    }

    # Use the sovereign operator's own git identity when the operator has one.
    # On a fresh box git has none: the commit exits 128 with "Author identity unknown"
    # and `set -e` kills the whole command mid-flow. So: prefer global config, and when
    # there is none, fall back to the identity `init sovereign` already wrote into the
    # sovereign's .env — never assume a machine-wide git identity exists.
    (
        if git config --global user.email >/dev/null 2>&1 || \
           git -C "$SOVEREIGN_DIR" config user.email >/dev/null 2>&1; then
            # Operator has a git identity — let git use it, not the entity's.
            unset GIT_AUTHOR_NAME GIT_AUTHOR_EMAIL GIT_COMMITTER_NAME GIT_COMMITTER_EMAIL
        else
            if [ -f "$SOVEREIGN_DIR/.env" ]; then
                set -a
                # shellcheck disable=SC1090
                . "$SOVEREIGN_DIR/.env"
                set +a
            fi
            export GIT_AUTHOR_NAME="${GIT_AUTHOR_NAME:-${SOVEREIGN_HANDLE:-sovereign}}"
            export GIT_AUTHOR_EMAIL="${GIT_AUTHOR_EMAIL:-${SOVEREIGN_HANDLE:-sovereign}@${SOVEREIGN_DOMAIN:-kingdom}}"
            export GIT_COMMITTER_NAME="$GIT_AUTHOR_NAME"
            export GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"
        fi

        if ! git -C "$SOVEREIGN_DIR" diff --quiet -- sigchain/ 2>/dev/null || \
           ! git -C "$SOVEREIGN_DIR" diff --cached --quiet -- sigchain/ 2>/dev/null; then
            git -C "$SOVEREIGN_DIR" add sigchain/
            git -C "$SOVEREIGN_DIR" commit -m "$entity_label keyed into sigchain"
            say "  sovereign — sigchain committed"

            if git -C "$SOVEREIGN_DIR" remote get-url origin >/dev/null 2>&1; then
                if git -C "$SOVEREIGN_DIR" push 2>&1; then
                    say "  sovereign — sigchain pushed"
                else
                    warn "sovereign — push failed (continue manually: git -C $SOVEREIGN_DIR push)"
                fi
            else
                say "  sovereign — no origin remote configured, skipping push"
            fi
        else
            say "  sovereign — sigchain: nothing new to commit"
        fi
    )
}

# ---------------------------------------------------------------------------
# Helper: push entity repo (best-effort, clear error on failure)
# ---------------------------------------------------------------------------

push_entity_repo() {
    return 0
}

# ---------------------------------------------------------------------------
# Helper: commit entity migration artifacts
# ---------------------------------------------------------------------------

commit_entity_migration() {
    return 0
}

# ---------------------------------------------------------------------------
# Key-material operations used by the §13 matrix
# ---------------------------------------------------------------------------

mint_entity_and_leaf() {
    mkdir -p "$ENTITY_ID_DIR" "$DEVICE_DIR"

    SOVEREIGN_DOMAIN=""
    [ -f "$SOVEREIGN_DIR/.env" ] && SOVEREIGN_DOMAIN=$(env_value "$SOVEREIGN_DIR/.env" SOVEREIGN_DOMAIN || true)
    ENTITY_USERID="$ENTITY_NAME @ ${SOVEREIGN_DOMAIN:-kingdom}"

    say "Generating entity keypair and device leaf for '$ENTITY_NAME'..."

    local json
    json=$(node "$CEREMONY_SCRIPT" generate-entity --userid "$ENTITY_USERID") || die "Entity key generation ceremony failed"

    ENTITY_FINGERPRINT=$(echo "$json" | jq -r '.entityFingerprint')
    local entity_armor leaf_armor leaf_priv device_key
    entity_armor=$(echo "$json" | jq -r '.entityPublicArmor')
    LEAF_FINGERPRINT=$(echo "$json" | jq -r '.leafFingerprint')
    leaf_armor=$(echo "$json" | jq -r '.leafPublicArmor')
    leaf_priv=$(echo "$json" | jq -r '.leafPrivateArmor')
    device_key=$(echo "$json" | jq -r '.deviceKey')

    printf '%s' "$entity_armor" > "$ENTITY_ID_DIR/entity.public.asc"
    printf '%s' "$ENTITY_FINGERPRINT" > "$ENTITY_ID_DIR/entity.fingerprint"
    printf '%s' "$leaf_armor"   > "$DEVICE_DIR/leaf.public.asc"
    printf '%s' "$leaf_priv"    > "$DEVICE_DIR/leaf.private.asc"
    printf '%s' "$device_key"   > "$DEVICE_DIR/device.key"
    chmod 600 "$DEVICE_DIR/leaf.private.asc" "$DEVICE_DIR/device.key"

    say "  generated: id/entity.public.asc (fingerprint: ${ENTITY_FINGERPRINT: -16})"
    say "  generated: id/devices/$HOST/leaf.public.asc (fingerprint: ${LEAF_FINGERPRINT: -16})"
    say "  generated: id/devices/$HOST/leaf.private.asc (encrypted — passphrase is device.key)"
    say "  generated: id/devices/$HOST/device.key (gitignored — machine-local, never commit)"

    unset json entity_armor leaf_armor leaf_priv device_key

    say ""
    say "Bootstrapping GPG keyring..."
    bootstrap_keyring "$ENTITY_DIR" "$ENTITY_ID_DIR" "$DEVICE_DIR" "$ENTITY_NAME"
}

mint_device_leaf() {
    mkdir -p "$DEVICE_DIR"

    SOVEREIGN_DOMAIN=""
    [ -f "$SOVEREIGN_DIR/.env" ] && SOVEREIGN_DOMAIN=$(env_value "$SOVEREIGN_DIR/.env" SOVEREIGN_DOMAIN || true)
    ENTITY_USERID="$ENTITY_NAME @ ${SOVEREIGN_DOMAIN:-kingdom}"

    say "Generating a device leaf for '$ENTITY_NAME' on $HOST..."

    local json
    json=$(node "$CEREMONY_SCRIPT" generate-entity --userid "$ENTITY_USERID") || die "Entity leaf generation ceremony failed"

    LEAF_FINGERPRINT=$(echo "$json" | jq -r '.leafFingerprint')
    local leaf_armor leaf_priv device_key
    leaf_armor=$(echo "$json" | jq -r '.leafPublicArmor')
    leaf_priv=$(echo "$json" | jq -r '.leafPrivateArmor')
    device_key=$(echo "$json" | jq -r '.deviceKey')

    printf '%s' "$leaf_armor"   > "$DEVICE_DIR/leaf.public.asc"
    printf '%s' "$leaf_priv"    > "$DEVICE_DIR/leaf.private.asc"
    printf '%s' "$device_key"   > "$DEVICE_DIR/device.key"
    chmod 600 "$DEVICE_DIR/leaf.private.asc" "$DEVICE_DIR/device.key"

    say "  generated: id/devices/$HOST/leaf.public.asc (fingerprint: ${LEAF_FINGERPRINT: -16})"
    say "  generated: id/devices/$HOST/leaf.private.asc (encrypted — passphrase is device.key)"
    say "  generated: id/devices/$HOST/device.key (gitignored — machine-local, never commit)"

    unset json leaf_armor leaf_priv device_key

    say ""
    say "Bootstrapping GPG keyring..."
    bootstrap_keyring "$ENTITY_DIR" "$ENTITY_ID_DIR" "$DEVICE_DIR" "$ENTITY_NAME"
}

write_provisional_marker() {
    # Same shape gestate writes for an authorized-agent entity, so a consumer can
    # tell "unsigned" from "invalid" without reading bash.
    jq -n \
        --arg handle "$ENTITY_NAME" \
        --arg created "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
        --arg host "$HOST" \
        '{
            handle: $handle,
            status: "provisional",
            gestation_mode: "init-entity-no-sovereign",
            provisional: true,
            sovereign_countersign_required: true,
            created_at: $created,
            device: $host
        }' > "$ENTITY_ID_DIR/provisional.json"
    say "  wrote: id/provisional.json (unsigned — sovereign countersignature pending)"
    say "  sovereign sigchain entries NOT signed (no sovereign on this device)"
}

# ---------------------------------------------------------------------------
# The executor — the only place the matrix mutates anything
# ---------------------------------------------------------------------------

perform_cell() {
    # W-7: verify the armed sovereign leaf BEFORE moving the loaded one, so a
    # failure leaves the directory exactly as found.
    if [ "$HAVE_SOVEREIGN" -eq 1 ]; then
        if [ "$CELL_MINT_ENTITY" -eq 1 ] || [ "$CELL_MINT_LEAF" -eq 1 ] || [ "$CELL_KEY_EVENT" != "none" ]; then
            verify_sovereign_leaf
        fi
    fi

    DISPLACED_LEAF_FPR="$LEAF_FPR_ON_DISK"

    # §13.5 / W-8 — archive, never delete. The directory name follows the chain.
    if [ -n "$ARCHIVE_DIR" ]; then
        if [ "$CELL_ARCHIVE" = "pre-175-migration" ]; then
            mkdir -p "$ARCHIVE_DIR"
            say "Archiving legacy key files to $ARCHIVE_REL/"
            for kf in "${LEGACY_KEYS[@]}"; do
                if [ -f "$ENTITY_ID_DIR/$kf" ]; then
                    mv "$ENTITY_ID_DIR/$kf" "$ARCHIVE_DIR/$kf"
                    say "  archived: id/$kf"
                fi
            done
        else
            mkdir -p "$ARCHIVE_DIR"
            say "Archiving the displaced entity material to $ARCHIVE_REL/ (archived, never deleted)"
            for displaced in entity.public.asc entity.fingerprint; do
                if [ -f "$ENTITY_ID_DIR/$displaced" ]; then
                    mv "$ENTITY_ID_DIR/$displaced" "$ARCHIVE_DIR/"
                    say "  archived: id/$displaced"
                fi
            done
            if [ "$CELL_ARCHIVE_DEVICE" -eq 1 ] && [ -d "$DEVICE_DIR" ]; then
                mv "$DEVICE_DIR" "$ARCHIVE_DIR/device-$HOST"
                say "  archived: id/devices/$HOST/"
            fi
            ENTITY_KEY_PRESENT=0
            LEAF_PRESENT=0
        fi
    fi

    # Mint. W-2 lives in the decision above: the key EVENT is succession whenever
    # the chain already resolves a key for this handle.
    if [ "$CELL_MINT_ENTITY" -eq 1 ]; then
        mint_entity_and_leaf
    elif [ "$CELL_MINT_LEAF" -eq 1 ]; then
        mint_device_leaf
    fi

    # Provenance record for any key-bearing state transition.
    if [ "$CELL_MINT_ENTITY" -eq 1 ] || [ "$CELL_ARCHIVE" = "pre-175-migration" ]; then
        printf '%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$ENTITY_ID_DIR/migrated-at"
    fi

    # Chain events, in W-6 order (the signing run enforces it).
    if [ "$CELL_KEY_EVENT" != "none" ] || [ "$CELL_SIGN_LEAF" -eq 1 ]; then
        local old_fpr="" revoke_leaf=""
        [ "$CELL_KEY_EVENT" = "succession" ] && old_fpr="$EFFECTIVE_FPR"
        [ "$CELL_REVOKE_LEAF" -eq 1 ] && revoke_leaf="$DISPLACED_LEAF_FPR"
        say ""
        say "Signing sigchain entries..."
        sign_entity_sigchain_entries "$CELL_KEY_EVENT" "$old_fpr" "$CELL_REASON" "$revoke_leaf"
        say ""
        say "Committing sovereign sigchain..."
        commit_push_sovereign_sigchain "$ENTITY_NAME"
    fi

    if [ "$HAVE_SOVEREIGN" -eq 0 ] && [ "$CELL_MINT_ENTITY" -eq 1 ]; then
        write_provisional_marker
    fi

    # §13.4: a report/audit cell mutates nothing — not even the ignore rules.
    # Only a cell that actually changed key material touches .gitignore.
    if [ "$CELL_MINT_ENTITY" -eq 1 ] || [ "$CELL_MINT_LEAF" -eq 1 ] || \
       [ -n "$ARCHIVE_DIR" ] || [ "$CELL_KEY_EVENT" != "none" ] || [ "$CELL_SIGN_LEAF" -eq 1 ]; then
        ensure_spec175_gitignore "$ENTITY_DIR/.gitignore"
        ensure_spec175_id_gitignore "$ENTITY_ID_DIR/.gitignore"
        commit_entity_migration "id: $ENTITY_NAME ($CELL_KEY_EVENT)"
        push_entity_repo
    fi
}

# ---------------------------------------------------------------------------
# Run the cell
# ---------------------------------------------------------------------------

perform_cell

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
GNUPGHOME=\$HOME/.\$ENTITY_NAME/keyring
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

    # AGENTS.md is a DERIVED artifact: KOAD_IO.md + ENTITY.md + PRIMER.md
    # concatenated. It is not a source and nothing is ever hand-edited in it —
    # the header says so. Two rules govern this block:
    #
    #   1. Write only when the bytes actually change. Regenerating identical
    #      content churns mtime and makes `git status` dirty every run, which
    #      turned `Action: all-set` into a mutation (2026-10-21: a status run
    #      rewrote ~/.alice/AGENTS.md from 56.6 KB to 26.5 KB under a banner
    #      saying "already fully initialized").
    #   2. When the bytes DO change, say so loudly — this is a derived file
    #      being rebuilt from its sources, not a silent edit.
    AGENTS_TMP="$(mktemp "${TMPDIR:-/tmp}/koad-agents.XXXXXX")"
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
    } > "$AGENTS_TMP"

    AGENTS_NEW_BYTES=$(wc -c < "$AGENTS_TMP")

    if [ -f "$AGENTS_MD" ] && cmp -s "$AGENTS_TMP" "$AGENTS_MD"; then
        say "AGENTS.md — up to date ($AGENTS_NEW_BYTES bytes), not rewritten"
        rm -f "$AGENTS_TMP"
    else
        if [ -f "$AGENTS_MD" ]; then
            AGENTS_OLD_BYTES=$(wc -c < "$AGENTS_MD")
            warn "REGENERATING A DERIVED ARTIFACT: $AGENTS_MD"
            warn "  $AGENTS_OLD_BYTES → $AGENTS_NEW_BYTES bytes. This file is generated, not authored:"
            warn "  KOAD_IO.md + ENTITY.md + PRIMER.md changed since it was last written."
            warn "  Nothing was hand-edited and nothing is lost — edit the three sources, not this file."
            if [ "$STATE" = "6" ] && [ "$CELL_VERB" = "did" ]; then
                warn "  The entity itself is unchanged; only the context cascade is stale."
            fi
        else
            say "Generating AGENTS.md (opencode + harness-agnostic context floor)"
        fi
        mv "$AGENTS_TMP" "$AGENTS_MD"
        say "wrote: $AGENTS_MD ($AGENTS_NEW_BYTES bytes)"
    fi
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

source "$HOME/.koad-io/helpers/discovery.sh" 2>/dev/null && _koad_io_hint
