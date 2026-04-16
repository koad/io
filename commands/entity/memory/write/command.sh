#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# entity memory write <name> — VULCAN-SPEC-EMCF-001 §3.1
# Lifecycle: WRITTEN → ACTIVE. Human-only — not ADAS-invocable.

set -euo pipefail

# --- resolve entity dir ---
MEMORY_DIR="${MEMORY_DIR:-${ENTITY_DIR:-$PWD}/memories}"

NAME=""
TYPE="project"
MESSAGE=""
IDENTITY_CRITICAL=false

# --- parse args ---
while [[ $# -gt 0 ]]; do
  case "$1" in
    --type)       TYPE="$2";    shift 2 ;;
    --message)    MESSAGE="$2"; shift 2 ;;
    --identity-critical) IDENTITY_CRITICAL=true; shift ;;
    --help|-h)
      cat <<HELP
Usage: entity memory write <name> [--type <user|feedback|project|reference>] [--message "<hook>"] [--identity-critical]

Write a new memory to the active entity's memories/ directory.

Arguments:
  name                  Short identifier, no spaces or path chars (required)

Flags:
  --type <type>         Memory type: user, feedback, project, reference (default: project)
  --message "<hook>"    One-line hook for MEMORY.md index entry (required)
  --identity-critical   Mark memory as identity-critical in frontmatter

Pre-conditions:
  - memories/ directory must exist
  - name must not contain spaces, /, or ..
  - name must not already exist (unless operator confirms in interactive mode)

Exit codes:
  0  success
  1  general error
  2  pre-check failure (file exists headless, invalid name)
  3  user rejected update prompt

Related: entity memory consolidate, entity memory verify, entity memory index
HELP
      exit 0
      ;;
    -*)           echo "Unknown flag: $1" >&2; exit 1 ;;
    *)
      if [ -z "$NAME" ]; then NAME="$1"; else echo "Unexpected argument: $1" >&2; exit 1; fi
      shift
      ;;
  esac
done

# --- validate name ---
if [ -z "$NAME" ]; then
  echo "Error: name is required." >&2
  echo "Usage: entity memory write <name> --message \"<hook>\"" >&2
  exit 1
fi
if [[ "$NAME" == *" "* ]] || [[ "$NAME" == *"/"* ]] || [[ "$NAME" == *".."* ]]; then
  echo "Error: name must not contain spaces, /, or .." >&2
  exit 2
fi

# --- validate message ---
if [ -z "$MESSAGE" ]; then
  echo "Error: --message is required." >&2
  exit 1
fi

# --- check memories dir ---
if [ ! -d "$MEMORY_DIR" ]; then
  echo "Error: memories/ directory not found at $MEMORY_DIR" >&2
  exit 1
fi

TARGET="$MEMORY_DIR/${NAME}.md"
MEMORY_INDEX="${MEMORY_DIR%/memories}/MEMORY.md"

# --- handle existing file ---
if [ -f "$TARGET" ]; then
  echo "Warning: $TARGET already exists." >&2
  read -p "Overwrite? [y/N] " CONFIRM
  if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 3
  fi
fi

# --- build frontmatter ---
IC_LINE=""
if [ "$IDENTITY_CRITICAL" = true ]; then
  IC_LINE="identity-critical: true"
fi

# --- write memory file ---
{
  echo "---"
  echo "name: ${NAME}"
  echo "description: ${MESSAGE}"
  echo "type: ${TYPE}"
  [ -n "$IC_LINE" ] && echo "$IC_LINE"
  echo "---"
  echo
  # body from stdin if available
  if [ -p /dev/stdin ] || [ -t 0 ] && false; then
    cat
  else
    cat 2>/dev/null || true
  fi
} > "$TARGET"

echo "wrote: $TARGET"

# --- update MEMORY.md ---
if [ -f "$MEMORY_INDEX" ]; then
  # truncate to 200 chars
  ENTRY="- [${NAME}](memories/${NAME}.md) — ${MESSAGE}"
  if [ ${#ENTRY} -gt 200 ]; then
    ENTRY="${ENTRY:0:197}..."
  fi
  echo "$ENTRY" >> "$MEMORY_INDEX"
  echo "updated: $MEMORY_INDEX"
else
  echo "Warning: MEMORY.md not found at $MEMORY_INDEX — skipping index update" >&2
fi

# --- log ---
LOG_DIR="${ENTITY_DIR:-$PWD}/logs"
mkdir -p "$LOG_DIR"
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] write ${TYPE}/${NAME} — ${MESSAGE}" >> "$LOG_DIR/memory-commands.log"

# --- commit ---
REPO_ROOT=$(git -C "${ENTITY_DIR:-$PWD}" rev-parse --show-toplevel 2>/dev/null || true)
if [ -n "$REPO_ROOT" ]; then
  git -C "$REPO_ROOT" add "$TARGET" "${MEMORY_INDEX}" 2>/dev/null || true
  git -C "$REPO_ROOT" commit -m "memory: add ${TYPE}/${NAME} — ${MESSAGE}" 2>/dev/null || \
    echo "Note: git commit skipped (nothing to commit or not in repo)"
fi

echo "Done."
