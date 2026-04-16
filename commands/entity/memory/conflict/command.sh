#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# entity memory conflict <name-a> <name-b> — VULCAN-SPEC-EMCF-001 §3.3
# Resolve conflicting memories using SPEC-103 §5 resolution rules.
# ADAS-invocable in headless mode.

set -euo pipefail

MEMORY_DIR="${MEMORY_DIR:-${ENTITY_DIR:-$PWD}/memories}"
NAME_A=""
NAME_B=""
INTERACTIVE=true
HEADLESS=false
CONFIRM=false

# Detect TTY
[ -t 0 ] || INTERACTIVE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --interactive) INTERACTIVE=true;  HEADLESS=false; shift ;;
    --headless)    HEADLESS=true; INTERACTIVE=false; shift ;;
    --confirm)     CONFIRM=true; shift ;;
    --help|-h)
      cat <<HELP
Usage: entity memory conflict <name-a> <name-b> [--interactive|--headless] [--confirm]

Resolve a conflict between two active memories using SPEC-103 §5 resolution rules.

Arguments:
  name-a    First memory filename without .md (required)
  name-b    Second memory filename without .md (required)

Flags:
  --interactive   Default when TTY detected. Presents analysis, prompts for confirmation.
  --headless      Runs without prompts; applies rules automatically.
  --confirm       Apply without prompting (headless mode only).

Resolution rules (applied in order):
  1. Explicit koad authority (authority: koad or authority: root in frontmatter)
  2. Incident record wins (<!-- INCIDENT: --> in body)
  3. More specific beats more general (type scope)
  4. Newer beats older (creation/update date)
  Ambiguity: exit code 4, write memories/conflicts/<a>-vs-<b>.md

Exit codes:
  0  conflict resolved and committed
  1  general error
  2  pre-check failure
  4  unresolved ambiguity — conflict file written

Related: entity memory verify, entity memory archive
HELP
      exit 0
      ;;
    -*)
      echo "Unknown flag: $1" >&2; exit 1 ;;
    *)
      if [ -z "$NAME_A" ]; then NAME_A="$1"
      elif [ -z "$NAME_B" ]; then NAME_B="$1"
      else echo "Unexpected argument: $1" >&2; exit 1
      fi
      shift
      ;;
  esac
done

if [ -z "$NAME_A" ] || [ -z "$NAME_B" ]; then
  echo "Error: two memory names required." >&2
  exit 1
fi
if [ "$NAME_A" = "$NAME_B" ]; then
  echo "Error: name-a and name-b must be different." >&2
  exit 2
fi

FILE_A="$MEMORY_DIR/${NAME_A}.md"
FILE_B="$MEMORY_DIR/${NAME_B}.md"
ARCHIVE_DIR="$MEMORY_DIR/archive"
CONFLICT_DIR="$MEMORY_DIR/conflicts"
MEMORY_INDEX="${MEMORY_DIR%/memories}/MEMORY.md"

# --- pre-checks ---
for f in "$FILE_A" "$FILE_B"; do
  if [ ! -f "$f" ]; then
    echo "Error: $f not found or not active." >&2
    exit 2
  fi
  if [ -f "$ARCHIVE_DIR/$(basename $f)" ]; then
    echo "Error: $(basename $f) is already archived." >&2
    exit 2
  fi
done

# --- resolution analysis ---
score_file() {
  local f="$1"
  local score=0

  # Rule 1: explicit authority
  AUTH=$(grep -m1 "^authority:" "$f" 2>/dev/null | awk '{print $2}' | tr -d '"')
  if [ "$AUTH" = "koad" ] || [ "$AUTH" = "root" ]; then
    score=$((score + 100))
  fi

  # Rule 2: incident record
  if grep -q "<!-- INCIDENT:" "$f" 2>/dev/null; then
    score=$((score + 10))
  fi

  # Rule 3: specificity (feedback > project > user > reference)
  TYPE_VAL=$(grep -m1 "^type:" "$f" 2>/dev/null | awk '{print $2}' | tr -d '"')
  case "$TYPE_VAL" in
    feedback)  score=$((score + 4)) ;;
    project)   score=$((score + 3)) ;;
    user)      score=$((score + 2)) ;;
    reference) score=$((score + 1)) ;;
  esac

  echo "$score"
}

SCORE_A=$(score_file "$FILE_A")
SCORE_B=$(score_file "$FILE_B")

echo "Conflict analysis:"
echo "  $NAME_A: score=$SCORE_A"
echo "  $NAME_B: score=$SCORE_B"

# Rule 4: recency tiebreak
if [ "$SCORE_A" = "$SCORE_B" ]; then
  DATE_A=$(stat -c %Y "$FILE_A" 2>/dev/null || stat -f %m "$FILE_A" 2>/dev/null || echo 0)
  DATE_B=$(stat -c %Y "$FILE_B" 2>/dev/null || stat -f %m "$FILE_B" 2>/dev/null || echo 0)
  if [ "$DATE_A" -gt "$DATE_B" ]; then
    SCORE_A=$((SCORE_A + 1))
    echo "  tiebreak: $NAME_A is newer"
  elif [ "$DATE_B" -gt "$DATE_A" ]; then
    SCORE_B=$((SCORE_B + 1))
    echo "  tiebreak: $NAME_B is newer"
  fi
fi

AMBIGUOUS=false
if [ "$SCORE_A" = "$SCORE_B" ]; then
  AMBIGUOUS=true
fi

# --- handle ambiguity ---
if $AMBIGUOUS; then
  echo "Resolution: AMBIGUOUS — cannot determine winner automatically."
  mkdir -p "$CONFLICT_DIR"
  CONFLICT_FILE="$CONFLICT_DIR/${NAME_A}-vs-${NAME_B}.md"
  {
    echo "<!-- CONFLICT: needs resolution — $(date -u +%Y-%m-%dT%H:%M:%SZ) -->"
    echo ""
    echo "# Memory A: ${NAME_A}"
    cat "$FILE_A"
    echo ""
    echo "---"
    echo ""
    echo "# Memory B: ${NAME_B}"
    cat "$FILE_B"
  } > "$CONFLICT_FILE"
  echo "Written: $CONFLICT_FILE"

  LOG_DIR="${ENTITY_DIR:-$PWD}/logs"
  mkdir -p "$LOG_DIR"
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] conflict ${NAME_A} ${NAME_B} — AMBIGUOUS — conflict file written" >> "$LOG_DIR/memory-commands.log"
  exit 4
fi

# --- determine winner/loser ---
if [ "$SCORE_A" -gt "$SCORE_B" ]; then
  WINNER="$NAME_A"; WINNER_FILE="$FILE_A"
  LOSER="$NAME_B";  LOSER_FILE="$FILE_B"
else
  WINNER="$NAME_B"; WINNER_FILE="$FILE_B"
  LOSER="$NAME_A";  LOSER_FILE="$FILE_A"
fi

echo "Resolution: $WINNER wins, $LOSER superseded."

# --- confirm ---
if $INTERACTIVE && ! $CONFIRM; then
  read -p "Apply resolution? [y/N] " APPLY
  [[ "$APPLY" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 0; }
elif $HEADLESS && ! $CONFIRM; then
  echo "Headless mode: --confirm required to apply. Exiting dry-run."
  exit 0
fi

# --- apply ---
mkdir -p "$ARCHIVE_DIR"
echo "" >> "$LOSER_FILE"
echo "<!-- SUPERSEDED: $(date -u +%Y-%m-%dT%H:%M:%SZ) — superseded by ${WINNER} (conflict resolution, score ${SCORE_B} vs ${SCORE_A}) -->" >> "$LOSER_FILE"
mv "$LOSER_FILE" "$ARCHIVE_DIR/${LOSER}.md"
echo "archived: $LOSER → memories/archive/${LOSER}.md"

# Update MEMORY.md — remove loser entry
if [ -f "$MEMORY_INDEX" ]; then
  TMP=$(mktemp)
  grep -v "\[${LOSER}\](memories/${LOSER}\.md)" "$MEMORY_INDEX" > "$TMP" || true
  mv "$TMP" "$MEMORY_INDEX"
fi

# --- commit ---
REPO_ROOT=$(git -C "${ENTITY_DIR:-$PWD}" rev-parse --show-toplevel 2>/dev/null || true)
if [ -n "$REPO_ROOT" ]; then
  git -C "$REPO_ROOT" add "$ARCHIVE_DIR/${LOSER}.md" "$MEMORY_INDEX" 2>/dev/null || true
  git -C "$REPO_ROOT" rm --cached "$LOSER_FILE" 2>/dev/null || true
  git -C "$REPO_ROOT" commit -m "memory: resolve conflict — ${LOSER} superseded by ${WINNER}" 2>/dev/null || \
    echo "Note: git commit skipped"
fi

# --- log ---
LOG_DIR="${ENTITY_DIR:-$PWD}/logs"
mkdir -p "$LOG_DIR"
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] conflict ${NAME_A} ${NAME_B} — resolved: ${LOSER} superseded by ${WINNER}" >> "$LOG_DIR/memory-commands.log"

echo "Done."
