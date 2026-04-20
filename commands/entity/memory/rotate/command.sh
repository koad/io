#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# memory rotate — VESTA-SPEC-134 §6.4 KEK rotation
#
# Re-wraps all UserMemories wrapped_dek values with a new KEK derived from
# a new passphrase. IPFS blobs are untouched — only the Mongo wrapped_dek
# values change. Increments key_version on the user's account record.
#
# Usage: <entity> memory rotate
#        <entity> memory rotate --dry-run
#
# Phase 5: Wires through to the kingdom's /api/memory/rotate endpoint.
# Phase 6: Real endpoint does the full re-wrap atomically.

set -euo pipefail

DRY_RUN=false
DAEMON_URL="${KOAD_IO_DAEMON_URL:-http://10.10.10.10:28282}"
KINGDOM_URL="${KOAD_IO_KINGDOM_URL:-http://localhost:3000}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=true; shift ;;
    *) echo "Unknown arg: $1" >&2; shift ;;
  esac
done

if [ -z "${KOAD_IO_SESSION_KEK:-}" ]; then
  echo "memory rotate: no active KEK in this session." >&2
  echo "  Run from a session where memory was loaded (KOAD_IO_MEMORY_ENABLED=1)." >&2
  exit 1
fi

if [ "$DRY_RUN" = "true" ]; then
  echo "[dry-run] memory rotate: would re-derive KEK and re-wrap all wrapped_dek values."
  echo "[dry-run] IPFS blobs untouched. key_version would increment."
  exit 0
fi

# Prompt for new passphrase (hidden echo)
echo -n "New memory passphrase: " >&2
if [ -t 0 ]; then
  stty -echo 2>/dev/null || true
  read -r NEW_PASSPHRASE
  stty echo 2>/dev/null || true
  echo >&2
else
  read -r NEW_PASSPHRASE
fi

if [ -z "$NEW_PASSPHRASE" ]; then
  echo "memory rotate: passphrase cannot be empty." >&2
  exit 1
fi

echo -n "Confirm new memory passphrase: " >&2
if [ -t 0 ]; then
  stty -echo 2>/dev/null || true
  read -r CONFIRM_PASSPHRASE
  stty echo 2>/dev/null || true
  echo >&2
else
  read -r CONFIRM_PASSPHRASE
fi

if [ "$NEW_PASSPHRASE" != "$CONFIRM_PASSPHRASE" ]; then
  echo "memory rotate: passphrases do not match." >&2
  exit 1
fi

# Phase 5: call kingdom /api/memory/rotate with current KEK + new passphrase
# Phase 6 wires the real re-wrap atomically. For now: report what would happen.
echo "[memory rotate] calling kingdom rotation endpoint..."
_response="$(curl -sSf \
  -X POST \
  -H "Content-Type: application/json" \
  -d "{\"current_kek\":\"${KOAD_IO_SESSION_KEK}\",\"new_passphrase\":\"${NEW_PASSPHRASE}\"}" \
  "${KINGDOM_URL}/api/memory/rotate" 2>/dev/null || echo '{"error":"endpoint not yet wired (Phase 6)"}')"

echo "$_response"

if echo "$_response" | grep -q '"error"'; then
  echo "[memory rotate] note: real rotation endpoint wires in Phase 6." >&2
  echo "[memory rotate] rotation protocol: re-wrap all wrapped_dek with new KEK, increment key_version, update bond." >&2
  exit 0
fi

echo "[memory rotate] rotation complete."

# ── Self-documenting footer ────────────────────────────────────────────────────
if [ -t 1 ] && [ "${KOAD_IO_QUIET:-0}" != "1" ]; then
  echo
  echo "usage: memory rotate [--dry-run]"
fi
