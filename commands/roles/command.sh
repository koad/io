#!/usr/bin/env bash
#
# roles — roll call of every entity in the kingdom
#
# Scans ~/.<entity>/.env files for KOAD_IO_ENTITY_ROLE, ROLE, and PURPOSE.
# Prints a grouped roster: entities sorted by role, with purpose.
#
# Usage:
#   koad-io roles            — full roll call
#   koad-io roles engineer   — filter to one role
#   <entity> roles           — same thing, entity-agnostic command
#
set -euo pipefail

HOME_DIR="${HOME:-/home/$(whoami)}"
FILTER_ROLE="${1:-}"

declare -A roles purposes names

# Scan all dot-directories for entity .env files
for envfile in "$HOME_DIR"/.*/.env; do
  [ -f "$envfile" ] || continue
  entity_dir="$(dirname "$envfile")"
  handle="$(basename "$entity_dir" | sed 's/^\.//')"

  # Must have ENTITY= to be a real entity (skip .koad-io, .config, etc.)
  grep -q "^ENTITY=" "$envfile" 2>/dev/null || continue

  role=""
  purpose=""
  display_role=""

  # Parse the fields we care about
  while IFS= read -r line; do
    trimmed="${line%%#*}"
    trimmed="$(echo "$trimmed" | xargs)"
    [ -z "$trimmed" ] && continue
    case "$trimmed" in
      KOAD_IO_ENTITY_ROLE=*) role="${trimmed#KOAD_IO_ENTITY_ROLE=}" ;;
      ROLE=*)                display_role="${trimmed#ROLE=}" ;;
      PURPOSE=*)             purpose="${trimmed#PURPOSE=}" ;;
    esac
  done < "$envfile"

  # Strip surrounding quotes from purpose
  purpose="${purpose#\"}"
  purpose="${purpose%\"}"
  purpose="${purpose#\'}"
  purpose="${purpose%\'}"

  role="${role:-unassigned}"

  # Apply filter if given
  if [ -n "$FILTER_ROLE" ] && [ "$role" != "$FILTER_ROLE" ]; then
    continue
  fi

  roles[$handle]="$role"
  purposes[$handle]="$purpose"
done

# Nothing found?
if [ ${#roles[@]} -eq 0 ]; then
  if [ -n "$FILTER_ROLE" ]; then
    echo "No entities with role '$FILTER_ROLE'"
  else
    echo "No entities found"
  fi
  exit 0
fi

# Group by role
declare -A role_members
for handle in "${!roles[@]}"; do
  r="${roles[$handle]}"
  if [ -n "${role_members[$r]:-}" ]; then
    role_members[$r]="${role_members[$r]} $handle"
  else
    role_members[$r]="$handle"
  fi
done

# Sort role names
sorted_roles=($(printf '%s\n' "${!role_members[@]}" | sort))

# Print
echo ""
echo "  KINGDOM ROLL CALL"
echo "  ═════════════════"
echo ""

total=0
for r in "${sorted_roles[@]}"; do
  # Uppercase the role name for the header
  role_upper="$(echo "$r" | tr '[:lower:]' '[:upper:]')"
  echo "  ┌─ $role_upper"

  # Sort members within role
  members=($(echo "${role_members[$r]}" | tr ' ' '\n' | sort))

  for handle in "${members[@]}"; do
    p="${purposes[$handle]:-}"
    if [ -n "$p" ]; then
      echo "  │  $handle — $p"
    else
      echo "  │  $handle"
    fi
    total=$((total + 1))
  done
  echo "  │"
done

echo "  └─ $total entities across ${#sorted_roles[@]} roles"
echo ""
