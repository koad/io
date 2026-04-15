#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# harness/rebuild-agents — regenerate Claude Code subagent definition files
#
# Usage:
#   <entity> harness rebuild-agents [--all | <entity-name>] [--diff] [--dry-run]
#
# Examples:
#   juno harness rebuild-agents vulcan        # check + patch vulcan.md
#   juno harness rebuild-agents --all         # check + patch all 20 agents
#   juno harness rebuild-agents vulcan --diff # show what would change, don't write
#   juno harness rebuild-agents --all --dry-run
#
# What this command does (Stage 1 — preserve body, patch structured fields):
#
#   For each agent file at $AGENTS_DIR/<entity>.md, this command:
#     1. Verifies the file exists (reports missing).
#     2. Reads the bond file at $BONDS_DIR/juno-to-<entity>.md for bond type.
#     3. Checks the hooks block is the canonical form (patches if wrong).
#     4. Reports bond-type drift — if the opening body sentence references
#        a different bond type than the bond file, flags it.
#     5. Does NOT rewrite description, model, color, or body prose —
#        those are hand-curated and have no machine-readable data source.
#
# Data sources (read-only):
#   $BONDS_DIR/juno-to-<entity>.md   — bond type (authorized-builder / authorized-specialist / peer)
#   $AGENTS_DIR/<entity>.md          — existing agent file (color, model, description, body prose)
#
# Output target:
#   $AGENTS_DIR/<entity>.md          — patched in-place (unless --dry-run / --diff)
#
# Future work (Stage 2 — not shipped here, see assessment):
#   - Store color + model in passenger.json so they are regenerable
#   - Full template regeneration from entity metadata
#   - --examples-from-source flag for curated examples refresh

set -euo pipefail

# --- Paths -----------------------------------------------------------------

JUNO_DIR="${HOME}/.juno"
AGENTS_DIR="${JUNO_DIR}/.claude/agents"
BONDS_DIR="${JUNO_DIR}/trust/bonds"

# Canonical hooks block — identical across all 20 agents.
# Any deviation from this exact YAML will be patched.
CANONICAL_HOOKS='hooks:
  PreToolUse:
    - matcher: Bash
      hooks:
        - type: command
          command: /home/koad/.juno/hooks/subagent-env-prefix.py'

# --- Flag parsing ----------------------------------------------------------

TARGET_ALL=0
DRY_RUN=0
DIFF_MODE=0
TARGET_ENTITY=""

for arg in "$@"; do
  case "$arg" in
    --all)      TARGET_ALL=1 ;;
    --dry-run)  DRY_RUN=1 ;;
    --diff)     DIFF_MODE=1 ;;
    --*)
      echo "Error: unknown flag '$arg'" >&2
      echo "  Usage: <entity> harness rebuild-agents [--all | <entity-name>] [--diff] [--dry-run]" >&2
      exit 64
      ;;
    *)
      if [ -n "$TARGET_ENTITY" ]; then
        echo "Error: more than one entity name given ('$TARGET_ENTITY' and '$arg')" >&2
        exit 64
      fi
      TARGET_ENTITY="$arg"
      ;;
  esac
done

if [ "$TARGET_ALL" -eq 1 ] && [ -n "$TARGET_ENTITY" ]; then
  echo "Error: cannot use --all and a specific entity name together." >&2
  exit 64
fi

if [ "$TARGET_ALL" -eq 0 ] && [ -z "$TARGET_ENTITY" ]; then
  echo "Error: specify --all or an entity name." >&2
  echo "  Usage: <entity> harness rebuild-agents [--all | <entity-name>] [--diff] [--dry-run]" >&2
  exit 64
fi

# --- Discover entity list --------------------------------------------------

discover_entities() {
  local entities=()
  for bond_file in "$BONDS_DIR"/juno-to-*.md; do
    [ -f "$bond_file" ] || continue
    local name
    name=$(basename "$bond_file" .md | sed 's/^juno-to-//')
    entities+=("$name")
  done
  # Sort for consistent output
  printf '%s\n' "${entities[@]}" | sort
}

# --- Read bond type from bond file -----------------------------------------

get_bond_type() {
  local entity="$1"
  local bond_file="$BONDS_DIR/juno-to-${entity}.md"
  if [ ! -f "$bond_file" ]; then
    echo "MISSING"
    return
  fi
  # Extract the 'type:' field from the YAML frontmatter
  grep -m1 '^type:' "$bond_file" | sed 's/^type:[[:space:]]*//' | tr -d '\r'
}

# --- Extract the hooks block from an agent file ----------------------------
# Returns the hooks block as it appears in the frontmatter (the lines from
# "hooks:" up to the closing "---").

get_agent_hooks_block() {
  local agent_file="$1"
  # Extract between the first --- and second --- (frontmatter), then find hooks block
  awk '
    /^---$/ { count++; if (count == 2) exit; next }
    count == 1 && /^hooks:/ { in_hooks=1 }
    in_hooks { print }
  ' "$agent_file"
}

# --- Check if hooks block matches canonical --------------------------------

hooks_match_canonical() {
  local agent_file="$1"
  local current_hooks
  current_hooks=$(get_agent_hooks_block "$agent_file")
  [ "$current_hooks" = "$CANONICAL_HOOKS" ]
}

# --- Patch the hooks block in an agent file --------------------------------
# Replaces the hooks block within the frontmatter, preserving everything else.

patch_hooks_block() {
  local agent_file="$1"
  # Extract frontmatter (lines between first and second ---)
  # Replace hooks block (from "hooks:" to end of frontmatter) with canonical
  python3 - "$agent_file" "$CANONICAL_HOOKS" <<'PYEOF'
import sys

agent_file = sys.argv[1]
canonical_hooks = sys.argv[2]

with open(agent_file, 'r') as f:
    content = f.read()

lines = content.split('\n')

# Find the frontmatter delimiters
first_sep = None
second_sep = None
for i, line in enumerate(lines):
    if line.strip() == '---':
        if first_sep is None:
            first_sep = i
        else:
            second_sep = i
            break

if first_sep is None or second_sep is None:
    print(f"Error: could not find frontmatter delimiters in {agent_file}", file=sys.stderr)
    sys.exit(1)

# Build the new frontmatter: keep everything up to "hooks:" line, then append canonical
frontmatter_lines = lines[first_sep+1:second_sep]
hooks_start = None
for i, line in enumerate(frontmatter_lines):
    if line.startswith('hooks:'):
        hooks_start = i
        break

if hooks_start is None:
    # No hooks block — append before the closing ---
    new_fm_lines = frontmatter_lines + canonical_hooks.split('\n')
else:
    new_fm_lines = frontmatter_lines[:hooks_start] + canonical_hooks.split('\n')

# Reassemble the file
new_lines = lines[:first_sep+1] + new_fm_lines + lines[second_sep:]
new_content = '\n'.join(new_lines)

with open(agent_file, 'w') as f:
    f.write(new_content)

print(f"Patched hooks block in {agent_file}")
PYEOF
}

# --- Check bond-type mention in agent body ---------------------------------
# Looks for "juno-to-<entity>: <type>" in the body prose and compares to bond file.

check_bond_type_drift() {
  local entity="$1"
  local agent_file="$2"
  local bond_type
  bond_type=$(get_bond_type "$entity")

  if [ "$bond_type" = "MISSING" ]; then
    echo "  WARN  no bond file found at $BONDS_DIR/juno-to-${entity}.md"
    return
  fi

  # Look for the bond reference pattern in the body (after the frontmatter)
  # Pattern: "juno-to-<entity>: <something>"
  local body_bond_ref
  body_bond_ref=$(awk '
    /^---$/ { count++; next }
    count >= 2
  ' "$agent_file" | grep -oE "juno-to-${entity}:[[:space:]]*[a-z-]+" | head -1 || true)

  if [ -z "$body_bond_ref" ]; then
    echo "  INFO  bond type in body: (no reference found) | bond file: ${bond_type}"
    return
  fi

  local body_type
  body_type=$(echo "$body_bond_ref" | sed 's/.*:[[:space:]]*//')

  if [ "$body_type" = "$bond_type" ]; then
    echo "  OK    bond type: ${bond_type} (body matches bond file)"
  else
    DRIFT=$((DRIFT + 1))
    echo "  DRIFT bond type in body: '${body_type}' | bond file: '${bond_type}' — mismatch"
  fi
}

# --- Process one agent file ------------------------------------------------

process_entity() {
  local entity="$1"
  local agent_file="$AGENTS_DIR/${entity}.md"

  echo ""
  echo "entity: ${entity}"

  # --- File existence check
  if [ ! -f "$agent_file" ]; then
    echo "  MISS  agent file not found: ${agent_file}"
    echo "  NOTE  no source data to regenerate from — create manually or add to Stage 2"
    return 1
  fi

  echo "  file  ${agent_file}"

  # --- Bond type check
  check_bond_type_drift "$entity" "$agent_file"

  # --- Hooks block check
  if hooks_match_canonical "$agent_file"; then
    echo "  OK    hooks block is canonical"
  else
    echo "  PATCH hooks block diverges from canonical"
    if [ "$DIFF_MODE" -eq 1 ]; then
      echo "  DIFF  (--diff mode: showing what would change)"
      echo "  ---   current hooks block:"
      get_agent_hooks_block "$agent_file" | sed 's/^/        /'
      echo "  +++   canonical hooks block:"
      echo "$CANONICAL_HOOKS" | sed 's/^/        /'
    elif [ "$DRY_RUN" -eq 1 ]; then
      echo "  SKIP  (--dry-run: would patch hooks block)"
    else
      patch_hooks_block "$agent_file"
    fi
  fi

  return 0
}

# --- Main ------------------------------------------------------------------

echo "rebuild-agents"
echo "--------------"
echo "agents_dir  : $AGENTS_DIR"
echo "bonds_dir   : $BONDS_DIR"
[ "$DRY_RUN" -eq 1 ] && echo "mode        : dry-run (no writes)"
[ "$DIFF_MODE" -eq 1 ] && echo "mode        : diff (show changes only)"
[ "$DRY_RUN" -eq 0 ] && [ "$DIFF_MODE" -eq 0 ] && echo "mode        : live (will patch if needed)"

if [ "$TARGET_ALL" -eq 1 ]; then
  ENTITIES=$(discover_entities)
  ENTITY_COUNT=$(echo "$ENTITIES" | wc -l)
  echo "target      : all (${ENTITY_COUNT} from bond discovery)"
else
  ENTITIES="$TARGET_ENTITY"
  echo "target      : ${TARGET_ENTITY}"
fi

PASS=0
MISS=0
PATCHED=0
DRIFT=0

while IFS= read -r entity; do
  [ -z "$entity" ] && continue
  if process_entity "$entity"; then
    PASS=$((PASS + 1))
  else
    MISS=$((MISS + 1))
  fi
done <<< "$ENTITIES"

echo ""
echo "---"
echo "result  : ${PASS} ok  ${MISS} missing  (${DRIFT} bond-type drift warnings above)"
echo ""
echo "Stage 1 scope: hooks-block patching + bond-type drift detection."
echo "Stage 2 (not shipped): full template regeneration requires color/model in passenger.json."
echo "See assessment at ~/.vulcan/assessments/2026-04-15-rebuild-agents-generator.md"
