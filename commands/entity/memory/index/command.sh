#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# entity memory index — VULCAN-SPEC-EMCF-001 §3.6
# Rebuild MEMORY.md from frontmatter. ADAS-invocable.

set -euo pipefail

MEMORY_DIR="${MEMORY_DIR:-${ENTITY_DIR:-$PWD}/memories}"
REBUILD=false
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --rebuild)  REBUILD=true;  shift ;;
    --dry-run)  DRY_RUN=true;  shift ;;
    --help|-h)
      cat <<HELP
Usage: entity memory index [--rebuild] [--dry-run]

Rebuild MEMORY.md from memories/ frontmatter. Checks sync invariant:
every file has an entry, every entry points to an existing file.

Flags:
  --rebuild   Rewrite MEMORY.md (default: dry-run)
  --dry-run   Show what would change without modifying files

Invariant enforcement:
  Orphan file (in memories/, no entry)  → add entry  (reports CHANGES:)
  Broken pointer (entry, no file)       → remove entry (reports CHANGES:)
  Line overflow (>200 chars)            → truncate with [truncated]

Exit codes:
  0  no changes needed (or dry-run complete, no issues)
  1  general error
  2  broken pointers found/fixed
  3  orphan files found/fixed

Related: entity memory verify, entity memory consolidate
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

MEMORY_INDEX="${MEMORY_DIR%/memories}/MEMORY.md"

# --- read current MEMORY.md entries ---
declare -A INDEX_ENTRIES  # name -> line
if [ -f "$MEMORY_INDEX" ]; then
  while IFS= read -r line; do
    # Match lines like: - [name](memories/name.md) — description
    if [[ "$line" =~ ^\-\ \[([^]]+)\]\(memories/([^)]+)\.md\) ]]; then
      FILE_NAME="${BASH_REMATCH[2]}"
      INDEX_ENTRIES["$FILE_NAME"]="$line"
    fi
  done < "$MEMORY_INDEX"
fi

# --- scan memories/*.md files ---
declare -A DISK_FILES  # name -> description from frontmatter
while IFS= read -r -d '' f; do
  FNAME=$(basename "$f" .md)
  DESC=$(grep -m1 "^description:" "$f" 2>/dev/null | sed 's/^description: *//' | tr -d '"')
  NAME_VAL=$(grep -m1 "^name:" "$f" 2>/dev/null | awk '{print $2}' | tr -d '"')
  LABEL="${NAME_VAL:-$FNAME}"
  DISK_FILES["$FNAME"]="${DESC:-no description}"
done < <(find "$MEMORY_DIR" -maxdepth 1 -name "*.md" -not -name "MEMORY.md" -print0 2>/dev/null)

# --- detect issues ---
ORPHANS=()
BROKEN=()
CHANGED=false

# orphans: on disk, not in index
for fname in "${!DISK_FILES[@]}"; do
  if [ -z "${INDEX_ENTRIES[$fname]+x}" ]; then
    ORPHANS+=("$fname")
    CHANGED=true
  fi
done

# broken pointers: in index, not on disk
for fname in "${!INDEX_ENTRIES[@]}"; do
  if [ -z "${DISK_FILES[$fname]+x}" ]; then
    BROKEN+=("$fname")
    CHANGED=true
  fi
done

# --- warn about domain: field (SPEC-104 anticipation) ---
for f in "$MEMORY_DIR"/*.md; do
  [ -f "$f" ] || continue
  if ! grep -q "^domain:" "$f" 2>/dev/null; then
    echo "Note: $(basename $f) lacks domain: field (SPEC-104 will require this)" >&2
  fi
done

if ! $CHANGED; then
  echo "MEMORY.md is in sync — no changes needed."
  exit 0
fi

# --- report ---
if [ ${#ORPHANS[@]} -gt 0 ]; then
  echo "ORPHANS (files without index entries):"
  for o in "${ORPHANS[@]}"; do
    echo "  + $o → will add entry"
    echo "CHANGES: orphan $o"
  done
fi
if [ ${#BROKEN[@]} -gt 0 ]; then
  echo "BROKEN POINTERS (index entries without files):"
  for b in "${BROKEN[@]}"; do
    echo "  - $b → will remove entry"
    echo "CHANGES: broken $b"
  done
fi

if $DRY_RUN && ! $REBUILD; then
  echo "Dry-run complete. Run with --rebuild to apply changes."
  [ ${#BROKEN[@]} -gt 0 ] && exit 2
  [ ${#ORPHANS[@]} -gt 0 ] && exit 3
  exit 0
fi

# --- rebuild ---
echo "Rebuilding MEMORY.md..."

# Build new content: preserve non-entry lines, rebuild entry lines
NEW_LINES=()
if [ -f "$MEMORY_INDEX" ]; then
  while IFS= read -r line; do
    # If it's a memory entry line, skip — we'll regenerate
    if [[ "$line" =~ ^\-\ \[([^]]+)\]\(memories/ ]]; then
      continue
    fi
    NEW_LINES+=("$line")
  done < "$MEMORY_INDEX"
fi

# Add entries for all disk files (sorted)
for fname in $(echo "${!DISK_FILES[@]}" | tr ' ' '\n' | sort); do
  DESC="${DISK_FILES[$fname]}"
  ENTRY="- [${fname}](memories/${fname}.md) — ${DESC}"
  if [ ${#ENTRY} -gt 200 ]; then
    ENTRY="${ENTRY:0:197}...[truncated]"
    echo "Warning: entry for $fname truncated to 200 chars" >&2
  fi
  NEW_LINES+=("$ENTRY")
done

# Write new MEMORY.md
printf '%s\n' "${NEW_LINES[@]}" > "$MEMORY_INDEX"
echo "wrote: $MEMORY_INDEX (${#DISK_FILES[@]} entries)"

# --- commit ---
REPO_ROOT=$(git -C "${ENTITY_DIR:-$PWD}" rev-parse --show-toplevel 2>/dev/null || true)
if [ -n "$REPO_ROOT" ]; then
  git -C "$REPO_ROOT" add "$MEMORY_INDEX" 2>/dev/null || true
  git -C "$REPO_ROOT" commit -m "memory: rebuild index — ${#DISK_FILES[@]} entries" 2>/dev/null || \
    echo "Note: git commit skipped (nothing staged or not in repo)"
fi

# --- log ---
LOG_DIR="${ENTITY_DIR:-$PWD}/logs"
mkdir -p "$LOG_DIR"
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] index --rebuild — ${#DISK_FILES[@]} entries, ${#ORPHANS[@]} added, ${#BROKEN[@]} removed" >> "$LOG_DIR/memory-commands.log"

[ ${#BROKEN[@]} -gt 0 ] && exit 2
[ ${#ORPHANS[@]} -gt 0 ] && exit 3
exit 0
