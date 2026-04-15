#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# harness/rebuild-agents — regenerate Claude Code subagent definition files
#
# Usage:
#   <entity> harness rebuild-agents [--all | <entity-name>] [--diff] [--dry-run]
#   <entity> harness rebuild-agents --migrate-dispatch [--all | <entity-name>] [--diff] [--dry-run]
#
# Examples:
#   juno harness rebuild-agents vulcan                    # regen vulcan.md from sources
#   juno harness rebuild-agents --all                     # regen all 20 agent files
#   juno harness rebuild-agents vulcan --diff             # show what would change, don't write
#   juno harness rebuild-agents --all --dry-run           # dry run all
#   juno harness rebuild-agents --migrate-dispatch --all  # one-time backfill from existing files
#   juno harness rebuild-agents --migrate-dispatch vulcan --dry-run
#
# What this command does (Stage 2 — full regeneration from structured data sources):
#
#   Normal mode (regen):
#     1. Reads passenger.json for handle, name, dispatch.color, dispatch.model
#     2. Reads bond file for bond type
#     3. Reads ~/.<entity>/agent-description.md for description prose
#     4. Reads existing agent file for body prose (preserved verbatim)
#     5. Renders the agent file from template — idempotent
#     6. Validates bond type against canonical six
#
#   Migration mode (--migrate-dispatch):
#     1. Reads color + model from existing agent file frontmatter
#     2. Writes dispatch.color + dispatch.model into passenger.json
#     3. Extracts description from existing agent file frontmatter
#     4. Unescapes \n sequences to real newlines (SPEC-108 §5 conformance)
#     5. Writes ~/.<entity>/agent-description.md
#     6. Does NOT modify the agent file — sources only
#     7. Does NOT run on entities that already have both sources
#
# Data sources (read):
#   ~/.<entity>/passenger.json          — handle, name, dispatch.color, dispatch.model
#   ~/.juno/trust/bonds/juno-to-<entity>.md — bond type
#   ~/.<entity>/agent-description.md    — description prose (canonical source after migration)
#   ~/.juno/.claude/agents/<entity>.md  — existing body prose (preserved; source for migration)
#
# Output target:
#   ~/.juno/.claude/agents/<entity>.md  — regenerated in-place (unless --dry-run / --diff)
#
# References:
#   VESTA-SPEC-108 — Subagent Manifest Data Contract (color, model, description)
#   VESTA-SPEC-072 — Entity-Dir-as-Harness-Container
#   VESTA-SPEC-063 — Outfit Schema (passenger.json is the identity document)
#   Assessment: ~/.vulcan/assessments/2026-04-15-rebuild-agents-stage-2.md

set -euo pipefail

# --- Paths -----------------------------------------------------------------

JUNO_DIR="${HOME}/.juno"
AGENTS_DIR="${JUNO_DIR}/.claude/agents"
BONDS_DIR="${JUNO_DIR}/trust/bonds"
ENTITY_HOMES_BASE="${HOME}"

# Canonical hooks block — identical across all 20 agents.
CANONICAL_HOOKS='hooks:
  PreToolUse:
    - matcher: Bash
      hooks:
        - type: command
          command: /home/koad/.juno/hooks/subagent-env-prefix.py'

# Canonical six bond types (SPEC-108 §5 reference; defined in entity model)
CANONICAL_BOND_TYPES="authorized-agent authorized-builder authorized-specialist peer customer member"

# --- Flag parsing ----------------------------------------------------------

TARGET_ALL=0
DRY_RUN=0
DIFF_MODE=0
MIGRATE_DISPATCH=0
TARGET_ENTITY=""

for arg in "$@"; do
  case "$arg" in
    --all)              TARGET_ALL=1 ;;
    --dry-run)          DRY_RUN=1 ;;
    --diff)             DIFF_MODE=1 ;;
    --migrate-dispatch) MIGRATE_DISPATCH=1 ;;
    --*)
      echo "Error: unknown flag '$arg'" >&2
      echo "  Usage: <entity> harness rebuild-agents [--migrate-dispatch] [--all | <entity-name>] [--diff] [--dry-run]" >&2
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
  echo "  Usage: <entity> harness rebuild-agents [--migrate-dispatch] [--all | <entity-name>] [--diff] [--dry-run]" >&2
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
  grep -m1 '^type:' "$bond_file" | sed 's/^type:[[:space:]]*//' | tr -d '\r'
}

# --- Validate bond type against canonical six ------------------------------

validate_bond_type() {
  local bond_type="$1"
  local entity="$2"
  for valid in $CANONICAL_BOND_TYPES; do
    [ "$bond_type" = "$valid" ] && return 0
  done
  echo "Error: bond type '${bond_type}' for entity '${entity}' is not in canonical six." >&2
  echo "  Canonical bond types: ${CANONICAL_BOND_TYPES}" >&2
  echo "  Source: ${BONDS_DIR}/juno-to-${entity}.md" >&2
  return 1
}

# --- Python helper: extract fields from agent file -------------------------
# Outputs: color|model|description (description with real newlines, \n unescaped)
# Also outputs body prose starting from the line after second ---

extract_agent_fields() {
  local agent_file="$1"
  python3 - "$agent_file" <<'PYEOF'
import sys, json, re

with open(sys.argv[1], 'r') as f:
    content = f.read()

lines = content.split('\n')
delims = [i for i, l in enumerate(lines) if l.strip() == '---']
if len(delims) < 2:
    print("ERROR: no frontmatter delimiters", file=sys.stderr)
    sys.exit(1)

fm_lines = lines[delims[0]+1:delims[1]]
body_lines = lines[delims[1]+1:]

fields = {}

i = 0
while i < len(fm_lines):
    line = fm_lines[i]
    if line.startswith('color:'):
        fields['color'] = line[len('color:'):].strip().strip('"')
    elif line.startswith('model:'):
        fields['model'] = line[len('model:'):].strip().strip('"')
    elif line.startswith('description:'):
        rest = line[len('description:'):].strip()
        if rest.startswith('"'):
            # JSON-quoted string — may span multiple lines in file if it contains real newlines
            # OR may be a single line with \n escapes
            full = rest
            j = i + 1
            parsed = None
            while True:
                try:
                    parsed = json.loads(full)
                    break
                except json.JSONDecodeError:
                    if j < len(fm_lines):
                        full += '\n' + fm_lines[j]
                        j += 1
                    else:
                        break
            if parsed is None:
                # Fallback: strip quotes, unescape manually
                parsed = rest.strip('"').replace('\\n', '\n').replace('\\"', '"')
            fields['description'] = parsed
        else:
            fields['description'] = rest
    i += 1

# Unescape any remaining literal \n sequences (non-conformant files per SPEC-108 §5)
if 'description' in fields:
    desc = fields['description']
    # Replace literal \n (two chars) with real newline if not already real newlines
    if '\n' not in desc and '\\n' in desc:
        desc = desc.replace('\\n', '\n')
    fields['description'] = desc

print(f"COLOR:{fields.get('color','')}")
print(f"MODEL:{fields.get('model','')}")
print(f"DESCRIPTION_START")
print(fields.get('description',''))
print(f"DESCRIPTION_END")
print(f"BODY_START")
print('\n'.join(body_lines))
print(f"BODY_END")
PYEOF
}

# --- Python helper: extract just color and model from agent file -----------

extract_color_model() {
  local agent_file="$1"
  python3 - "$agent_file" <<'PYEOF'
import sys

with open(sys.argv[1], 'r') as f:
    content = f.read()

lines = content.split('\n')
delims = [i for i, l in enumerate(lines) if l.strip() == '---']
fm_lines = lines[delims[0]+1:delims[1]]

color = ''
model = ''
for line in fm_lines:
    if line.startswith('color:'):
        color = line[len('color:'):].strip().strip('"')
    elif line.startswith('model:'):
        model = line[len('model:'):].strip().strip('"')

print(f"{color}|{model}")
PYEOF
}

# --- Python helper: extract description from agent file -------------------

extract_description() {
  local agent_file="$1"
  python3 - "$agent_file" <<'PYEOF'
import sys, json

with open(sys.argv[1], 'r') as f:
    content = f.read()

lines = content.split('\n')
delims = [i for i, l in enumerate(lines) if l.strip() == '---']
fm_lines = lines[delims[0]+1:delims[1]]

desc = None
i = 0
while i < len(fm_lines):
    line = fm_lines[i]
    if line.startswith('description:'):
        rest = line[len('description:'):].strip()
        if rest.startswith('"'):
            full = rest
            j = i + 1
            while True:
                try:
                    desc = json.loads(full)
                    break
                except json.JSONDecodeError:
                    if j < len(fm_lines):
                        full += '\n' + fm_lines[j]
                        j += 1
                    else:
                        break
            if desc is None:
                desc = rest.strip('"').replace('\\n', '\n').replace('\\"', '"')
        else:
            desc = rest
        break
    i += 1

if desc is None:
    desc = ''

# Unescape literal \n sequences (SPEC-108 §5)
if '\n' not in desc and '\\n' in desc:
    desc = desc.replace('\\n', '\n')

# Output description prose with real newlines (no trailing newline added)
sys.stdout.write(desc)
PYEOF
}

# --- Python helper: extract body prose from agent file --------------------

extract_body() {
  local agent_file="$1"
  python3 - "$agent_file" <<'PYEOF'
import sys

with open(sys.argv[1], 'r') as f:
    content = f.read()

lines = content.split('\n')
delims = [i for i, l in enumerate(lines) if l.strip() == '---']
if len(delims) < 2:
    sys.exit(0)

# Body is everything after the second ---
body_lines = lines[delims[1]+1:]
# Strip leading blank line if present
if body_lines and body_lines[0] == '':
    body_lines = body_lines[1:]

sys.stdout.write('\n'.join(body_lines))
PYEOF
}

# --- Python helper: update passenger.json with dispatch fields ------------

update_passenger_dispatch() {
  local passenger_file="$1"
  local color="$2"
  local model="$3"
  python3 - "$passenger_file" "$color" "$model" <<'PYEOF'
import sys, json

passenger_file = sys.argv[1]
color = sys.argv[2]
model = sys.argv[3]

with open(passenger_file, 'r') as f:
    data = json.load(f)

if 'dispatch' not in data:
    data['dispatch'] = {}

data['dispatch']['color'] = color
data['dispatch']['model'] = model

with open(passenger_file, 'w') as f:
    json.dump(data, f, indent=2)
    f.write('\n')

print(f"Updated {passenger_file}: dispatch.color={color} dispatch.model={model}")
PYEOF
}

# --- Python helper: create passenger.json for entities missing it ---------

create_passenger_json() {
  local entity_dir="$1"
  local entity="$2"
  local color="$3"
  local model="$4"
  local passenger_file="${entity_dir}/passenger.json"
  python3 - "$passenger_file" "$entity" "$color" "$model" <<'PYEOF'
import sys, json

passenger_file = sys.argv[1]
entity = sys.argv[2]
color = sys.argv[3]
model = sys.argv[4]

# Minimal passenger.json with dispatch fields
data = {
    "handle": entity,
    "name": entity.capitalize(),
    "dispatch": {
        "color": color,
        "model": model
    }
}

with open(passenger_file, 'w') as f:
    json.dump(data, f, indent=2)
    f.write('\n')

print(f"Created {passenger_file}: dispatch.color={color} dispatch.model={model}")
PYEOF
}

# --- Python helper: render agent file from sources ------------------------
# Reads passenger.json, bond type, agent-description.md, body prose
# Returns the full rendered agent file content to stdout

render_agent() {
  local entity="$1"
  local entity_dir="$2"
  local bond_type="$3"
  local description_file="${entity_dir}/agent-description.md"
  local passenger_file="${entity_dir}/passenger.json"

  python3 - "$entity" "$entity_dir" "$bond_type" "$description_file" "$passenger_file" "$AGENTS_DIR" "$CANONICAL_HOOKS" <<'PYEOF'
import sys, json

entity = sys.argv[1]
entity_dir = sys.argv[2]
bond_type = sys.argv[3]
description_file = sys.argv[4]
passenger_file = sys.argv[5]
agents_dir = sys.argv[6]
canonical_hooks = sys.argv[7]

# Read passenger.json
with open(passenger_file, 'r') as f:
    passenger = json.load(f)

dispatch = passenger.get('dispatch', {})
color = dispatch.get('color', '')
model = dispatch.get('model', 'sonnet')
name = passenger.get('name', entity)

# Read description from agent-description.md
with open(description_file, 'r') as f:
    description = f.read().strip()

# Read body prose from existing agent file
agent_file = f"{agents_dir}/{entity}.md"
with open(agent_file, 'r') as f:
    content = f.read()

lines = content.split('\n')
delims = [i for i, l in enumerate(lines) if l.strip() == '---']
if len(delims) < 2:
    print(f"Error: no frontmatter in {agent_file}", file=sys.stderr)
    sys.exit(1)

body_lines = lines[delims[1]+1:]
# Strip single leading blank line
if body_lines and body_lines[0] == '':
    body_lines = body_lines[1:]

body = '\n'.join(body_lines)

# Patch bond type in opening body sentence
# Pattern: "You hold the `juno-to-<entity>: <type>` trust bond"
import re
body = re.sub(
    r'(juno-to-' + re.escape(entity) + r':\s*)[a-z-]+(\s*`)',
    r'\g<1>' + bond_type + r'\2',
    body
)

# Render description as YAML block scalar with | notation
# Each line of the description gets 2-space indent
desc_lines = description.split('\n')
desc_yaml_lines = ['  ' + line if line else '' for line in desc_lines]
desc_yaml = 'description: |\n' + '\n'.join(desc_yaml_lines)

# Build frontmatter
frontmatter_parts = [
    f'name: {name.lower()}',
    desc_yaml,
    f'model: {model}',
    f'color: {color}',
    'memory: project',
    canonical_hooks,
]

frontmatter = '\n'.join(frontmatter_parts)

# Assemble full file
rendered = f'---\n{frontmatter}\n---\n\n{body}'

# Ensure single trailing newline
if not rendered.endswith('\n'):
    rendered += '\n'

sys.stdout.write(rendered)
PYEOF
}

# --- Migration: --migrate-dispatch for one entity -------------------------

migrate_entity_dispatch() {
  local entity="$1"
  local entity_dir="${ENTITY_HOMES_BASE}/.${entity}"
  local agent_file="$AGENTS_DIR/${entity}.md"
  local passenger_file="${entity_dir}/passenger.json"
  local desc_file="${entity_dir}/agent-description.md"

  echo ""
  echo "entity: ${entity}"

  # --- File checks
  if [ ! -f "$agent_file" ]; then
    echo "  MISS  agent file not found: ${agent_file}"
    return 1
  fi

  if [ ! -d "$entity_dir" ]; then
    echo "  MISS  entity dir not found: ${entity_dir}"
    return 1
  fi

  # --- Check what's already done
  local need_passenger=0
  local need_desc=0

  if [ ! -f "$passenger_file" ]; then
    need_passenger=1
  else
    # Check if dispatch fields already present
    has_dispatch=$(python3 -c "
import json, sys
d = json.load(open('$passenger_file'))
disp = d.get('dispatch', {})
if 'color' in disp and 'model' in disp:
    print('yes')
else:
    print('no')
" 2>/dev/null || echo "no")
    [ "$has_dispatch" = "no" ] && need_passenger=1
  fi

  [ ! -f "$desc_file" ] && need_desc=1

  if [ "$need_passenger" -eq 0 ] && [ "$need_desc" -eq 0 ]; then
    echo "  SKIP  already migrated (dispatch + description sources present)"
    return 0
  fi

  # --- Extract color and model from agent file
  local color_model
  color_model=$(extract_color_model "$agent_file")
  local color="${color_model%%|*}"
  local model="${color_model##*|}"

  if [ -z "$color" ] || [ -z "$model" ]; then
    echo "  ERR   could not extract color/model from ${agent_file}"
    return 1
  fi

  echo "  read  color=${color} model=${model} (from agent file)"

  # --- Passenger.json update
  if [ "$need_passenger" -eq 1 ]; then
    if [ "$DRY_RUN" -eq 1 ]; then
      echo "  DRY   would write dispatch.color=${color} dispatch.model=${model} to ${passenger_file}"
    elif [ "$DIFF_MODE" -eq 1 ]; then
      echo "  DIFF  dispatch.color=${color} dispatch.model=${model} → ${passenger_file}"
      if [ -f "$passenger_file" ]; then
        echo "  ---   current passenger.json (dispatch section):"
        python3 -c "import json; d=json.load(open('$passenger_file')); print('        dispatch:', json.dumps(d.get('dispatch','(missing)')))"
      else
        echo "  ---   passenger.json does not exist — would create"
      fi
      echo "  +++   new: dispatch.color=${color} dispatch.model=${model}"
    else
      if [ ! -f "$passenger_file" ]; then
        create_passenger_json "$entity_dir" "$entity" "$color" "$model"
        echo "  NEW   created passenger.json with dispatch fields"
      else
        update_passenger_dispatch "$passenger_file" "$color" "$model"
        echo "  OK    dispatch fields written to passenger.json"
      fi
    fi
  else
    echo "  SKIP  passenger.json dispatch fields already present"
  fi

  # --- agent-description.md extraction
  if [ "$need_desc" -eq 1 ]; then
    local description
    description=$(extract_description "$agent_file")

    if [ -z "$description" ]; then
      echo "  ERR   could not extract description from ${agent_file}"
      return 1
    fi

    local desc_lines
    desc_lines=$(echo "$description" | wc -l)
    local desc_len=${#description}
    echo "  read  description: ${desc_lines} lines, ${desc_len} chars"

    if [ "$DRY_RUN" -eq 1 ]; then
      echo "  DRY   would write ${desc_len} chars to ${desc_file}"
    elif [ "$DIFF_MODE" -eq 1 ]; then
      echo "  DIFF  would create ${desc_file} (${desc_len} chars, ${desc_lines} lines)"
      echo "  +++   first line: $(echo "$description" | head -1)"
    else
      printf '%s\n' "$description" > "$desc_file"
      echo "  OK    agent-description.md created (${desc_len} chars)"
    fi
  else
    echo "  SKIP  agent-description.md already exists"
  fi

  return 0
}

# --- Regen: full regeneration for one entity ------------------------------

regen_entity() {
  local entity="$1"
  local entity_dir="${ENTITY_HOMES_BASE}/.${entity}"
  local agent_file="$AGENTS_DIR/${entity}.md"
  local passenger_file="${entity_dir}/passenger.json"
  local desc_file="${entity_dir}/agent-description.md"

  echo ""
  echo "entity: ${entity}"

  # --- File existence checks
  if [ ! -f "$agent_file" ]; then
    echo "  MISS  agent file not found: ${agent_file}"
    return 1
  fi

  if [ ! -f "$passenger_file" ]; then
    echo "  MISS  passenger.json not found: ${passenger_file}"
    echo "  NOTE  run --migrate-dispatch first"
    return 1
  fi

  if [ ! -f "$desc_file" ]; then
    echo "  MISS  agent-description.md not found: ${desc_file}"
    echo "  NOTE  run --migrate-dispatch first"
    return 1
  fi

  # --- Validate dispatch fields in passenger.json
  has_dispatch=$(python3 -c "
import json, sys
d = json.load(open('$passenger_file'))
disp = d.get('dispatch', {})
color = disp.get('color', '')
model = disp.get('model', '')
if color and model:
    print(f'ok:{color}:{model}')
else:
    print('missing')
" 2>/dev/null || echo "missing")

  if [ "$has_dispatch" = "missing" ]; then
    echo "  ERR   passenger.json missing dispatch.color or dispatch.model"
    echo "  NOTE  run --migrate-dispatch first"
    return 1
  fi

  local disp_color="${has_dispatch#ok:}"
  disp_color="${disp_color%%:*}"
  local disp_model="${has_dispatch##*:}"

  # --- Validate bond type
  local bond_type
  bond_type=$(get_bond_type "$entity")
  if [ "$bond_type" = "MISSING" ]; then
    echo "  MISS  bond file not found: ${BONDS_DIR}/juno-to-${entity}.md"
    return 1
  fi

  if ! validate_bond_type "$bond_type" "$entity"; then
    return 1
  fi

  echo "  src   passenger.json: color=${disp_color} model=${disp_model}"
  echo "  src   bond type: ${bond_type}"
  echo "  src   description: $(wc -c < "$desc_file") chars"

  # --- Render the agent file
  local rendered
  rendered=$(render_agent "$entity" "$entity_dir" "$bond_type")

  if [ -z "$rendered" ]; then
    echo "  ERR   render produced empty output"
    return 1
  fi

  # --- Compare to existing
  local current
  current=$(cat "$agent_file")

  if [ "$rendered" = "$current" ]; then
    echo "  OK    no change (idempotent)"
    return 0
  fi

  # --- Show diff or apply
  if [ "$DIFF_MODE" -eq 1 ]; then
    echo "  DIFF  changes detected:"
    diff <(echo "$current") <(echo "$rendered") | head -40 | sed 's/^/        /'
  elif [ "$DRY_RUN" -eq 1 ]; then
    echo "  DRY   would regenerate ${agent_file}"
  else
    printf '%s' "$rendered" > "$agent_file"
    echo "  REGEN ${agent_file}"
  fi

  return 0
}

# --- Main ------------------------------------------------------------------

if [ "$MIGRATE_DISPATCH" -eq 1 ]; then
  MODE_LABEL="migrate-dispatch"
else
  MODE_LABEL="regen"
fi

echo "rebuild-agents"
echo "--------------"
echo "agents_dir  : $AGENTS_DIR"
echo "bonds_dir   : $BONDS_DIR"
echo "mode        : ${MODE_LABEL}"
[ "$DRY_RUN" -eq 1 ] && echo "flags       : dry-run (no writes)"
[ "$DIFF_MODE" -eq 1 ] && echo "flags       : diff (show changes only)"

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
SKIP=0

# Track skips via temp file (functions print directly; we grep output to count skips)
_SKIP_MARKER=$(mktemp)

while IFS= read -r entity; do
  [ -z "$entity" ] && continue
  if [ "$MIGRATE_DISPATCH" -eq 1 ]; then
    _entity_output=$(migrate_entity_dispatch "$entity" 2>&1) || { echo "$_entity_output"; MISS=$((MISS + 1)); continue; }
    echo "$_entity_output"
    if echo "$_entity_output" | grep -q 'SKIP  already migrated'; then
      SKIP=$((SKIP + 1))
    else
      PASS=$((PASS + 1))
    fi
  else
    _entity_output=$(regen_entity "$entity" 2>&1) || { echo "$_entity_output"; MISS=$((MISS + 1)); continue; }
    echo "$_entity_output"
    PASS=$((PASS + 1))
  fi
done <<< "$ENTITIES"

rm -f "$_SKIP_MARKER"

echo ""
echo "---"
if [ "$MIGRATE_DISPATCH" -eq 1 ]; then
  echo "result  : ${PASS} migrated  ${SKIP} already-done  ${MISS} failed"
  echo ""
  echo "Next: commit passenger.json and agent-description.md in each entity repo,"
  echo "then run 'harness rebuild-agents --all' to validate idempotence."
else
  echo "result  : ${PASS} ok  ${MISS} failed"
fi
echo ""
echo "SPEC-108: passenger.json/dispatch + agent-description.md are canonical sources."
echo "See assessment at ~/.vulcan/assessments/2026-04-15-rebuild-agents-stage-2.md"
