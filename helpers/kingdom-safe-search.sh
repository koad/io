#!/usr/bin/env bash
# shellcheck shell=bash
#
# Shared policy for the kingdom-safe grep/find wrappers in ~/.koad-io/bin.
# Sourced by the wrappers; not intended to execute on its own.

# ════════════════════════════════════════════════════════════════════════════
# THE POLICY — what a broad kingdom search may read
# ════════════════════════════════════════════════════════════════════════════
# This is not a list of directories we got burned by. It is a statement about
# which trees a *broad* search has no reason to read. A tree belongs in here if
# it is one of:
#
#   1. generated — built or downloaded from something else that is on disk
#   2. cached    — a package manager's or toolchain's working store
#   3. derived   — produced mechanically, and reproducible from a source
#   4. scratch   — an agent's or another entity's unbounded work tree
#   5. substrate — a live runtime's own internal state
#
# Why exclusion and not a timeout:
#
#   A process in uninterruptible disk wait (STAT D, folio_wait_bit_common) does
#   not answer signals until the I/O completes. Killing it, or wrapping it in a
#   timeout, does nothing. The only fix is to not open the tree at all, which
#   means pruning it by path *before* traversal, in the wrapper's own walk.
#
#   On 2026-10-18 a `grep -rl` issued by aegis descended into ~/.sibyl/work/ — an
#   agent scratch tree — and one of its children sat in D. The calling harness
#   wrote nothing for 9m05s and then resumed when the read completed. See
#   ~/.vulcan/assessments/2026-10-18-flight-liveness-what-actually-happened.md
#
# Nothing here becomes UNREACHABLE. Three escapes, all loud or explicit:
#   * name an excluded tree as the search root — it is searched, with a notice
#   * --raw / --full                        — bypass the policy entirely
#   * --show-excludes                       — print the live policy, from the
#                                             same arrays the walk uses

# ── Class 1 — generated / cached / derived, matched by basename at any depth ──
KG_SAFE_DIR_NAMES=(
  node_modules
  isopacks
  .git
  dist
  coverage
  vendor
  builds
  .cache
  cache
  # package-manager and toolchain stores. `.npm` was measured at 448M/36k files
  # inside a single staged package — same class as .yarn and .pnpm-store.
  .npm
  .yarn
  .pnpm-store
  .tmp
  tmp
  temp
  .next
  .nuxt
  .svelte-kit
  .turbo
  .parcel-cache
  .pytest_cache
  .opencode
  .claude
  # `.local` is basename-wide and already swallows the koad-io runtime below;
  # the explicit substrate zones are kept as a second, independent statement.
  .local
)

# ── Class 2 — generated, but only in a package-relative position ─────────────
# A bare directory named `local` can be meaningful. `.meteor/local` never is.
KG_SAFE_PATH_PATTERNS=(
  '*/.meteor/local'
  '*/.meteor/local/*'
)

# ── Classes 3/4/5 — absolute zones, expanded from these bounded globs ────────
# Bash globs do not cross `/`, so the depth is spelled out. The depth covers
# what the kingdom actually has today (measured 2026-10-19: 48 directories),
# and `--show-excludes` reports the count it expanded so drift is visible.
#
#   .*/sessions            entity session trees          (.sibyl/sessions)
#   .*/*/sessions          archived + harness sessions   (.sibyl/archive/sessions,
#                                                         .forge/harness/sessions,
#                                                         .pi/agent/sessions)
#   .*/work                agent scratch trees           (.sibyl/work)
#   .*/*/work              nested scratch trees
KG_SAFE_ZONE_GLOBS=(
  "$HOME/.*/sessions"
  "$HOME/.*/*/sessions"
  "$HOME/.*/work"
  "$HOME/.*/*/work"
)

# The policy, as written down rather than as expanded. Used for reporting.
KG_SAFE_ZONE_POLICY=(
  '~/.{entity}/sessions/'
  '~/.{entity}/*/sessions/'
  '~/.{entity}/work/'
)

# Volatile runtime substrate: the daemon's own state, a live passenger, etc.
# These are always concrete paths — there is no glob form to expand.
KG_SAFE_SUBSTRATE=(
  "$HOME/.local/share/koad-io/runtime"
  "$HOME/.local/share/koad-io/passenger"
)

# Filled by kg_safe_expand_zones. Concrete, existing absolute directories.
KG_SAFE_ZONES=()

kg_safe_join_by() {
  local _sep="$1"
  shift || true
  local _out=""
  local _first=1
  local _item
  for _item in "$@"; do
    if [[ $_first -eq 1 ]]; then
      _out="$_item"
      _first=0
    else
      _out+="$_sep$_item"
    fi
  done
  printf '%s' "$_out"
}

# Absolute, `..`-and-`//`-free form of a path that may not exist.
kg_safe_canonical() {
  local _p="$1"
  if [[ -z "$_p" ]]; then
    printf '%s' "$PWD"
    return 0
  fi
  if command -v readlink >/dev/null 2>&1 && readlink -m / >/dev/null 2>&1; then
    readlink -m -- "$_p"
    return 0
  fi
  case "$_p" in
    /*) ;;
    *) _p="$PWD/$_p" ;;
  esac
  while [[ "$_p" == *'//'* ]]; do _p="${_p//\/\///}"; done
  while [[ "$_p" == *'/./'* ]]; do _p="${_p//\/.\//\/}"; done
  while [[ "$_p" == */ && "$_p" != / ]]; do _p="${_p%/}"; done
  printf '%s' "$_p"
}

# Expand KG_SAFE_ZONE_GLOBS into concrete directories. One readdir sweep at
# bounded depth — measured 19ms — so it stays honest as entities are gestated.
KG_SAFE_ZONES_READY=0
kg_safe_expand_zones() {
  KG_SAFE_ZONES=()
  KG_SAFE_ZONES_READY=1
  local _g _d
  local -a _found=()
  for _g in "${KG_SAFE_ZONE_GLOBS[@]}"; do
    while IFS= read -r _d; do
      [[ -n "$_d" && -d "$_d" ]] || continue
      _found+=("$_d")
    done < <(compgen -G "$_g" 2>/dev/null || true)
  done
  if [[ ${#_found[@]} -gt 0 ]]; then
    while IFS= read -r _d; do
      KG_SAFE_ZONES+=("$_d")
    done < <(printf '%s\n' "${_found[@]}" | LC_ALL=C sort -u)
  fi
}

# Lazily expand once. Every consumer goes through here so a caller can never
# get a prune expression with an empty zone list.
kg_safe_zones_ready() {
  [[ ${KG_SAFE_ZONES_READY:-0} -eq 1 ]] || kg_safe_expand_zones
}

# Is this absolute path an excluded zone, or inside one?
# Prints the zone it matched and returns 0.
kg_safe_zone_for_path() {
  local _p="$1" _z
  kg_safe_zones_ready
  for _z in "${KG_SAFE_ZONES[@]}" "${KG_SAFE_SUBSTRATE[@]}"; do
    if [[ "$_p" == "$_z" || "$_p" == "$_z"/* ]]; then
      printf '%s' "$_z"
      return 0
    fi
  done
  return 1
}

# ── The prune expression, built for one walk root ────────────────────────────
# Fills KG_PRUNE_ARGS with:  '(' -type d '(' <predicates> ')' -prune ')'
# and sets KG_ROOT_EXCLUDED=1 (+ KG_ROOT_ZONE) when the root itself is inside
# an excluded zone — in which case NO pruning is emitted for that root: the
# caller asked for it by name, and silently answering nothing would be a lie.
#
# The root-relative rewrite matters: `find .` prints `./.sibyl/work`, so an
# absolute `-path /home/koad/.sibyl/work` never matches a relative root. The
# old wrapper had exactly that hole — the absolute entries in its list were
# inert for any relative walk. Both forms are emitted here.
KG_PRUNE_ARGS=()
KG_ROOT_EXCLUDED=0
KG_ROOT_ZONE=""

kg_safe_prune_args() {
  local _root="$1"
  local _root_abs _zone
  _root_abs="$(kg_safe_canonical "$_root")"
  kg_safe_zones_ready

  KG_PRUNE_ARGS=()
  KG_ROOT_EXCLUDED=0
  KG_ROOT_ZONE=""

  if _zone="$(kg_safe_zone_for_path "$_root_abs")"; then
    KG_ROOT_EXCLUDED=1
    KG_ROOT_ZONE="$_zone"
    return 0
  fi

  local -a _preds=()
  local _name _pat _rel

  for _name in "${KG_SAFE_DIR_NAMES[@]}"; do
    _preds+=( -name "$_name" )
  done
  for _pat in "${KG_SAFE_PATH_PATTERNS[@]}"; do
    _preds+=( -path "$_pat" )
  done

  # A root of "/" trims to the empty string, which joins the zone's leading
  # slash back into the right absolute path. A root of "." joins as "./x".
  local _root_trim="${_root%/}"

  for _zone in "${KG_SAFE_ZONES[@]}" "${KG_SAFE_SUBSTRATE[@]}"; do
    # absolute form: matches when find prints absolute paths
    _preds+=( -path "$_zone" )
    # root-relative form: matches when find prints "$root/..." (incl. "./...")
    if [[ "$_zone" == "$_root_abs"/* ]]; then
      _rel="${_zone#"$_root_abs"}"
      # skip the duplicate when the root is absolute and the two forms coincide
      [[ "${_root_trim}${_rel}" != "$_zone" ]] || continue
      _preds+=( -path "${_root_trim}${_rel}" )
    fi
  done

  # Emit:  ( -type d ( pred -o pred ... ) -prune )
  KG_PRUNE_ARGS=( '(' -type d '(' )
  local _i=0
  local _n=${#_preds[@]}
  while [[ $_i -lt $_n ]]; do
    [[ $_i -gt 0 ]] && KG_PRUNE_ARGS+=( -o )
    KG_PRUNE_ARGS+=( "${_preds[$_i]}" "${_preds[$((_i + 1))]}" )
    _i=$((_i + 2))
  done
  KG_PRUNE_ARGS+=( ')' -prune ')' )
}

# Print the notice for a root the caller named that is inside an excluded zone.
kg_safe_note_explicit_root() {
  local _tool="$1" _root="$2" _zone="$3"
  printf '[%s:safe] note: %s is an excluded zone (%s)\n' "$_tool" "$_root" "$_zone" >&2
  printf '[%s:safe] note: you named it as the search root, so it is being searched.\n' "$_tool" >&2
  printf '[%s:safe] note: broad walks skip it, deliberately — see %s --kingdom-help\n' "$_tool" "$_tool" >&2
}

kg_safe_excludes_summary() {
  kg_safe_zones_ready
  printf 'generated/cached dirs (%d names), .meteor/local, %d session+scratch zones, runtime substrate' \
    "${#KG_SAFE_DIR_NAMES[@]}" "${#KG_SAFE_ZONES[@]}"
}

kg_safe_print_banner() {
  local _tool="$1"
  [[ -t 2 ]] || return 0
  [[ "${KOAD_IO_QUIET:-}" == "1" ]] && return 0
  printf '[%s:safe] excluding %s\n' "$_tool" "$(kg_safe_excludes_summary)" >&2
  printf '[%s:safe] use --raw (or --full) to bypass safe defaults\n' "$_tool" >&2
}

kg_safe_show_excludes() {
  local _tool="$1"
  printf '%s safe excludes — policy, by class:\n' "$_tool"
  printf '\n  generated / cached / derived (basename, any depth):\n'
  local _name
  for _name in "${KG_SAFE_DIR_NAMES[@]}"; do
    printf '    - %s/\n' "$_name"
  done
  printf '\n  generated, package-relative:\n'
  printf '    - .meteor/local/\n'
  printf '\n  session & transcript archives, agent scratch (per entity home):\n'
  local _p
  for _p in "${KG_SAFE_ZONE_POLICY[@]}"; do
    printf '    - %s\n' "$_p"
  done
  kg_safe_zones_ready
  printf '    (expanded to %d directories on this host right now)\n' "${#KG_SAFE_ZONES[@]}"
  printf '\n  live runtime substrate:\n'
  local _s
  for _s in "${KG_SAFE_SUBSTRATE[@]}"; do
    printf '    - %s/\n' "$_s"
  done
  printf '\n  Not unreachable: name one of these as the search root and it is\n'
  printf '  searched (with a notice), or pass --raw to bypass the policy.\n'
  if [[ -n "${KOAD_IO_SAFE_MAX_FILES:-}" ]]; then
    printf '\n  walk budget: %s files (KOAD_IO_SAFE_MAX_FILES)\n' "$KOAD_IO_SAFE_MAX_FILES"
  fi
}
