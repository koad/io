#!/usr/bin/env bash
set -euo pipefail
# <entity> spawn party [name] ["topic"]
#
# Start a multi-entity party-line conversation in the current directory.
# The spawning entity opens the conversation — their ENTITY.md loads,
# so the session is primed with their specialty and perspective.
#
# Creates .koad-io/parties/<name>/PRIMER.md as a beacon so any entity
# opened interactively in this folder knows there's a party and can join.
#
# Multiple parties can coexist — each gets its own subfolder.
# The most recently spawned party is set as active in .env.
#
# Usage:
#   vulcan spawn party auth-build "build the auth module"
#   vesta spawn party protocol-review "review protocol compliance"
#   juno spawn party planning
#
# Then pass the conch:
#   vulcan respond "build it"
#   vesta respond "review this"

OPENCODE="${HOME}/.koad-io/bin/opencode"
ENTITY_NAME="${ENTITY:?ENTITY not set}"
ENTITY_DIR="$HOME/.$ENTITY_NAME"
PARTY_DIR="$(pwd)"

PARTY_NAME="${1:-$(date +%Y%m%d-%H%M%S)}"
shift 2>/dev/null || true
# Reassemble remaining args as topic (koad-io bin word-splits quoted strings)
TOPIC="$*"

# Create the local party registry + opencode data dir
PARTY_HOME="$PARTY_DIR/.koad-io/parties/$PARTY_NAME"
PARTY_OPENCODE="$PARTY_HOME/opencode"
mkdir -p "$PARTY_HOME" "$PARTY_OPENCODE"

# Write opencode config with proper permissions for the workspace
cat > "$PARTY_OPENCODE/opencode.json" << OCEOF
{
  "\$schema": "https://opencode.ai/config.json",
  "agent": {
    "party": {
      "description": "Party-line participant in $PARTY_NAME",
      "mode": "primary",
      "permission": {
        "external_directory": {
          "$PARTY_DIR/**": "allow",
          "$HOME/.koad-io/**": "allow",
          "$HOME/.*/**": "allow"
        },
        "read": "allow",
        "write": "allow",
        "edit": "allow",
        "bash": "allow",
        "glob": "allow",
        "grep": "allow",
        "skill": "allow",
        "task": "allow",
        "webfetch": "allow",
        "todowrite": "allow",
        "question": "allow"
      }
    }
  }
}
OCEOF

# Check if this specific party already exists
if [ -f "$PARTY_HOME/PRIMER.md" ]; then
  echo "Party '$PARTY_NAME' already exists in this workspace."
  echo "Use '<entity> respond \"message\"' to continue."
  cat "$PARTY_HOME/PRIMER.md"
  exit 0
fi

# Build the introduction prompt
INTRO="You are $ENTITY_NAME, starting a multi-entity party-line conversation in this workspace.

IMPORTANT: This is a shared conversation. Multiple entities will take turns speaking here.

## Party-Line Protocol

This conversation will be used by multiple koad:io entities, one at a time. Each entity will be invoked with their own ENTITY.md loaded, so they know who they are. The rules:

1. **Sign your work.** Begin every contribution with full provenance: --- <entity-name> @ <timestamp> | <hostname>:<user> | <model> ---
2. **State what you did.** Be specific about actions taken, files modified, decisions made.
3. **Leave cleanly.** End your contribution with: --- <entity-name> out ---
4. **Read the thread.** Before acting, read what others have contributed above you.
5. **Stay in your lane.** Do your specialty. If you need another entity, say so — don't do their job.
6. **Work, don't chat.** This is a workspace. Do real work on the files in this directory. Commit if appropriate.

## This Workspace

Directory: $PARTY_DIR
Party: $PARTY_NAME"

if [ -n "$TOPIC" ]; then
  INTRO="$INTRO
Topic: $TOPIC"
fi

INTRO="$INTRO

Sign your opening entry now (as $ENTITY_NAME), acknowledge the party-line is open, and briefly state the topic if one was given. Then exit — your job is to start the conversation, not to do the work."

echo "[$ENTITY_NAME] starting party '$PARTY_NAME' in: $PARTY_DIR"

# Run opencode with session data stored in the party folder
# Entity identity comes from env cascade; session DB lives local to the party
OUTPUT=$(OPENCODE_CONFIG_DIR="$PARTY_OPENCODE" \
  "$OPENCODE" run \
  --agent party \
  --dir "$PARTY_DIR" \
  --title "party: ${PARTY_NAME}" \
  --format json \
  "$INTRO" 2>&1) || true

# Extract session ID (opencode uses "sessionID" in json output)
SESSION_ID=$(echo "$OUTPUT" | grep -o '"sessionID":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -z "$SESSION_ID" ]; then
  SESSION_ID=$(OPENCODE_CONFIG_DIR="$PARTY_OPENCODE" \
    "$OPENCODE" session list 2>/dev/null | head -1 | awk '{print $1}')
fi

if [ -z "$SESSION_ID" ]; then
  echo "ERROR: Could not determine session ID"
  echo "$OUTPUT" > /tmp/party-spawn-debug.log
  exit 1
fi

# Write the PRIMER — the beacon
cat > "$PARTY_HOME/PRIMER.md" << EOF
# Party: $PARTY_NAME

> There is an active party-line conversation in this workspace.

- **Started by:** $ENTITY_NAME
- **Date:** $(date -u +%Y-%m-%dT%H:%M:%SZ)
- **Session:** $SESSION_ID
- **Topic:** ${TOPIC:-<none>}
- **Directory:** $PARTY_DIR

## How to join

This is a multi-entity shared conversation. To participate:

\`\`\`bash
cd $PARTY_DIR
<entity> respond "your message"
\`\`\`

The session is stored in \`.env\` as \`KOAD_IO_PARTY_SESSION\`.
Each entity takes a turn — sign your work, do real work, leave cleanly.

## Participants

- $ENTITY_NAME (starter)
EOF

# Save session ID to party folder too
echo "$SESSION_ID" > "$PARTY_HOME/session"

# Set as active party in .env
if [ -f "$PARTY_DIR/.env" ]; then
  # Remove any existing party session line
  grep -v "KOAD_IO_PARTY_SESSION" "$PARTY_DIR/.env" > "$PARTY_DIR/.env.tmp" || true
  grep -v "KOAD_IO_PARTY_NAME" "$PARTY_DIR/.env.tmp" > "$PARTY_DIR/.env" || true
  rm -f "$PARTY_DIR/.env.tmp"
fi

cat >> "$PARTY_DIR/.env" << EOF

# koad:io party-line (started by $ENTITY_NAME)
KOAD_IO_PARTY_SESSION=$SESSION_ID
KOAD_IO_PARTY_NAME=$PARTY_NAME
EOF

echo ""
echo "Party '$PARTY_NAME' started by $ENTITY_NAME."
echo "  Directory: $PARTY_DIR"
echo "  Session:   $SESSION_ID"
echo "  Topic:     ${TOPIC:-<none>}"
echo "  Beacon:    .koad-io/parties/$PARTY_NAME/PRIMER.md"
echo ""
echo "Pass the conch:"
echo "  vulcan respond \"build it\""
echo "  vesta respond \"review this\""
