#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
set -euo pipefail
# <entity> party check
#
# Check the party-line for party poopers — entities that violated protocol.
# Scans infrastructure health and session contributions for violations.
#
# A party pooper is an entity that:
#   - Contributed without signing
#   - Signed without full provenance (missing host/user/model)
#   - Didn't sign out (no "--- entity out ---")
#
# Logs violations to .koad-io/parties/<name>/poopers.log for track record.
# Exit 0 = clean. Exit 1 = party poopers found.
#
# Usage:
#   cd ~/Workbench/some-project
#   juno party check

OPENCODE="${HOME}/.koad-io/bin/opencode"
PARTY_DIR="$(pwd)"
POOPERS=0
INFRA_BAD=0

_fail()   { echo "  FAIL: $1"; INFRA_BAD=1; }
_ok()     { echo "  OK:   $1"; }
_pooper() { echo "  POOPER: $1"; POOPERS=$((POOPERS + 1)); }

echo "Party check — $PARTY_DIR"
echo ""

# === Infrastructure ===
echo "=== Infrastructure ==="

if [ ! -f "$PARTY_DIR/.env" ]; then
  _fail "No .env found"
  echo "" && echo "No party here." && exit 1
fi

SESSION_ID=$(grep "^KOAD_IO_PARTY_SESSION=" "$PARTY_DIR/.env" 2>/dev/null | tail -1 | cut -d= -f2 || true)
PARTY_NAME=$(grep "^KOAD_IO_PARTY_NAME=" "$PARTY_DIR/.env" 2>/dev/null | tail -1 | cut -d= -f2 || true)

if [ -z "$SESSION_ID" ]; then
  _fail "KOAD_IO_PARTY_SESSION not set"
  echo "" && echo "No party here." && exit 1
else
  _ok "Session: $SESSION_ID"
fi

[ -z "$PARTY_NAME" ] && _fail "KOAD_IO_PARTY_NAME not set" || _ok "Party: $PARTY_NAME"

PARTY_HOME="$PARTY_DIR/.koad-io/parties/$PARTY_NAME"
PARTY_OPENCODE="$PARTY_HOME/opencode"

[ ! -d "$PARTY_HOME" ]             && _fail "Party directory missing" || _ok "Party directory"
[ ! -f "$PARTY_HOME/PRIMER.md" ]   && _fail "PRIMER.md missing"      || _ok "PRIMER.md"
[ ! -f "$PARTY_HOME/session" ]     && _fail "Session file missing"   || _ok "Session file"
[ ! -f "$PARTY_OPENCODE/opencode.json" ] && _fail "opencode.json missing" || _ok "Opencode config"

# Check session file matches .env
if [ -f "$PARTY_HOME/session" ]; then
  STORED_ID=$(cat "$PARTY_HOME/session")
  [ "$STORED_ID" != "$SESSION_ID" ] && _fail "Session mismatch: file=$STORED_ID env=$SESSION_ID"
fi

# Count logged participants
if [ -f "$PARTY_HOME/PRIMER.md" ]; then
  PARTICIPANTS=$(grep -c "^- " "$PARTY_HOME/PRIMER.md" 2>/dev/null || true)
  _ok "$((PARTICIPANTS)) participant(s) logged"
fi

# === Session Analysis ===
echo ""
echo "=== Session Analysis ==="

EXPORT=$("$OPENCODE" export "$SESSION_ID" 2>/dev/null) || EXPORT=""
if [ -z "$EXPORT" ]; then
  EXPORT=$(OPENCODE_CONFIG_DIR="$PARTY_OPENCODE" "$OPENCODE" export "$SESSION_ID" 2>/dev/null) || EXPORT=""
fi

if [ -z "$EXPORT" ]; then
  _fail "Session not reachable in opencode DB"
else
  _ok "Session exported"

  # Extract sign-ins with full provenance: --- entity @ time | host:user | model ---
  FULL_SIGS=$(echo "$EXPORT" | grep -Po '\-\-\- \w+ @ [^|"]+\|[^|"]+\|[^"\\-]+' 2>/dev/null || true)
  FULL_COUNT=0
  [ -n "$FULL_SIGS" ] && FULL_COUNT=$(echo "$FULL_SIGS" | wc -l | tr -d ' ')

  # Extract all sign-ins: --- entity @ ...
  ALL_INS=$(echo "$EXPORT" | grep -Po '\-\-\- \w+ @ ' 2>/dev/null || true)
  TOTAL_INS=0
  [ -n "$ALL_INS" ] && TOTAL_INS=$(echo "$ALL_INS" | wc -l | tr -d ' ')

  # Extract sign-outs: --- entity out ---
  OUTS=$(echo "$EXPORT" | grep -Po '\-\-\- \w+ out \-\-\-' 2>/dev/null || true)
  OUT_COUNT=0
  [ -n "$OUTS" ] && OUT_COUNT=$(echo "$OUTS" | wc -l | tr -d ' ')

  _ok "$TOTAL_INS sign-in(s), $OUT_COUNT sign-out(s)"

  if [ "$FULL_COUNT" -gt 0 ]; then
    _ok "$FULL_COUNT with full provenance"
  fi

  # Bare sigs = total sign-ins minus full provenance
  BARE_COUNT=$((TOTAL_INS - FULL_COUNT))
  if [ "$BARE_COUNT" -gt 0 ]; then
    # Find which entities signed without provenance
    ALL_NAMES=$(echo "$ALL_INS" | grep -Po '\-\-\- \K\w+' | sort -u || true)
    FULL_NAMES=$(echo "$FULL_SIGS" | grep -Po '\-\-\- \K\w+' | sort -u || true)
    while read -r name; do
      [ -z "$name" ] && continue
      if [ -z "$FULL_NAMES" ] || ! echo "$FULL_NAMES" | grep -qx "$name"; then
        _pooper "$name — signed without provenance (missing host/user/model)"
      fi
    done <<< "$ALL_NAMES"
  fi

  # Find party poopers: signed in but didn't sign out
  IN_NAMES=$(echo "$ALL_INS" | grep -Po '\-\-\- \K\w+' | sort -u || true)
  OUT_NAMES=""
  [ -n "$OUTS" ] && OUT_NAMES=$(echo "$OUTS" | grep -Po '\-\-\- \K\w+' | sort -u || true)
  if [ -n "$IN_NAMES" ]; then
    while read -r name; do
      [ -z "$name" ] && continue
      if [ -z "$OUT_NAMES" ] || ! echo "$OUT_NAMES" | grep -qx "$name"; then
        _pooper "$name — signed in but never signed out"
      fi
    done <<< "$IN_NAMES"
  fi
fi

# === Verdict ===
echo ""

# Log poopers if any found
if [ "$POOPERS" -gt 0 ] && [ -d "$PARTY_HOME" ]; then
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) — $POOPERS party pooper(s) found" >> "$PARTY_HOME/poopers.log"
fi

if [ "$POOPERS" -gt 0 ]; then
  echo "$POOPERS party pooper(s) found."
  exit 1
elif [ "$INFRA_BAD" -gt 0 ]; then
  echo "Infrastructure issues found (no poopers in session)."
  exit 1
else
  echo "No party poopers. Clean party."
  exit 0
fi
