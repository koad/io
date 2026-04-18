#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# entity memory consolidate — VULCAN-SPEC-EMCF-001 §3.2 + §9
# Consolidation pass: STALE/ACTIVE → ARCHIVED, floor verification.
# ADAS-invocable in headless mode. Budget-bounded per §9 when ADAS_PASS=1.

set -euo pipefail

MEMORY_DIR="${MEMORY_DIR:-${ENTITY_DIR:-$PWD}/memories}"
INTERACTIVE=true
HEADLESS=false
CONFIRM=false
DRY_RUN=false
BUDGET_TOKENS=""
MODEL_TIER="local"

# Detect TTY
[ -t 0 ] || INTERACTIVE=false

# Detect ADAS context (§9.6)
ADAS_CONTEXT=false
[ "${ADAS_PASS:-}" = "1" ] && ADAS_CONTEXT=true

while [[ $# -gt 0 ]]; do
  case "$1" in
    --interactive)    INTERACTIVE=true; HEADLESS=false; shift ;;
    --headless)       HEADLESS=true; INTERACTIVE=false; shift ;;
    --confirm)        CONFIRM=true; shift ;;
    --dry-run)        DRY_RUN=true; shift ;;
    --budget-tokens)  BUDGET_TOKENS="$2"; ADAS_CONTEXT=true; shift 2 ;;
    --model)          MODEL_TIER="$2"; shift 2 ;;
    --help|-h)
      cat <<HELP
Usage: entity memory consolidate [--interactive|--headless] [--confirm] [--dry-run]
                                  [--budget-tokens <N>] [--model <local|mid|frontier>]

Run a consolidation pass over memories/. Archives stale/superseded memories,
verifies the fidelity floor (SPEC-103 §4.3). Uses snapshot-first rollback strategy.

Flags:
  --interactive        Default when TTY. Prompts for Y/N per candidate.
  --headless           Runs without prompts; requires --confirm to apply.
  --confirm            Apply changes (without this, dry-run regardless of mode).
  --dry-run            Output candidate list without modifying anything.
  --budget-tokens <N>  Token budget ceiling for ADAS passes (§9.2). Required when
                       ADAS_PASS=1 — running without a ceiling is a protocol violation.
  --model <tier>       Model routing: local, mid, frontier (default: local). Advisory
                       in v1 — flag + log only. Frontier without verified override
                       is downgraded to mid (§9.3).

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
  6  budget ceiling hit — partial consolidation committed (§9.4)

Fallback (bare repo / detached HEAD): copy-restore from memories/.pre-consolidation-backup/

Related: entity memory verify, entity memory index, entity memory archive
HELP
      exit 0
      ;;
    *) echo "Unknown flag: $1" >&2; exit 1 ;;
  esac
done

# --- §9.2: ADAS budget ceiling enforcement ---
if $ADAS_CONTEXT && [ -z "$BUDGET_TOKENS" ]; then
  echo "Error: --budget-tokens is required in ADAS context (SPEC-103 §11.2 protocol violation)." >&2
  exit 2
fi

# --- §9.3: model routing (advisory in v1) ---
if [ "$MODEL_TIER" = "frontier" ]; then
  OVERRIDE_FLAG="${TOKEN_BUDGET_OVERRIDE:-}"
  if [ -z "$OVERRIDE_FLAG" ]; then
    echo "Note: --model frontier requested without TOKEN_BUDGET_OVERRIDE — routing to mid (§9.3)" >&2
    MODEL_TIER="mid"
  fi
fi
echo "Note: model routing = ${MODEL_TIER} (advisory, v1)"

# --- token budget tracking (§9.2) ---
TOKENS_CONSUMED=0
BUDGET_CEILING_HIT=false

budget_charge() {
  local cost="$1"
  TOKENS_CONSUMED=$((TOKENS_CONSUMED + cost))
  if [ -n "$BUDGET_TOKENS" ]; then
    CEILING_90=$((BUDGET_TOKENS * 90 / 100))
    if [ "$TOKENS_CONSUMED" -ge "$CEILING_90" ]; then
      BUDGET_CEILING_HIT=true
    fi
  fi
}

emit_memory_pass_block() {
  local files_archived="${1:-0}"
  local files_merged="${2:-0}"
  local files_read="${3:-0}"
  local ceiling="${BUDGET_TOKENS:-0}"
  local hit="${BUDGET_CEILING_HIT}"
  echo "memory_pass:"
  echo "  tokens_consumed: ${TOKENS_CONSUMED}"
  echo "  budget_ceiling: ${ceiling}"
  echo "  files_read: ${files_read}"
  echo "  files_archived: ${files_archived}"
  echo "  files_merged: ${files_merged}"
  echo "  budget_ceiling_hit: ${hit}"
}

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

FILES_READ_COUNT=0
echo "STEP 1: AUDIT"
while IFS= read -r -d '' f; do
  classify_memory "$f"
  FILES_READ_COUNT=$((FILES_READ_COUNT + 1))
  budget_charge 500  # §9.2: 500 tokens per file read
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
  # §9.5: always emit instrumentation block in headless mode (or when budget set)
  if $HEADLESS || [ -n "$BUDGET_TOKENS" ]; then
    emit_memory_pass_block 0 0 "$FILES_READ_COUNT"
  fi
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
  if $HEADLESS || [ -n "$BUDGET_TOKENS" ]; then
    emit_memory_pass_block 0 0 "$FILES_READ_COUNT"
  fi
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

# --- STEP 3: ARCHIVE (budget-bounded per §9.4) ---
echo ""
echo "STEP 3: ARCHIVE"
ARCHIVED_COUNT=0
PARTIAL=false
for c in "${CONFIRMED_FOR_ARCHIVE[@]}"; do
  # §9.4: check budget ceiling before each archive operation
  if $BUDGET_CEILING_HIT; then
    echo "  Budget ceiling hit — stopping at ${ARCHIVED_COUNT} archived (partial consolidation §9.4)"
    PARTIAL=true
    break
  fi
  SRC="$MEMORY_DIR/${c}.md"
  DST="$ARCHIVE_DIR/${c}.md"
  if [ -f "$SRC" ]; then
    mv "$SRC" "$DST"
    echo "  archived: $c"
    ARCHIVED_COUNT=$((ARCHIVED_COUNT + 1))
    budget_charge 500  # file processing cost
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
  # §9.5: emit block even on failure
  if $HEADLESS || [ -n "$BUDGET_TOKENS" ]; then
    emit_memory_pass_block "$ARCHIVED_COUNT" 0 "$FILES_READ_COUNT"
  fi
  exit 2
fi

# --- STEP 6: COMMIT ---
echo ""
echo "STEP 6: COMMIT"
git -C "$REPO_ROOT" add -A
if $PARTIAL; then
  # §9.4: partial consolidation commit message
  git -C "$REPO_ROOT" commit -m "memory: consolidation pass — partial (budget ceiling hit) — ${ARCHIVED_COUNT} archived, floor verified" || \
    echo "Note: nothing new to commit"
else
  git -C "$REPO_ROOT" commit -m "memory: consolidation pass — ${ARCHIVED_COUNT} archived, floor verified" || \
    echo "Note: nothing new to commit (all changes already in snapshot)"
fi

# --- log ---
LOG_DIR="${ENTITY_DIR:-$PWD}/logs"
mkdir -p "$LOG_DIR"
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] consolidate --confirm — floor: PASS — archived: ${ARCHIVED_COUNT}${PARTIAL:+ (partial)}" >> "$LOG_DIR/memory-commands.log"

echo ""
if $PARTIAL; then
  echo "Consolidation partial: ${ARCHIVED_COUNT} archived (budget ceiling hit), floor verified."
else
  echo "Consolidation complete: ${ARCHIVED_COUNT} archived, floor verified."
fi

# §9.5: emit instrumentation block (always in headless or ADAS context; in interactive only if JSON)
if $HEADLESS || [ -n "$BUDGET_TOKENS" ]; then
  emit_memory_pass_block "$ARCHIVED_COUNT" 0 "$FILES_READ_COUNT"
fi

$PARTIAL && exit 6
exit 0
