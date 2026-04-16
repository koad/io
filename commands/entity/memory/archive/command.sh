#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# entity memory archive <name> — VULCAN-SPEC-EMCF-001 §3.4
# ACTIVE → ARCHIVED. ADAS-invocable (with floor checks).

set -euo pipefail

MEMORY_DIR="${MEMORY_DIR:-${ENTITY_DIR:-$PWD}/memories}"
NAME=""
REASON=""
FORCE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --reason) REASON="$2"; shift 2 ;;
    --force)  FORCE=true;  shift ;;
    --help|-h)
      cat <<HELP
Usage: entity memory archive <name> [--reason "<reason>"] [--force]

Move a memory from active to memories/archive/.

Arguments:
  name          Filename without .md extension (required)

Flags:
  --reason      Reason for archival (required for feedback/identity-critical memories)
  --force       Override floor violation warning

Pre-conditions:
  - memories/<name>.md must exist and be ACTIVE (not in archive/)
  - feedback or identity-critical memories require --reason
  - Floor check: archiving must not reduce feedback count below floor

Exit codes:
  0  archived successfully
  1  general error
  2  pre-check failure (file missing, already archived, feedback without reason)
  3  floor violation (would reduce feedback count — use --force to override)

Related: entity memory verify, entity memory consolidate
HELP
      exit 0
      ;;
    -*)  echo "Unknown flag: $1" >&2; exit 1 ;;
    *)
      if [ -z "$NAME" ]; then NAME="$1"; else echo "Unexpected argument: $1" >&2; exit 1; fi
      shift
      ;;
  esac
done

if [ -z "$NAME" ]; then
  echo "Error: name is required." >&2
  exit 1
fi

TARGET="$MEMORY_DIR/${NAME}.md"
ARCHIVE_DIR="$MEMORY_DIR/archive"
MEMORY_INDEX="${MEMORY_DIR%/memories}/MEMORY.md"

# --- pre-checks ---
if [ ! -f "$TARGET" ]; then
  if [ -f "$ARCHIVE_DIR/${NAME}.md" ]; then
    echo "Error: $NAME is already archived." >&2
  else
    echo "Error: $TARGET not found." >&2
  fi
  exit 2
fi

# Check type
FILE_TYPE=$(grep -m1 "^type:" "$TARGET" 2>/dev/null | awk '{print $2}' | tr -d '"')
IS_IC=$(grep -m1 "^identity-critical:" "$TARGET" 2>/dev/null | awk '{print $2}' | tr -d '"')

if { [ "$FILE_TYPE" = "feedback" ] || [ "$IS_IC" = "true" ]; } && [ -z "$REASON" ]; then
  echo "Error: --reason is required for feedback or identity-critical memories." >&2
  exit 2
fi

# --- floor check ---
if [ "$FILE_TYPE" = "feedback" ] && ! $FORCE; then
  FEEDBACK_COUNT=$(find "$MEMORY_DIR" -maxdepth 1 -name "*.md" -exec grep -l "^type: feedback" {} \; 2>/dev/null | wc -l)
  # floor: at least 1 feedback memory must remain
  if [ "$FEEDBACK_COUNT" -le 1 ]; then
    echo "Warning: archiving $NAME would reduce feedback count to zero — floor violation." >&2
    echo "Use --force to override." >&2
    exit 3
  fi
fi

# --- archive ---
mkdir -p "$ARCHIVE_DIR"

if [ -n "$REASON" ]; then
  echo "" >> "$TARGET"
  echo "<!-- SUPERSEDED: $(date -u +%Y-%m-%dT%H:%M:%SZ) — $REASON -->" >> "$TARGET"
fi

mv "$TARGET" "$ARCHIVE_DIR/${NAME}.md"
echo "archived: $NAME → memories/archive/${NAME}.md"

# --- update MEMORY.md ---
if [ -f "$MEMORY_INDEX" ]; then
  # Remove the line referencing this memory
  TMP=$(mktemp)
  grep -v "\[${NAME}\](memories/${NAME}\.md)" "$MEMORY_INDEX" > "$TMP" || true
  mv "$TMP" "$MEMORY_INDEX"
  echo "updated: $MEMORY_INDEX"
fi

# --- commit ---
REPO_ROOT=$(git -C "${ENTITY_DIR:-$PWD}" rev-parse --show-toplevel 2>/dev/null || true)
if [ -n "$REPO_ROOT" ]; then
  git -C "$REPO_ROOT" add "$ARCHIVE_DIR/${NAME}.md" "$MEMORY_INDEX" 2>/dev/null || true
  git -C "$REPO_ROOT" rm --cached "$TARGET" 2>/dev/null || true
  COMMIT_MSG="memory: archive ${NAME}"
  [ -n "$REASON" ] && COMMIT_MSG="$COMMIT_MSG — $REASON"
  git -C "$REPO_ROOT" commit -m "$COMMIT_MSG" 2>/dev/null || \
    echo "Note: git commit skipped (nothing staged or not in repo)"
fi

# --- log ---
LOG_DIR="${ENTITY_DIR:-$PWD}/logs"
mkdir -p "$LOG_DIR"
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] archive ${NAME} — ${REASON:-no reason}" >> "$LOG_DIR/memory-commands.log"

echo "Done."
