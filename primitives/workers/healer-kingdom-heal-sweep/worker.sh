#!/usr/bin/env bash
# PRIMITIVE: healer-kingdom-heal-sweep
# KIND: worker
# INTERVAL: 1440 (minutes — 24h)
# DELAY: 0 (fire at first interval boundary; runs before the operator's day starts)
# RUN_IMMEDIATELY: false
#
# Purpose: Healer role kingdom-wide heal sweep. Walks all entity dirs under
#          $HOME, detects orphan frontmatter (relates-to: refs to non-existent
#          paths), deprecated frontmatter keys, and broken trust-bond refs.
#          Emits one healer.finding.<type> event per finding. Writes a summary
#          report to ~/<entity>/heals/YYYY-MM-DD-auto-sweep.md at the end.
#
# Auto-fix scope (safe, idempotent):
#   - None in this primitive. Detection only. Salus or Jesus take action
#     from the emitted findings. Auto-fix requires entity-specific context
#     and a separate flight; a worker that silently rewrites frontmatter
#     without human review is too dangerous at kingdom-wide scope.
#
# Deprecated key detection (VESTA registry conventions):
#   - related-briefs: → use relates-to:
#   - specs:          → use related-specs:
#
# Roles: healer (installs for Salus, Jesus, and any future healer entity)
#
# Idempotent: read-only scan. Writes a new dated report per run.
#             Overwrites same-day report if run twice in one day (safe).
#
# Env vars expected:
#   ENTITY           — entity handle (e.g. "salus")
#   ENTITY_DIR       — entity home dir (e.g. /home/koad/.salus)
#   KOAD_IO_EMIT     — 1 to enable emission, 0/unset to skip
#   HOME             — operator home dir

set -uo pipefail

ENTITY="${ENTITY:-healer}"
ENTITY_DIR="${ENTITY_DIR:-${HOME}/.${ENTITY}}"
HEALS_DIR="${ENTITY_DIR}/heals"
TODAY="$(date +%Y-%m-%d)"
REPORT_FILE="${HEALS_DIR}/${TODAY}-auto-sweep.md"

source "${HOME}/.koad-io/helpers/emit.sh" 2>/dev/null || true

koad_io_emit_open service "healer-kingdom-heal-sweep: starting kingdom-wide heal sweep for ${ENTITY}"

# Ensure heals dir exists
mkdir -p "${HEALS_DIR}" 2>/dev/null || true

# Counters
ENTITIES_SCANNED=0
ORPHAN_COUNT=0
DEPRECATED_KEY_COUNT=0
BOND_REF_COUNT=0
TOTAL_FINDINGS=0

# Collect findings into an array (use temp file for portability)
FINDINGS_TMP="$(mktemp)"
trap 'rm -f "${FINDINGS_TMP}"' EXIT

# ---------------------------------------------------------------------------
# Walk entity dirs: ~/<entity>/  (dot-dirs under HOME with .env containing KOAD_IO_)
# ---------------------------------------------------------------------------

for entity_path in "${HOME}"/.*; do
  [ -d "${entity_path}" ] || continue
  env_file="${entity_path}/.env"
  [ -f "${env_file}" ] || continue
  grep -q "KOAD_IO_" "${env_file}" 2>/dev/null || continue

  entity_handle="$(basename "${entity_path}" | sed 's/^\.//')"
  ENTITIES_SCANNED=$((ENTITIES_SCANNED + 1))

  # --- Scan markdown files for orphan frontmatter ---
  while IFS= read -r -d '' md_file; do
    # Guard: skip broken symlinks and unreadable files
    if [ ! -r "${md_file}" ]; then
      TOTAL_FINDINGS=$((TOTAL_FINDINGS + 1))
      rel_file="${md_file#${HOME}/}"
      printf 'broken-symlink|%s|markdown file is a broken symlink or unreadable\n' "${rel_file}" >> "${FINDINGS_TMP}"
      koad_io_emit_update "healer-kingdom-heal-sweep: broken symlink ${rel_file}"
      continue
    fi

    # Extract relates-to: values from frontmatter (YAML block at top)
    # Only read up to the closing --- of frontmatter (first 50 lines)
    in_frontmatter=false
    frontmatter_done=false
    line_count=0

    while IFS= read -r line && [ $line_count -lt 50 ]; do
      line_count=$((line_count + 1))

      if [ $line_count -eq 1 ] && [ "${line}" = "---" ]; then
        in_frontmatter=true
        continue
      fi

      if [ "${in_frontmatter}" = "true" ] && [ "${line}" = "---" ]; then
        frontmatter_done=true
        break
      fi

      if [ "${in_frontmatter}" = "true" ]; then
        # Check for relates-to: entries (single value or list items)
        # Match: "  - ~/path" or "relates-to: ~/path"
        if printf '%s\n' "${line}" | grep -qE "^\s*(- )?(~/|/home/)"; then
          ref_path="$(printf '%s\n' "${line}" | grep -oE "(~/[^[:space:]]+|/home/[^[:space:]]+)" | head -1)"
          # Expand ~ to HOME
          ref_path_expanded="${ref_path/#\~/$HOME}"

          if [ -n "${ref_path_expanded}" ] && [ ! -e "${ref_path_expanded}" ]; then
            ORPHAN_COUNT=$((ORPHAN_COUNT + 1))
            TOTAL_FINDINGS=$((TOTAL_FINDINGS + 1))
            rel_file="${md_file#${HOME}/}"
            printf 'orphan|%s|relates-to ref does not exist: %s\n' "${rel_file}" "${ref_path}" >> "${FINDINGS_TMP}"
            koad_io_emit_update "healer-kingdom-heal-sweep: orphan ref in ${rel_file} → ${ref_path}"
          fi
        fi

        # Check for deprecated frontmatter keys
        if printf '%s\n' "${line}" | grep -qE "^(related-briefs|specs):"; then
          deprecated_key="$(printf '%s\n' "${line}" | cut -d: -f1)"
          replacement=""
          case "${deprecated_key}" in
            related-briefs) replacement="relates-to" ;;
            specs)          replacement="related-specs" ;;
          esac
          DEPRECATED_KEY_COUNT=$((DEPRECATED_KEY_COUNT + 1))
          TOTAL_FINDINGS=$((TOTAL_FINDINGS + 1))
          rel_file="${md_file#${HOME}/}"
          printf 'deprecated-key|%s|deprecated key "%s" should be "%s"\n' "${rel_file}" "${deprecated_key}" "${replacement}" >> "${FINDINGS_TMP}"
          koad_io_emit_update "healer-kingdom-heal-sweep: deprecated key in ${rel_file}: ${deprecated_key} → ${replacement}"
        fi
      fi
    done < "${md_file}"
  done < <(find "${entity_path}" -maxdepth 4 -name "*.md" -not -path "*/.git/*" -print0 2>/dev/null)

  # --- Scan trust bond refs ---
  trust_dir="${entity_path}/trust/bonds"
  if [ -d "${trust_dir}" ]; then
    while IFS= read -r -d '' bond_file; do
      # Trust bond files reference other entity dirs — check for stale paths embedded
      if grep -qE "(~\/\.[a-z]+\/)|(\/home\/[a-z]+\/\.[a-z]+\/)" "${bond_file}" 2>/dev/null; then
        while IFS= read -r ref_line; do
          ref_path="$(printf '%s\n' "${ref_line}" | grep -oE "(~/\.[a-zA-Z0-9_-]+/[^ ]+|/home/[a-zA-Z0-9_-]+/\.[a-zA-Z0-9_-]+/[^ ]+)" | head -1)"
          if [ -n "${ref_path}" ]; then
            ref_expanded="${ref_path/#\~/$HOME}"
            if [ ! -e "${ref_expanded}" ]; then
              BOND_REF_COUNT=$((BOND_REF_COUNT + 1))
              TOTAL_FINDINGS=$((TOTAL_FINDINGS + 1))
              rel_bond="${bond_file#${HOME}/}"
              printf 'broken-bond-ref|%s|referenced path does not exist: %s\n' "${rel_bond}" "${ref_path}" >> "${FINDINGS_TMP}"
              koad_io_emit_update "healer-kingdom-heal-sweep: broken bond ref in ${rel_bond} → ${ref_path}"
            fi
          fi
        done < <(grep -E "(~\/\.[a-z]+\/)|(\/home\/[a-z]+\/\.[a-z]+\/)" "${bond_file}" 2>/dev/null)
      fi
    done < <(find "${trust_dir}" \( -name "*.md" -o -name "*.asc" \) -print0 2>/dev/null)
  fi
done

# ---------------------------------------------------------------------------
# Write summary report
# ---------------------------------------------------------------------------

{
  echo "---"
  printf 'date: %s\n' "${TODAY}"
  echo "kind: auto-sweep"
  printf 'entity: %s\n' "${ENTITY}"
  echo "scope: kingdom-wide"
  printf 'entities-scanned: %d\n' "${ENTITIES_SCANNED}"
  printf 'total-findings: %d\n' "${TOTAL_FINDINGS}"
  printf 'orphan-refs: %d\n' "${ORPHAN_COUNT}"
  printf 'deprecated-keys: %d\n' "${DEPRECATED_KEY_COUNT}"
  printf 'broken-bond-refs: %d\n' "${BOND_REF_COUNT}"
  echo "---"
  echo ""
  printf '# Kingdom Heal Sweep — %s\n' "${TODAY}"
  echo ""
  printf '**Entities scanned:** %d  \n' "${ENTITIES_SCANNED}"
  printf '**Total findings:** %d  \n' "${TOTAL_FINDINGS}"
  echo ""

  if [ "${TOTAL_FINDINGS}" -eq 0 ]; then
    echo "No findings. Kingdom frontmatter is clean."
  else
    echo "## Findings"
    echo ""
    echo "| Type | File | Detail |"
    echo "|------|------|--------|"
    while IFS='|' read -r ftype fpath fdetail; do
      printf '| %s | %s | %s |\n' "${ftype}" "${fpath}" "${fdetail}"
    done < "${FINDINGS_TMP}"
  fi
} > "${REPORT_FILE}"

koad_io_emit_close "healer-kingdom-heal-sweep: complete — ${ENTITIES_SCANNED} entities, ${TOTAL_FINDINGS} findings (orphan: ${ORPHAN_COUNT}, deprecated-keys: ${DEPRECATED_KEY_COUNT}, bond-refs: ${BOND_REF_COUNT}) → ${REPORT_FILE#${HOME}/}"
