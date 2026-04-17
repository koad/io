#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# profile view — resolve and display a profile by CID or entity name
#
# Fetches the chain from the tip CID, walks to find the most recent
# koad.state-update[scope:profile] entry, and displays the profile data.
#
# If --verify is passed, also verifies all signatures before displaying.
#
# Usage:
#   $ENTITY profile view                    # view own profile (from sigchain-tip)
#   $ENTITY profile view <CID>              # view profile at given tip CID
#   $ENTITY profile view --entity NAME      # view named entity's profile
#   $ENTITY profile view --verify           # also verify chain signatures
#   $ENTITY profile view --json             # output as JSON

set -euo pipefail

ENTITY="${ENTITY:-koad}"
ENTITY_DIR="${ENTITY_DIR:-$HOME/.$ENTITY}"
SIGCHAIN_TIP_FILE="$ENTITY_DIR/var/sigchain-tip"

# ── Usage ─────────────────────────────────────────────────────────────────────

usage() {
  cat >&2 <<EOF
profile view — resolve and display a sovereign profile

Usage:
  $ENTITY profile view [CID]              display own profile (or at given CID)
  $ENTITY profile view --entity NAME      display named entity's profile
  $ENTITY profile view --json             output as JSON
  $ENTITY profile view --verify           verify chain before displaying

Options:
  --entity NAME         Resolve tip from ~./NAME/var/sigchain-tip
  --verify              Run full chain verification (slow — walks to genesis)
  --json                Output profile as JSON instead of formatted text
  -h, --help            Show this help

Requires: ipfs CLI + running daemon

See also:
  $ENTITY profile create   — create your profile
  $ENTITY profile update   — update your profile
  $ENTITY profile verify   — verify chain signatures
  $ENTITY profile publish  — announce tip to canonical location
EOF
}

# ── Arg parsing ───────────────────────────────────────────────────────────────

TARGET_CID=""
TARGET_ENTITY=""
DO_VERIFY=false
JSON_OUTPUT=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --entity) TARGET_ENTITY="$2"; shift 2 ;;
    --verify) DO_VERIFY=true; shift ;;
    --json)   JSON_OUTPUT=true; shift ;;
    -h|--help|help) usage; exit 0 ;;
    -*) echo "profile view: unknown option: $1" >&2; usage; exit 1 ;;
    *) TARGET_CID="$1"; shift ;;
  esac
done

# ── Resolve tip CID ───────────────────────────────────────────────────────────

if [[ -z "$TARGET_CID" ]]; then
  if [[ -n "$TARGET_ENTITY" ]]; then
    TIP_FILE="$HOME/.$TARGET_ENTITY/var/sigchain-tip"
  else
    TIP_FILE="$SIGCHAIN_TIP_FILE"
  fi

  if [[ ! -f "$TIP_FILE" ]]; then
    echo "profile view: no tip CID found at $TIP_FILE" >&2
    echo "Provide a CID explicitly: $ENTITY profile view <CID>" >&2
    echo "Or create your profile: $ENTITY profile create" >&2
    exit 1
  fi

  TARGET_CID=$(cat "$TIP_FILE")
fi

# ── Prerequisite check ────────────────────────────────────────────────────────

if ! command -v ipfs &>/dev/null; then
  echo "profile view: ipfs CLI not found. Install go-ipfs or kubo." >&2
  exit 2
fi

# ── Optional verification ─────────────────────────────────────────────────────

VERIFIED=false

if [[ "$DO_VERIFY" == true ]]; then
  echo "Verifying chain from $TARGET_CID..."
  # TODO: call profile verify and capture exit code
  # if $ENTITY profile verify "$TARGET_CID"; then
  #   VERIFIED=true
  # fi
  echo "profile view: chain verification not yet implemented (see profile verify)" >&2
fi

# ── Resolve profile ───────────────────────────────────────────────────────────

# TODO: walk chain tip → genesis, find most recent koad.state-update[scope:profile].
# Pattern:
#   CURRENT="$TARGET_CID"
#   while [[ "$CURRENT" != "null" ]]; do
#     ENTRY=$(ipfs dag get "$CURRENT")
#     TYPE=$(echo "$ENTRY" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).type))")
#     if [[ "$TYPE" == "koad.state-update" ]]; then
#       SCOPE=$(echo "$ENTRY" | node -e "...payload.scope...")
#       if [[ "$SCOPE" == "profile" ]]; then
#         PROFILE_DATA=$(echo "$ENTRY" | node -e "...payload.data...")
#         break
#       fi
#     fi
#     CURRENT=$(echo "$ENTRY" | node -e "...previous...")
#   done

echo "profile view: IPFS fetch not yet implemented — scaffold only" >&2
echo ""

# ── Display ───────────────────────────────────────────────────────────────────

DISPLAY_ENTITY="${TARGET_ENTITY:-$ENTITY}"

if [[ "$JSON_OUTPUT" == true ]]; then
  cat <<JSON
{
  "entity": "$DISPLAY_ENTITY",
  "tipCid": "$TARGET_CID",
  "verified": $VERIFIED,
  "profile": {
    "name": "TODO",
    "bio": "TODO",
    "avatar": null,
    "socialProofs": []
  },
  "note": "scaffold — IPFS fetch not yet implemented"
}
JSON
else
  echo "Profile: $DISPLAY_ENTITY"
  echo "Tip CID: $TARGET_CID"
  if [[ "$VERIFIED" == true ]]; then
    echo "Status:  Chain verified"
  else
    echo "Status:  Unverified (run --verify to check)"
  fi
  echo ""
  echo "  Name:         (TODO: fetch from IPFS)"
  echo "  Bio:          (TODO: fetch from IPFS)"
  echo "  Avatar:       (TODO: fetch from IPFS)"
  echo "  Social:       (TODO: fetch from IPFS)"
  echo ""
  echo "TODO: wire to ipfs dag get + JSON extraction in $0"
fi
