#!/usr/bin/env bash
# sign — clearsign-style wrapper for keybase saltpack
#
# Produces human-readable plaintext intent with saltpack signature attached.
# The plaintext is readable. The proof is cryptographic.
#
# Usage:
#   koad sign "authorized: koad/vulcan#42 — merge release"
#   echo "message" | koad sign
#   koad sign --help
#
# Output:
#   --- AUTHORIZED BY $ENTITY ---
#   <message>
#   <timestamp>
#   --- KEYBASE SALTPACK SIGNATURE ---
#   BEGIN KEYBASE SALTPACK SIGNED MESSAGE. ...
#   END KEYBASE SALTPACK SIGNED MESSAGE.
#   --- END ---
#
# Requires: keybase, logged in as koad

set -euo pipefail

ENTITY="${ENTITY:-koad}"

usage() {
  cat >&2 <<EOF
sign — clearsign-style saltpack wrapper

Usage:
  $ENTITY sign "message"
  echo "message" | $ENTITY sign

Output: plaintext intent + keybase saltpack signature block
Requires: keybase installed and logged in
EOF
}

# Read message from arg or stdin
if [[ $# -gt 0 ]]; then
  case "$1" in
    -h|--help|help) usage; exit 0 ;;
  esac
  MESSAGE="$*"
elif [[ ! -t 0 ]]; then
  MESSAGE=$(cat)
else
  usage; exit 1
fi

if [[ -z "$MESSAGE" ]]; then
  echo "sign: message cannot be empty" >&2
  exit 1
fi

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
ENTITY_UPPER=$(echo "$ENTITY" | tr '[:lower:]' '[:upper:]')

# Build the full block to sign (plaintext + metadata)
SIGNABLE=$(printf '%s\n%s\n%s' "$MESSAGE" "timestamp: $TIMESTAMP" "signed-by: $ENTITY")

# Sign with keybase
SALTPACK=$(echo "$SIGNABLE" | keybase sign 2>/dev/null)

# Output clearsign block
cat <<EOF
--- AUTHORIZED BY $ENTITY_UPPER ---
$MESSAGE
$TIMESTAMP
--- KEYBASE SALTPACK SIGNATURE ---
$SALTPACK
--- END ---
EOF
