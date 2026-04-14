#!/usr/bin/env bash
# SPDX-License-Identifier: 0BSD
set -euo pipefail
# <entity> respond "message"
#
# Pass the conch. Send a message into the active party-line session
# in the current directory. The entity responds as assistant, turn ends.
#
# Session ID and party name read from .env (KOAD_IO_PARTY_SESSION, KOAD_IO_PARTY_NAME).
# Session data lives in .koad-io/parties/<name>/opencode/ — local to the workspace.
# Participation is logged to .koad-io/parties/<name>/PRIMER.md.
#
# Usage:
#   cd ~/Workbench/some-project
#   vulcan respond "build the auth module"
#   vesta respond "review protocol compliance"
#   juno respond "summarize what's been done"

OPENCODE="${HOME}/.koad-io/bin/opencode"
PARTY_DIR="$(pwd)"

# The koad-io bin word-splits quoted args (known limitation).
# Reassemble all args as the message.
MESSAGE="$*"
if [ -z "$MESSAGE" ]; then
  echo "Usage: $ENTITY respond \"message\""
  exit 1
fi

ENTITY_NAME="${ENTITY:?ENTITY not set}"
ENTITY_DIR="$HOME/.$ENTITY_NAME"

if [ ! -d "$ENTITY_DIR" ]; then
  echo "Entity '$ENTITY_NAME' not found at $ENTITY_DIR"
  exit 1
fi

# Find the party session
SESSION_ID=""
PARTY_NAME=""
if [ -f "$PARTY_DIR/.env" ]; then
  SESSION_ID=$(grep "^KOAD_IO_PARTY_SESSION=" "$PARTY_DIR/.env" 2>/dev/null | tail -1 | cut -d= -f2 || true)
  PARTY_NAME=$(grep "^KOAD_IO_PARTY_NAME=" "$PARTY_DIR/.env" 2>/dev/null | tail -1 | cut -d= -f2 || true)
fi

if [ -z "$SESSION_ID" ]; then
  echo "No party session found in $PARTY_DIR/.env"
  echo "Start one with: <entity> spawn party <name> [topic]"
  exit 1
fi

# Resolve the party's opencode dir (session DB lives here)
PARTY_OPENCODE="$PARTY_DIR/.koad-io/parties/$PARTY_NAME/opencode"
if [ ! -d "$PARTY_OPENCODE" ]; then
  echo "Party opencode dir not found: $PARTY_OPENCODE"
  exit 1
fi

echo "[$ENTITY_NAME] responding in party ${PARTY_NAME:-$SESSION_ID}"
echo ""

# Resolve provenance for signing
_HOST="$(hostname -s 2>/dev/null || echo unknown)"
_USER="$(whoami 2>/dev/null || echo unknown)"
_MODEL="${OPENCODE_MODEL:-unknown}"

# Load entity identity so the model knows who is responding
ENTITY_IDENTITY=""
if [ -f "$ENTITY_DIR/ENTITY.md" ]; then
  ENTITY_IDENTITY="$(cat "$ENTITY_DIR/ENTITY.md")"
fi

# Prefix the message with entity context + provenance
FULL_MESSAGE="[PARTY-LINE: You are now $ENTITY_NAME. Your identity follows.]

$ENTITY_IDENTITY

---

[PROVENANCE: Sign your work with full provenance:]
--- $ENTITY_NAME @ <timestamp> | $_HOST:$_USER | $_MODEL ---

[MESSAGE FROM ORCHESTRATOR]

$MESSAGE

[Remember: sign with full provenance, do real work, then leave. End with: --- $ENTITY_NAME out ---]"

# Pass the conch — session data in the party folder, permissions from party config
OPENCODE_CONFIG_DIR="$PARTY_OPENCODE" \
  "$OPENCODE" run \
  --agent party \
  --session "$SESSION_ID" \
  --dir "$PARTY_DIR" \
  "$FULL_MESSAGE"

# Log participation to the party PRIMER
if [ -n "$PARTY_NAME" ] && [ -f "$PARTY_DIR/.koad-io/parties/$PARTY_NAME/PRIMER.md" ]; then
  PRIMER="$PARTY_DIR/.koad-io/parties/$PARTY_NAME/PRIMER.md"
  if ! grep -q "^- $ENTITY_NAME" "$PRIMER" 2>/dev/null; then
    echo "- $ENTITY_NAME (joined $(date -u +%Y-%m-%dT%H:%M:%SZ))" >> "$PRIMER"
  fi
fi

echo ""
echo "[$ENTITY_NAME] turn complete."
