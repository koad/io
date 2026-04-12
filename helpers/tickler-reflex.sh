# tickler-reflex — path-addressed next-action surfacing on cd
#
# When you cd into a directory, this reflex checks every enabled entity's
# tickler for next actions filed at this exact location, and surfaces
# them so you can see who on the team has work pending here.
#
# Path schema (extends the existing host-level space/ convention with an
# absolute-path subtree):
#
#   ~/.<entity>/tickler/space/<host><absolute-path>/*.md
#
# Example: if vulcan has a tickle at
#   ~/.vulcan/tickler/space/wonderland/home/koad/some/project/fix-build.md
# then cd'ing to /home/koad/some/project on wonderland surfaces:
#   Tickler (space) · vulcan: 1 here
#     - Fix the build (fix-build.md)
#
# From there the operator can dispatch with a single word: `vulcan`.
#
# Enabled entities are self-discovered by walking ~/.<entity>/tickler/ —
# any entity directory that has a tickler/ subdirectory is considered
# enabled. No central registry needed. Framework meta-dirs (koad-io,
# .claude, .cache, etc.) are skipped.
#
# Tickles from ALL enabled entities surface regardless of $ENTITY —
# design intent is that the human operator (or any entity) can see the
# whole team's work at a given location and coordinate accordingly.
#
# Config:
#   KOAD_IO_TICKLER_REFLEX   1 (default) enable; 0 disable
#   KOAD_IO_HOST             override hostname detection (falls back to `hostname -s`)
#
# Silent when there's nothing to surface. Verbose only when there is.

if [ "${KOAD_IO_TICKLER_REFLEX:-1}" = "0" ]; then
  return 0 2>/dev/null || true
fi

_koad_io_tickler_reflex() {
  local host path_seg tickler_base entity_root entity space_dir
  local tickles=() t subject count

  host="${KOAD_IO_HOST:-$(hostname -s 2>/dev/null)}"
  [ -z "$host" ] && return 0
  path_seg="$PWD"

  # Walk every ~/.<entity>/tickler directory
  for tickler_base in "$HOME"/.*/tickler; do
    [ -d "$tickler_base" ] || continue

    entity_root="${tickler_base%/tickler}"
    entity="${entity_root#$HOME/.}"

    # Skip framework/meta dirs — only entity dirs should contribute
    case "$entity" in
      koad-io|claude|cache|config|local|nvm|npm|ssh|gnupg|\
      cargo|rustup|mozilla|thunderbird|docker|pki|icons|fonts|\
      bashrc*|profile*|bash_history|java|aws|azure|gcloud|\
      vscode*|subl*|kube)
        continue
        ;;
    esac

    space_dir="$tickler_base/space/$host$path_seg"
    [ -d "$space_dir" ] || continue

    # Gather open tickles (missing or empty `completion:` field = open)
    tickles=()
    for t in "$space_dir"/*.md; do
      [ -f "$t" ] || continue
      if grep -qE '^completion: *[^[:space:]]' "$t" 2>/dev/null; then
        continue  # has a completion stamp — closed
      fi
      tickles+=("$t")
    done

    count=${#tickles[@]}
    [ "$count" -eq 0 ] && continue

    echo "Tickler (space) · ${entity}: ${count} here"
    for t in "${tickles[@]}"; do
      subject=$(grep -m1 '^subject:' "$t" 2>/dev/null | sed 's/^subject: *//;s/^"//;s/"$//')
      if [ -z "$subject" ]; then
        subject=$(basename "$t" .md)
      fi
      echo "  - ${subject} (${t##*/})"
    done
  done
}

if declare -F koad_io_cd_register >/dev/null 2>&1; then
  koad_io_cd_register _koad_io_tickler_reflex
fi
