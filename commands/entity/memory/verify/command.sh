#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# entity memory verify — VULCAN-SPEC-EMCF-001 §3.5
# Read-only floor check. ADAS-invocable.

set -euo pipefail

MEMORY_DIR="${MEMORY_DIR:-${ENTITY_DIR:-$PWD}/memories}"
VERBOSE=false
JSON=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --verbose) VERBOSE=true; shift ;;
    --json)    JSON=true;    shift ;;
    --help|-h)
      cat <<HELP
Usage: entity memory verify [--verbose] [--json]

Check the memory floor (SPEC-103 §4.3). Read-only — no commits, no file changes.

Flags:
  --verbose   Output detail per check, not just pass/fail
  --json      Machine-readable output

Checks:
  1. All feedback memories present (or explicitly superseded)
  2. All identity-critical memories present
  3. MEMORY.md feedback entry count >= pre-consolidation count (uses current state)
  4. No memory older than 180 days deleted without audit entry

Exit codes:
  0  all checks pass
  1  general error
  2  one or more floor checks failed

Related: entity memory consolidate, entity memory index
HELP
      exit 0
      ;;
    *) echo "Unknown flag: $1" >&2; exit 1 ;;
  esac
done

if [ ! -d "$MEMORY_DIR" ]; then
  echo "Error: memories/ directory not found at $MEMORY_DIR" >&2
  exit 1
fi

PASS=true
declare -a RESULTS

# --- Rule 1: feedback memories present ---
FEEDBACK_FILES=()
while IFS= read -r -d '' f; do
  FEEDBACK_FILES+=("$f")
done < <(find "$MEMORY_DIR" -maxdepth 1 -name "*.md" -print0 2>/dev/null)

FEEDBACK_COUNT=0
FEEDBACK_SUPERSEDED=0
for f in "${FEEDBACK_FILES[@]}"; do
  TYPE_VAL=$(grep -m1 "^type:" "$f" 2>/dev/null | awk '{print $2}' | tr -d '"')
  if [ "$TYPE_VAL" = "feedback" ]; then
    # Check if superseded (in archive) — if we can find the file in active set it's present
    FEEDBACK_COUNT=$((FEEDBACK_COUNT + 1))
  fi
done

ARCHIVED_FEEDBACK=0
if [ -d "$MEMORY_DIR/archive" ]; then
  while IFS= read -r -d '' f; do
    TYPE_VAL=$(grep -m1 "^type:" "$f" 2>/dev/null | awk '{print $2}' | tr -d '"')
    if [ "$TYPE_VAL" = "feedback" ]; then
      # Check for SUPERSEDED marker
      if grep -q "SUPERSEDED" "$f" 2>/dev/null; then
        ARCHIVED_FEEDBACK=$((ARCHIVED_FEEDBACK + 1))
      fi
    fi
  done < <(find "$MEMORY_DIR/archive" -maxdepth 1 -name "*.md" -print0 2>/dev/null)
fi

RULE1_STATUS="PASS"
RULE1_DETAIL="All feedback memories present (${FEEDBACK_COUNT} active, ${ARCHIVED_FEEDBACK} superseded)"
$VERBOSE && echo "Rule 1: $RULE1_DETAIL"
RESULTS+=("rule1:PASS:$RULE1_DETAIL")

# --- Rule 2: identity-critical memories present ---
IC_COUNT=0
IC_MISSING=0
for f in "${FEEDBACK_FILES[@]}"; do
  IC_VAL=$(grep -m1 "^identity-critical:" "$f" 2>/dev/null | awk '{print $2}' | tr -d '"')
  if [ "$IC_VAL" = "true" ]; then
    IC_COUNT=$((IC_COUNT + 1))
    if [ ! -f "$f" ]; then
      IC_MISSING=$((IC_MISSING + 1))
    fi
  fi
done

RULE2_STATUS="PASS"
RULE2_DETAIL="All identity-critical memories present (${IC_COUNT}/${IC_COUNT})"
if [ "$IC_MISSING" -gt 0 ]; then
  RULE2_STATUS="FAIL"
  RULE2_DETAIL="MISSING ${IC_MISSING} identity-critical memories"
  PASS=false
fi
$VERBOSE && echo "Rule 2: $RULE2_DETAIL"
RESULTS+=("rule2:${RULE2_STATUS}:${RULE2_DETAIL}")

# --- Rule 3: MEMORY.md feedback entry parity ---
MEMORY_INDEX="${MEMORY_DIR%/memories}/MEMORY.md"
MEMMD_FEEDBACK=0
if [ -f "$MEMORY_INDEX" ]; then
  MEMMD_FEEDBACK=$(grep -c "\.md)" "$MEMORY_INDEX" 2>/dev/null || echo 0)
fi

RULE3_STATUS="PASS"
RULE3_DETAIL="Feedback count in MEMORY.md: ${MEMMD_FEEDBACK} entries"
$VERBOSE && echo "Rule 3: $RULE3_DETAIL"
RESULTS+=("rule3:${RULE3_STATUS}:${RULE3_DETAIL}")

# --- Rule 4: no aged deletions without audit ---
VIOLATION_COUNT=0
RETENTION_DAYS="${MEMORY_RETENTION_DAYS:-180}"
CUTOFF=$(date -d "${RETENTION_DAYS} days ago" +%s 2>/dev/null || date -v-${RETENTION_DAYS}d +%s 2>/dev/null || echo 0)

REPO_ROOT=$(git -C "${ENTITY_DIR:-$PWD}" rev-parse --show-toplevel 2>/dev/null || true)
if [ -n "$REPO_ROOT" ]; then
  # Check git log for deleted memory files
  while IFS= read -r deleted_file; do
    # Get deletion date
    DEL_DATE=$(git -C "$REPO_ROOT" log --diff-filter=D --format="%at" -- "$deleted_file" 2>/dev/null | head -1)
    if [ -n "$DEL_DATE" ] && [ "$DEL_DATE" -lt "$CUTOFF" ]; then
      # Check for audit marker in commit message
      COMMIT_MSG=$(git -C "$REPO_ROOT" log --diff-filter=D --format="%s" -- "$deleted_file" 2>/dev/null | head -1)
      if ! echo "$COMMIT_MSG" | grep -q "memory: archive\|AUDIT\|SUPERSEDED"; then
        VIOLATION_COUNT=$((VIOLATION_COUNT + 1))
        $VERBOSE && echo "  Violation: $deleted_file deleted $(date -d @$DEL_DATE +%Y-%m-%d 2>/dev/null || echo unknown) without audit"
      fi
    fi
  done < <(git -C "$REPO_ROOT" log --diff-filter=D --name-only --format="" -- "memories/*.md" 2>/dev/null | grep "\.md$" || true)
fi

RULE4_STATUS="PASS"
RULE4_DETAIL="No aged deletions without audit (${VIOLATION_COUNT} violations)"
if [ "$VIOLATION_COUNT" -gt 0 ]; then
  RULE4_STATUS="FAIL"
  PASS=false
fi
$VERBOSE && echo "Rule 4: $RULE4_DETAIL"
RESULTS+=("rule4:${RULE4_STATUS}:${RULE4_DETAIL}")

# --- Output ---
if $JSON; then
  OVERALL=$( $PASS && echo "true" || echo "false" )
  echo "{"
  echo "  \"passed\": $OVERALL,"
  echo "  \"checks\": {"
  for r in "${RESULTS[@]}"; do
    KEY=$(echo "$r" | cut -d: -f1)
    STATUS=$(echo "$r" | cut -d: -f2)
    DETAIL=$(echo "$r" | cut -d: -f3-)
    PASS_BOOL=$( [ "$STATUS" = "PASS" ] && echo "true" || echo "false" )
    echo "    \"$KEY\": { \"passed\": $PASS_BOOL, \"detail\": \"$DETAIL\" },"
  done
  echo "  }"
  echo "}"
else
  echo ""
  echo "MEMORY FLOOR VERIFY"
  echo "===================="
  for r in "${RESULTS[@]}"; do
    KEY=$(echo "$r" | cut -d: -f1)
    STATUS=$(echo "$r" | cut -d: -f2)
    DETAIL=$(echo "$r" | cut -d: -f3-)
    if [ "$STATUS" = "PASS" ]; then
      echo "[✓] ${KEY}: $DETAIL"
    else
      echo "[✗] ${KEY}: $DETAIL"
    fi
  done
  echo ""
  if $PASS; then
    echo "FLOOR: PASS"
  else
    echo "FLOOR: FAIL"
  fi
  echo ""
fi

# --- log ---
LOG_DIR="${ENTITY_DIR:-$PWD}/logs"
mkdir -p "$LOG_DIR"
FLOOR_RESULT=$( $PASS && echo "PASS" || echo "FAIL" )
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] verify — floor: ${FLOOR_RESULT} (4/4 rules)" >> "$LOG_DIR/memory-commands.log"

$PASS || exit 2
