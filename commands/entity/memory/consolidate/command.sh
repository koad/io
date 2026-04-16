#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# entity memory consolidate — VULCAN-SPEC-EMCF-001 §3.2
# Consolidation pass: STALE/ACTIVE → ARCHIVED, floor verification.
# ADAS-invocable in headless mode.

set -euo pipefail

MEMORY_DIR="${MEMORY_DIR:-${ENTITY_DIR:-$PWD}/memories}"
INTERACTIVE=true
HEADLESS=false
CONFIRM=false
DRY_RUN=false

# Detect TTY
[ -t 0 ] || INTERACTIVE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --interactive) INTERACTIVE=true; HEADLESS=false; shift ;;
    --headless)    HEADLESS=true; INTERACTIVE=false; shift ;;
    --confirm)     CONFIRM=true; shift ;;
    --dry-run)     DRY_RUN=true; shift ;;
    --help|-h)
      cat <<HELP
Usage: entity memory consolidate [--interactive|--headless] [--confirm] [--dry-run]

Run a consolidation pass over memories/. Archives stale/superseded memories,
verifies the fidelity floor (SPEC-103 §4.3). Uses snapshot-first rollback strategy.

Flags:
  --interactive   Default when TTY. Prompts for Y/N per candidate.
  --headless      Runs without prompts; requires --confirm to apply.
  --confirm       Apply changes (without this, dry-run regardless of mode).
  --dry-run       Output candidate list without modifying anything.

Locked memories (never archived automatically):
  - type: feedback
  - identity-critical: true
  - Accessed/modified in last 30 days
  - Sole record of a protocol decision (flagged for human review)

Rollback: git reset --hard HEAD~1 if floor check fails post-consolidation.

Exit codes:
  0  consolidation completed, floor verified
  1  general error
  2  floor check failed — rolled back from snapshot
  3  working tree not clean
  4  unresolved conflict detected (ambiguous merge candidates)

Related: entity memory verify, entity memory index, entity memory archive
HELP
      exit 0
      ;;
    *) echo "Unknown flag: $1" >&2; exit 1 ;;
  esac
done

# --- resolve entity repo root ---
REPO_ROOT=$(git -C "${ENTITY_DIR:-$PWD}" rev-parse --show-toplevel 2>/dev/null || true)
if [ -z "$REPO_ROOT" ]; then
  echo "Error: not inside a git repository. Consolidation requires git for rollback safety." >&2
  exit 1
fi

# --- pre-check: working tree clean ---
if [ -n "$(git -C "$REPO_ROOT" status --porcelain 2>/dev/null)" ]; then
  echo "Error: working tree is not clean. Commit or stash changes before consolidating." >&2
  exit 3
fi

if [ ! -d "$MEMORY_DIR" ]; then
  echo "Error: memories/ directory not found at $MEMORY_DIR" >&2
  exit 1
fi

ARCHIVE_DIR="$MEMORY_DIR/archive"
MEMORY_INDEX="${MEMORY_DIR%/memories}/MEMORY.md"
mkdir -p "$ARCHIVE_DIR"

# --- STEP 1: AUDIT — classify memories ---
declare -a LOCKED_FILES
declare -a STALE_CANDIDATES
declare -a PROTOCOL_FLAGS

NOW=$(date +%s)
THIRTY_DAYS_AGO=$((NOW - 30 * 86400))

classify_memory() {
  local f="$1"
  local fname=$(basename "$f" .md)

  # locked: feedback type
  TYPE_VAL=$(grep -m1 "^type:" "$f" 2>/dev/null | awk '{print $2}' | tr -d '"')
  if [ "$TYPE_VAL" = "feedback" ]; then
    LOCKED_FILES+=("$fname:type=feedback")
    return
  fi

  # locked: identity-critical
  IS_IC=$(grep -m1 "^identity-critical:" "$f" 2>/dev/null | awk '{print $2}' | tr -d '"')
  if [ "$IS_IC" = "true" ]; then
    LOCKED_FILES+=("$fname:identity-critical")
    return
  fi

  # locked: modified in last 30 days
  MOD_TIME=$(stat -c %Y "$f" 2>/dev/null || stat -f %m "$f" 2>/dev/null || echo 0)
  if [ "$MOD_TIME" -gt "$THIRTY_DAYS_AGO" ]; then
    LOCKED_FILES+=("$fname:recent")
    return
  fi

  # check for superseded marker in body
  if grep -q "SUPERSEDED" "$f" 2>/dev/null; then
    STALE_CANDIDATES+=("$fname")
    return
  fi

  # heuristic: protocol decision — flag for human review (don't auto-archive)
  # A memory is a potential sole-protocol-record if its title appears in only one command script
  TITLE=$(grep -m1 "^name:" "$f" 2>/dev/null | awk '{print $2}' | tr -d '"' | tr '[:upper:]' '[:lower:]')
  if [ -n "$TITLE" ]; then
    COUNT=$(grep -rl "$TITLE" "$HOME/.koad-io/commands/" 2>/dev/null | wc -l || echo 0)
    if [ "$COUNT" -le 1 ]; then
      PROTOCOL_FLAGS+=("$fname:possible-protocol-record")
      return
    fi
  fi

  # candidate for consolidation (stale by age — older than 90 days, not locked)
  STALE_THRESHOLD=$((NOW - 90 * 86400))
  if [ "$MOD_TIME" -lt "$STALE_THRESHOLD" ]; then
    STALE_CANDIDATES+=("$fname")
  fi
}

echo "STEP 1: AUDIT"
while IFS= read -r -d '' f; do
  classify_memory "$f"
done < <(find "$MEMORY_DIR" -maxdepth 1 -name "*.md" -not -name "MEMORY.md" -print0 2>/dev/null)

echo "  Locked: ${#LOCKED_FILES[@]} memories"
echo "  Stale candidates: ${#STALE_CANDIDATES[@]} memories"
echo "  Protocol flags: ${#PROTOCOL_FLAGS[@]} memories (flagged for human review)"

# Emit LOCKED: lines for ADAS parsing
for locked in "${LOCKED_FILES[@]}"; do
  NAME="${locked%%:*}"
  REASON="${locked##*:}"
  echo "LOCKED: memories/${NAME}.md (${REASON})"
done

# Emit protocol flags
for flag in "${PROTOCOL_FLAGS[@]}"; do
  NAME="${flag%%:*}"
  echo "PROTOCOL-FLAG: memories/${NAME}.md — sole protocol record candidate, human review recommended"
done

if [ ${#STALE_CANDIDATES[@]} -eq 0 ]; then
  echo "No stale candidates found. Nothing to consolidate."
  exit 0
fi

echo ""
echo "STALE CANDIDATES:"
for c in "${STALE_CANDIDATES[@]}"; do
  echo "  - $c"
done

# --- dry-run exits here ---
if $DRY_RUN || (! $CONFIRM && ! $INTERACTIVE); then
  echo ""
  echo "Dry-run complete. Run with --confirm (and --headless or interactive) to apply."
  exit 0
fi

# --- interactive confirmation ---
CONFIRMED_FOR_ARCHIVE=()
if $INTERACTIVE && ! $HEADLESS; then
  for c in "${STALE_CANDIDATES[@]}"; do
    read -p "Archive $c? [y/N/all] " RESP
    case "$RESP" in
      [Yy])   CONFIRMED_FOR_ARCHIVE+=("$c") ;;
      [Aa]*)  CONFIRMED_FOR_ARCHIVE=("${STALE_CANDIDATES[@]}"); break ;;
      *)      echo "  Skipping $c" ;;
    esac
  done
elif $HEADLESS && $CONFIRM; then
  CONFIRMED_FOR_ARCHIVE=("${STALE_CANDIDATES[@]}")
else
  echo "No confirmation signal. Exiting." >&2
  exit 0
fi

if [ ${#CONFIRMED_FOR_ARCHIVE[@]} -eq 0 ]; then
  echo "Nothing confirmed for archival. Exiting."
  exit 0
fi

# --- STEP 2: SNAPSHOT ---
echo ""
echo "STEP 2: SNAPSHOT"
git -C "$REPO_ROOT" add -A
git -C "$REPO_ROOT" commit -m "memory: pre-consolidation snapshot" || true
SNAPSHOT_SHA=$(git -C "$REPO_ROOT" rev-parse HEAD)
echo "  snapshot: $SNAPSHOT_SHA"

# --- STEP 3: ARCHIVE ---
echo ""
echo "STEP 3: ARCHIVE"
ARCHIVED_COUNT=0
for c in "${CONFIRMED_FOR_ARCHIVE[@]}"; do
  SRC="$MEMORY_DIR/${c}.md"
  DST="$ARCHIVE_DIR/${c}.md"
  if [ -f "$SRC" ]; then
    mv "$SRC" "$DST"
    echo "  archived: $c"
    ARCHIVED_COUNT=$((ARCHIVED_COUNT + 1))
  fi
done

# --- STEP 4: UPDATE INDEX ---
echo ""
echo "STEP 4: UPDATE INDEX"
entity memory index --rebuild 2>/dev/null || {
  # Fallback: manual rebuild
  if [ -f "$MEMORY_INDEX" ]; then
    TMP=$(mktemp)
    for c in "${CONFIRMED_FOR_ARCHIVE[@]}"; do
      grep -v "\[${c}\](memories/${c}\.md)" "$MEMORY_INDEX" > "$TMP" || true
      mv "$TMP" "$MEMORY_INDEX"
    done
  fi
}
echo "  index updated"

# --- STEP 5: VERIFY FLOOR ---
echo ""
echo "STEP 5: VERIFY FLOOR"
FLOOR_PASSED=true
entity memory verify 2>/dev/null || FLOOR_PASSED=false

if ! $FLOOR_PASSED; then
  echo "FLOOR FAILED — rolling back to snapshot $SNAPSHOT_SHA"
  git -C "$REPO_ROOT" reset --hard "$SNAPSHOT_SHA"
  echo "Rollback complete."

  LOG_DIR="${ENTITY_DIR:-$PWD}/logs"
  mkdir -p "$LOG_DIR"
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] consolidate — FLOOR FAILED — rolled back to $SNAPSHOT_SHA" >> "$LOG_DIR/memory-commands.log"
  exit 2
fi

# --- STEP 6: COMMIT ---
echo ""
echo "STEP 6: COMMIT"
git -C "$REPO_ROOT" add -A
git -C "$REPO_ROOT" commit -m "memory: consolidation pass — ${ARCHIVED_COUNT} archived, floor verified" || \
  echo "Note: nothing new to commit (all changes already in snapshot)"

# --- log ---
LOG_DIR="${ENTITY_DIR:-$PWD}/logs"
mkdir -p "$LOG_DIR"
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] consolidate --confirm — floor: PASS — archived: ${ARCHIVED_COUNT}" >> "$LOG_DIR/memory-commands.log"

echo ""
echo "Consolidation complete: ${ARCHIVED_COUNT} archived, floor verified."
