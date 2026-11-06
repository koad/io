#!/bin/bash
# SPDX-License-Identifier: AGPL-3.0-or-later
set -e

if [ -z "$1" ]; then
  echo "Usage: koad spawn <skeleton> [--into <path>] [--force] [args...]"
  echo "       koad spawn list"
  exit 64
fi

SKELETON_NAME="$1"
shift

# §2.5's canonical override -- visible in shell history where an env var is not.
# Stripped from the argument list here so a skeleton's control scripts never see
# it; the scripted equivalent is SPAWN_ALLOW_HOSTILE=1 (see the guard comment).
#
# §2.6's --into is parsed here too, for the same reason: it names the deploy
# target and must not be forwarded to a skeleton's control scripts as an
# argument they might interpret themselves.
_SPAWN_FORCE=0
_SPAWN_INTO=""
_SPAWN_ARGV=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --force) _SPAWN_FORCE=1 ;;
    --into)
      if [ "$#" -lt 2 ] || [ -z "$2" ]; then
        echo "[spawn] REFUSED — --into needs a path (§2.6, VESTA-SPEC-243)" >&2
        echo "[spawn]   usage: spawn <skeleton> --into <path>" >&2
        exit 64
      fi
      _SPAWN_INTO="$2"
      shift
      ;;
    --into=*)
      _SPAWN_INTO="${1#--into=}"
      if [ -z "$_SPAWN_INTO" ]; then
        echo "[spawn] REFUSED — --into needs a path (§2.6, VESTA-SPEC-243)" >&2
        echo "[spawn]   usage: spawn <skeleton> --into=<path>" >&2
        exit 64
      fi
      ;;
    *) _SPAWN_ARGV+=("$1") ;;
  esac
  shift
done
set -- ${_SPAWN_ARGV[@]+"${_SPAWN_ARGV[@]}"}
unset _arg _SPAWN_ARGV

export CURRENTDATETIME=$(date +"%Y-%m-%d-%H-%M")
export SKELETON="${SKELETON:-$SKELETON_NAME}"

# §2.6 — an inherited DATADIR NEVER decides the write root. `DATADIR` is a shared
# koad:io variable: any shell, any .env in the cascade, any sourcing parent can
# set it, and honouring it here means the deploy target can be chosen by a
# variable nobody at the keyboard set. It is dropped on entry and re-established
# from the verified target below — which is the only meaning control scripts may
# give it.
unset DATADIR

# --- Search root (§2.1) -------------------------------------------------------
# ONE variable, ONE job. The search root is where project-local skeletons are
# looked for, and CWD is the right answer for that: a project that carries its own
# skeletons must have them found from where the operator stands. It is NOT the
# write root — that is resolved separately below, from --into or $PWD, and is what
# the guard inspects. Conflating the two is the defect SPEC-243 §2.1 names.
_SPAWN_SEARCH_ROOT="${CWD:-$PWD}"

# Mirrors the command-resolution cascade: CWD > entity > framework.
# ENTITY is set by the entity launcher (e.g. `ecoincore` → ~/.ecoincore), so a
# domain resolves its own skeletons without hardcoding the domain name.
_entity_dir="${ENTITY_DIR:-}"
if [ -z "$_entity_dir" ] && [ -n "${ENTITY:-}" ]; then
  _entity_dir="$HOME/.$(printf '%s' "$ENTITY" | tr '[:upper:]' '[:lower:]')"
fi

SKELETON_DIRS="${KOAD_IO_SKELETONS_DIRS:-$_SPAWN_SEARCH_ROOT/skeletons${_entity_dir:+:$_entity_dir/skeletons}:$HOME/.forge/skeletons:$HOME/.koad-io/skeletons}"

IFS=':' read -r -a SKELETON_ROOTS <<< "$SKELETON_DIRS"

_find_skeleton() {
  local name="$1" dir
  for dir in "${SKELETON_ROOTS[@]}"; do
    [ -n "$dir" ] || continue
    [ -d "$dir/$name" ] && { printf '%s\n' "$dir/$name"; return 0; }
  done
  return 1
}

_available_skeletons() {
  local dir entry
  for dir in "${SKELETON_ROOTS[@]}"; do
    [ -n "$dir" ] && [ -d "$dir" ] || continue
    for entry in "$dir"/*/; do
      [ -d "$entry" ] || continue
      printf '  %-16s %s\n' "$(basename "$entry")" "$dir"
    done
  done
}

# _deploy_payload SRC DST PROTECT_ENV
# `rsync -a`, no --delete: MERGES, overwriting colliding names.
# PROTECT_ENV=1 omits the payload's root `.env` so §2.8 M1 can write it as
# `.env.skeleton` instead — a blind copy may never replace a target's identity
# file. Mirrors the cp fallback exactly; the two must stay in step.
_deploy_payload() {
  local src="$1" dst="$2" protect_env="${3:-0}" item base
  local -a _rsync_ex=(
    --exclude='.git/'
    --exclude='node_modules/'
    --exclude='control/'
    --exclude='flavours/'
    --exclude='*.log'
  )
  if [ "$protect_env" = "1" ]; then
    _rsync_ex+=(--exclude='/.env')
  fi
  if command -v rsync >/dev/null 2>&1; then
    rsync -a "${_rsync_ex[@]}" "$src/" "$dst/"
  else
    for item in "$src"/* "$src"/.[!.]*; do
      [ -e "$item" ] || continue
      base="$(basename "$item")"
      case "$base" in
        .git|node_modules|control|flavours) continue ;;
        *.log) continue ;;
        .env) if [ "$protect_env" = "1" ]; then continue; fi ;;
      esac
      cp -r "$item" "$dst/"
    done
  fi
}

# _spawn_payload_paths SRC — every path the payload will carry into the target,
# honouring the same excludes as _deploy_payload. Used only to compute the §2.8
# announcement; never writes.
_spawn_payload_paths() {
  _spawn_find "$1" -mindepth 1 \
    \( -name '.git' -o -name 'node_modules' -o -name 'control' \
       -o -name 'flavours' -o -name '*.log' \) -prune \
    -o -print 2>/dev/null
}

if [ "$SKELETON_NAME" = "list" ]; then
  echo "Skeleton roots (first match wins):"
  for _r in "${SKELETON_ROOTS[@]}"; do
    [ -n "$_r" ] && [ -d "$_r" ] && echo "  $_r"
  done
  echo
  echo "Available skeletons:"
  _available_skeletons
  exit 0
fi

# --- Project guard ------------------------------------------------------------
# `spawn` DEPLOYS into a directory: _deploy_payload is `rsync -a` with no
# --delete, so it MERGES, silently overwriting colliding names. Run from the
# framework root it merged a bare skeleton's src/ into ~/.koad-io (reproduced on
# valhalla, 2026-11-05). Nothing asked whether the target was a project. This asks.
#
# Implements VESTA-SPEC-243 v1.1 §2.2 (the declaration test) and §2.3 + §2.3.1
# (the protected roots) for the identity-home half of the rule set. v1.0 of the
# spec refused "an entity home, or anything inside it", which refused every
# subdirectory of every identity home -- including ~/.mikki/interface, a target
# the operator had recommended to that user by name. F3 protects two things now,
# and only two:
#
#   * the identity-home ROOT          -- name collision (ENTITY.md, passenger.json,
#                                        .env, PRIMER.md, and the harness state
#                                        SPEC-072 keeps at the root itself);
#   * a named set of DEPTH-1 subtrees -- the 19 names in _SPAWN_RESERVED_NAMES,
#                                        matched case-insensitively (LOGS/ and
#                                        logs/ are the same claim).
#
# Everything else inside an identity home is the entity's own namespace and a
# legal project home: interface/, websites/<domain>/, apps/<name>/. That is the
# point of the amendment, not a loophole in it.
#
# The reserved list is canon (SPEC-243 §2.3.1C). Adding or removing a member
# requires an amendment to that section -- it is not an implementer's judgement,
# and it exists once, here, as one array. §2.4 moves it into ~/.koad-io/helpers/
# when a second deploy verb needs it; that extraction is a separate pass.
#
# Overrides. Exactly two spellings, both meaning "I know this directory is not a
# declared project": --force (§2.5 canonical) and SPAWN_ALLOW_HOSTILE=1 (the
# scripted equivalent). Both override the §2.2 declaration/non-empty refusal and
# NOTHING else (§2.5): a protected root has no legitimate case, so no flag reaches
# it. Neither silences the §2.8 announcement.
#
# NOTE THE MISSING PREFIX ON SPAWN_ALLOW_HOSTILE. It is deliberate. bin/koad-io's
# pre-cascade env sanitization wipes everything matching ^(KOAD_IO_|ENTITY)
# (lines 54-56 direct, 76-83 launcher path, exceptions: ENTITY,
# KOAD_IO_MODEL_CEILING, plus the KOAD_IO_ROOM/KOAD_IO_QUIET pin-and-restore).
# A KOAD_IO_-prefixed override is therefore dropped before this command ever runs
# and can never be honoured. Do not "fix" this name to match the others; it
# works BECAUSE it does not match.
#
# Refusals exit 64 (EX_USAGE, SPEC-239 §8.2) and every one names its rule
# (SPEC-231 C-2): the F-rule for a protected root, §2.2 for a target that is
# neither empty nor declared.

# _spawn_find ARGS... — the real find, never the kingdom-safe wrapper.
# Inside an entity session PATH resolves `find` to ~/.koad-io/bin/find, which
# PRUNES .git/ and other paths by design. That is correct for a search tool and
# wrong for a predicate whose whole point is "dotfiles count as content": the
# wrapper reported a .git-only directory as empty and the §2.2 test accepted it
# (caught in acceptance, 2026-11-06). The guard must not depend on ambient PATH
# for a correctness-critical answer, so absolute paths are tried first.
_spawn_find() {
  local c
  for c in /usr/bin/find /bin/find /usr/local/bin/find; do
    if [ -x "$c" ]; then
      "$c" "$@"
      return $?
    fi
  done
  find "$@"
}

# _spawn_real PATH — physical path, works for paths that do not exist yet.
_spawn_real() {
  if command -v realpath >/dev/null 2>&1; then
    realpath -m -- "$1" 2>/dev/null && return 0
  fi
  local p="$1" tail="" base
  while [ ! -d "$p" ] && [ "$p" != "/" ]; do
    tail="/$(basename "$p")$tail"
    p="$(dirname "$p")"
  done
  base="$( cd "$p" 2>/dev/null && pwd -P )" || return 1
  [ "$base" = "/" ] && base=""
  printf '%s%s\n' "$base" "$tail"
}

_spawn_is_or_inside() {
  [ "$1" = "$2" ] && return 0
  case "$1" in "$2"/*) return 0 ;; esac
  return 1
}

# §2.3.1C, verbatim and in the spec's order: 19 names, each with the harm class
# that earned it. Names and classes are parallel arrays on purpose -- one list,
# one place, and the refusal can quote the reason the name is on it.
_SPAWN_RESERVED_NAMES=(
  id keyring .local var trust commands hooks skills curricula briefs tickler
  control memories sessions session-env projects logs destinations .git
)
_SPAWN_RESERVED_CLASS=(
  "R-1 — identity and key material"
  "R-1 — the GPG home"
  "R-1 — a second GPG home and harness state"
  "R-1 — sigchain tip and invocation log"
  "R-2 — trust bonds are the entity's authority"
  "R-2 — command tier 2, granted by name"
  "R-2 — lifecycle hooks"
  "R-2 — skills are loaded as instructions"
  "R-2 — the entity's curriculum"
  "R-2 — intake: a brief is work owed"
  "R-2 — tickles are obligations"
  "R-2 — control-layer state read at session start"
  "R-1 — accumulated memory"
  "R-3 — harness pid and heartbeat"
  "R-3 — per-session environment snapshots"
  "R-1 — session transcripts"
  "R-1 — the only account of what happened"
  "R-3 — destination memory read at session start"
  "R-1 — the repository itself"
)

# _spawn_identity_home RESOLVED_TARGET — prints the identity home the target sits
# in, or nothing. Two identification nets, in this order:
#   1. path identity for the sovereign home ($KOAD_IO_HOME/me), which is an
#      identity home by canon even before it carries a marker;
#   2. the marker net (ENTITY.md / passenger.json) for every other identity home,
#      nearest ancestor first -- SPEC-053 permits an entity home to be relocated,
#      so a path list would go stale where a marker does not.
# Note this is NOT declaration walking (§2.2 forbids that): it locates the home
# whose reserved subtrees must be protected, it never grants a target permission.
_spawn_identity_home() {
  local p="$1"
  if _spawn_is_or_inside "$p" "$_SPAWN_SOVEREIGN_HOME"; then
    printf '%s\n' "$_SPAWN_SOVEREIGN_HOME"
    return 0
  fi
  while :; do
    if [ -f "$p/ENTITY.md" ] || [ -f "$p/passenger.json" ]; then
      printf '%s\n' "$p"
      return 0
    fi
    [ "$p" = "/" ] && break
    p="$(dirname "$p")"
  done
  return 1
}

# _spawn_entry_counts DIR — "N (D directories, F files)", depth 1, for the §2.5
# forced-merge warning and the §2.7 refusal. DOTFILES COUNT: `.git/` is one entry,
# not zero. Never walks the tree it is about to describe.
# Shell globbing, not find: see _spawn_find for why find is not trustworthy here.
_spawn_entry_counts() {
  local d=0 f=0 p
  local -a entries=()
  shopt -s nullglob dotglob
  entries=("$1"/*)
  shopt -u nullglob dotglob
  for p in ${entries[@]+"${entries[@]}"}; do
    case "${p##*/}" in .|..) continue ;; esac
    if [ -d "$p" ]; then d=$((d + 1)); else f=$((f + 1)); fi
  done
  printf '%s (%s directories, %s files)\n' "$((d + f))" "$d" "$f"
}

# _spawn_is_empty DIR
#   0 — empty or does not exist yet (an unopposed claim, §2.2(a))
#   1 — non-empty; dotfiles are entries, so `.git/` alone is non-empty (§2.2)
#   2 — could not be enumerated; evidence missing, so the permissive branch is
#       not available (§2.3, "an unresolvable target is refused")
_spawn_is_empty() {
  local dir="$1" p n=0
  local -a entries=()
  [ -d "$dir" ] || return 0
  if [ ! -r "$dir" ] || [ ! -x "$dir" ]; then
    return 2
  fi
  shopt -s nullglob dotglob
  entries=("$dir"/*)
  shopt -u nullglob dotglob
  # bash < 5 lets dotglob match '.' and '..'; they are never entries.
  # (No fork per entry: the case is a builtin test.)
  for p in ${entries[@]+"${entries[@]}"}; do
    case "${p##*/}" in .|..) continue ;; esac
    n=$((n + 1))
    break
  done
  if [ "$n" -eq 0 ]; then return 0; fi
  return 1
}

# _spawn_first_entry DIR — the first entry of DIR, dotfiles included, or nothing.
_spawn_first_entry() {
  local p
  local -a entries=()
  shopt -s nullglob dotglob
  entries=("$1"/*)
  shopt -u nullglob dotglob
  for p in ${entries[@]+"${entries[@]}"}; do
    case "${p##*/}" in .|..) continue ;; esac
    printf '%s\n' "$p"
    return 0
  done
  return 0
}

# _spawn_declaration DIR — prints the declaration line from ././.env if the
# directory declares itself a koad:io project, else nothing (§2.2).
#   * the CONTENT is the declaration, not the file's existence. Every entity home
#     and the framework root carry a .env; "has a .env" is a cascade fact, not a
#     claim of projecthood (§2.2 note, §2.10).
#   * name matching only. The file is never sourced, executed, or interpreted --
#     the guard runs before pre-install precisely so nothing in the target can be
#     talked into running (§2.3.1D).
#   * this directory only. No walking upward, ever (§2.2).
_spawn_declaration() {
  local dir="$1" line
  [ -f "$dir/.env" ] || return 0
  line="$(grep -m1 -E '^[[:space:]]*(export[[:space:]]+)?KOAD_IO_(TYPE|APP_NAME)[[:space:]]*=' \
            "$dir/.env" 2>/dev/null || true)"
  [ -n "$line" ] || return 0
  line="$(printf '%s' "$line" | sed -e 's/^[[:space:]]*//' -e 's/^export[[:space:]][[:space:]]*//')"
  printf '%s\n' "$line"
}

# --- Resolve the write target (§2.6) -----------------------------------------
# From --into or $PWD. Never from DATADIR, never from CWD.
_SPAWN_TARGET_INPUT="${_SPAWN_INTO:-${PWD:-$(pwd)}}"
_SPAWN_TARGET="$(_spawn_real "$_SPAWN_TARGET_INPUT" || true)"

if [ -z "$_SPAWN_TARGET" ]; then
  echo "[spawn] REFUSED — the target could not be resolved" >&2
  echo "[spawn]   requested: $_SPAWN_TARGET_INPUT" >&2
  echo "[spawn]   realpath failed (broken symlink, dangling parent, or permission" >&2
  echo "[spawn]   denied on an ancestor). Missing evidence never produces the" >&2
  echo "[spawn]   permissive branch. (§2.3, VESTA-SPEC-243)" >&2
  exit 64
fi

if [ -e "$_SPAWN_TARGET" ] && [ ! -d "$_SPAWN_TARGET" ]; then
  echo "[spawn] REFUSED — the target is not a directory" >&2
  echo "[spawn]   target:  $_SPAWN_TARGET" >&2
  echo "[spawn]   A skeleton payload is merged into a directory. (§2.2, VESTA-SPEC-243)" >&2
  exit 64
fi

_SPAWN_HOME="$(_spawn_real "$HOME")"
_SPAWN_FRAMEWORK="$(_spawn_real "${KOAD_IO_HOME:-$HOME/.koad-io}")"
_SPAWN_SOVEREIGN_HOME="$(_spawn_real "${KOAD_IO_HOME:-$HOME/.koad-io}/me")"
_SPAWN_RULE=""
_SPAWN_MATCH=""
_SPAWN_WHY=""

# Most specific rule first, so the message names the closest true reason. The
# ORDER IS FIXED (§2.3): a protected root is refused for being protected, never
# accepted for being empty. The §2.2 declaration test runs after this, never
# before it -- so an empty reserved subtree is still refused.
if [ "$_SPAWN_TARGET" = "$_SPAWN_HOME" ]; then
  _SPAWN_RULE="home"
  _SPAWN_MATCH="F7 — \$HOME itself, and ancestors of a protected root"
  _SPAWN_WHY="that is your home directory, not a project."
else
  case "/$_SPAWN_TARGET/" in
    */skeletons/*|*/skeleton/*)
      _SPAWN_RULE="skeleton"
      _SPAWN_MATCH="F6 — a skeleton tree (a template is not a target)"
      _SPAWN_WHY="that is a skeleton source tree, not a project."
      ;;
  esac
fi

# F1, with F2 carved out of it: ~/.koad-io/me is inside the framework by path
# but is an identity home, so F1 must not swallow it (§2.3 F1/F2). It falls
# through to the F3 rule below and is judged as an identity home, like any other.
if [ -z "$_SPAWN_RULE" ]; then
  if _spawn_is_or_inside "$_SPAWN_TARGET" "$_SPAWN_FRAMEWORK" \
     && ! _spawn_is_or_inside "$_SPAWN_TARGET" "$_SPAWN_SOVEREIGN_HOME"; then
    _SPAWN_RULE="framework"
    _SPAWN_MATCH="F1 — framework install root (\$KOAD_IO_HOME)"
    if [ "$_SPAWN_TARGET" = "$_SPAWN_FRAMEWORK" ]; then
      _SPAWN_WHY="that is the framework root, not a project."
    else
      _SPAWN_WHY="that is inside the framework ($_SPAWN_FRAMEWORK)."
    fi
  elif _spawn_is_or_inside "$_SPAWN_TARGET" "$_SPAWN_HOME/.forge"; then
    _SPAWN_RULE="forge"
    _SPAWN_MATCH="F4 — the operator overlay (~/.forge)"
    if [ "$_SPAWN_TARGET" = "$_SPAWN_HOME/.forge" ]; then
      _SPAWN_WHY="that is the forge root, not a project."
    else
      _SPAWN_WHY="that is inside ~/.forge, which holds existing kingdom work."
    fi
  fi
fi

# F3 v1.1 — two rules, not one. The identity-home ROOT is refused for name
# collision. A DEPTH-1 subtree whose name is on the reserved list is refused for
# the harm it carries. Everything else inside the home is the entity's own
# namespace and a legal project home (§2.3.1, §2.3.1E).
if [ -z "$_SPAWN_RULE" ]; then
  _SPAWN_IDHOME="$(_spawn_identity_home "$_SPAWN_TARGET" || true)"
  if [ -n "$_SPAWN_IDHOME" ]; then
    if [ "$_SPAWN_TARGET" = "$_SPAWN_IDHOME" ]; then
      _SPAWN_RULE="identity-root"
      _SPAWN_MATCH="F3 — identity home root (name collision)"
      _SPAWN_WHY="that is an identity home root; a merge here collides by name with ENTITY.md, passenger.json, .env, PRIMER.md and the harness state kept at the root."
    else
      _SPAWN_REL="${_SPAWN_TARGET#"$_SPAWN_IDHOME"/}"
      _SPAWN_FIRST="${_SPAWN_REL%%/*}"
      _SPAWN_FIRST_LC="${_SPAWN_FIRST,,}"
      _spawn_i=0
      while [ "$_spawn_i" -lt "${#_SPAWN_RESERVED_NAMES[@]}" ]; do
        if [ "$_SPAWN_FIRST_LC" = "${_SPAWN_RESERVED_NAMES[$_spawn_i]}" ]; then
          _SPAWN_RULE="identity-reserved"
          _SPAWN_MATCH="F3 reserve ${_SPAWN_RESERVED_CLASS[$_spawn_i]} — ${_SPAWN_RESERVED_NAMES[$_spawn_i]}/"
          _SPAWN_WHY="that is ${_SPAWN_RESERVED_NAMES[$_spawn_i]}/ inside the identity home $_SPAWN_IDHOME."
          break
        fi
        _spawn_i=$((_spawn_i + 1))
      done
    fi
  fi
fi

# §2.2 — the declaration test, and it is the LAST word on an unprotected target.
#
#   ACCEPT iff the target is empty, or its ./.env declares it a koad:io project
#   with KOAD_IO_TYPE or KOAD_IO_APP_NAME. REFUSE otherwise.
#
# Three constraints carry the whole rule:
#   * an existing .env alone is NOT a declaration — the framework root has one,
#     and that is the bug this spec started from;
#   * no walking upward, ever — standing in src/ of a project is not a claim
#     about src/;
#   * dotfiles count as content — a directory holding only .git/ is not empty.
_SPAWN_DECLARED=""
if [ -z "$_SPAWN_RULE" ]; then
  _SPAWN_DECLARED="$(_spawn_declaration "$_SPAWN_TARGET")"
  if [ -z "$_SPAWN_DECLARED" ]; then
    _spawn_empty_state=0
    _spawn_is_empty "$_SPAWN_TARGET" || _spawn_empty_state=$?
    case "$_spawn_empty_state" in
      0) : ;;
      1)
        _SPAWN_RULE="undeclared"
        _spawn_first_entry="$(_spawn_first_entry "$_SPAWN_TARGET")"
        if [ -f "$_SPAWN_TARGET/.env" ]; then
          _SPAWN_WHY="it carries a .env but no KOAD_IO_TYPE or KOAD_IO_APP_NAME — an existing .env alone is not a declaration."
        else
          _SPAWN_WHY="it is not empty (found: $(basename "$_spawn_first_entry"))."
        fi
        ;;
      *)
        _SPAWN_RULE="undeclared-unresolvable"
        _SPAWN_WHY="its contents could not be enumerated, so it cannot be shown to be empty."
        ;;
    esac
  fi
fi

# Exactly two override spellings (§2.5). They override the §2.2 refusal and
# nothing else: a protected root has no legitimate case.
_SPAWN_OVERRIDE=""
if [ "${SPAWN_ALLOW_HOSTILE:-}" = "1" ]; then
  _SPAWN_OVERRIDE="SPAWN_ALLOW_HOSTILE=1"
fi
if [ "$_SPAWN_FORCE" = "1" ]; then
  _SPAWN_OVERRIDE="--force"
fi

if [ -n "$_SPAWN_RULE" ]; then
  case "$_SPAWN_RULE" in
    undeclared|undeclared-unresolvable) _SPAWN_OVERRIDABLE=1 ;;
    *)                                  _SPAWN_OVERRIDABLE=0 ;;
  esac

  if [ -n "$_SPAWN_OVERRIDE" ] && [ "$_SPAWN_OVERRIDABLE" = "1" ]; then
    # §2.5 — loud, and it names the risk instead of blessing it.
    echo "[spawn] WARNING — forcing deployment into a non-empty, undeclared directory"
    echo "[spawn]   target:      $_SPAWN_TARGET"
    echo "[spawn]   entries:     $(_spawn_entry_counts "$_SPAWN_TARGET")"
    echo "[spawn]   override:    $_SPAWN_OVERRIDE"
    echo "[spawn]   This directory does not declare itself a koad:io project"
    echo "[spawn]   (no KOAD_IO_TYPE or KOAD_IO_APP_NAME in ./.env)."
    echo "[spawn]   Proceeding under §2.5 of VESTA-SPEC-243. Colliding paths WILL be overwritten."
  else
    if [ -n "$_SPAWN_OVERRIDE" ]; then
      echo "[spawn] note: $_SPAWN_OVERRIDE does not apply to a protected root — §2.3 has no override." >&2
    fi
    if [ "$_SPAWN_RULE" = "undeclared" ] || [ "$_SPAWN_RULE" = "undeclared-unresolvable" ]; then
      # §2.2's refusal (§2.7 text). This heredoc is UNQUOTED so $_SPAWN_* expand.
      # Anything between backticks or inside a dollar-paren is COMMAND
      # SUBSTITUTION here and runs -- that is how a refusal message once
      # recursively invoked `koad-io spawn` (2026-11-05). Keep this body free of
      # both; compute every value into a variable first.
      _SPAWN_COUNTS="$(_spawn_entry_counts "$_SPAWN_TARGET")"
      cat >&2 <<REFUSAL
[spawn] REFUSED — target is neither empty nor a declared project root
[spawn]   target:      $_SPAWN_TARGET
[spawn]   entries:     $_SPAWN_COUNTS
[spawn]   matched:     §2.2 declaration test
[spawn]   $_SPAWN_WHY
[spawn]   A project root is a directory that is empty, or that declares itself in
[spawn]   ./.env with KOAD_IO_TYPE or KOAD_IO_APP_NAME. Standing in a directory is
[spawn]   not a declaration, and a parent directory's declaration is not this
[spawn]   directory's. Dotfiles count as content. (§2.2, VESTA-SPEC-243)
[spawn]
[spawn] Deploy into a new directory:  ${ENTITY:-<entity>} spawn $SKELETON_NAME --into <new-dir>
[spawn] Deploy here anyway:           ${ENTITY:-<entity>} spawn $SKELETON_NAME --force
REFUSAL
    else
      # §2.3 / §2.3.1 — a protected root. No override reaches this branch.
      # Same heredoc discipline as above: no backticks, no dollar-paren.
      cat >&2 <<REFUSAL
[spawn] REFUSED — target is structurally protected
[spawn]   target:   $_SPAWN_TARGET
[spawn]   matched:  $_SPAWN_MATCH
[spawn]   $_SPAWN_WHY
[spawn]   A skeleton payload is never merged into a protected root. This refusal
[spawn]   has no override: no --force, no SPAWN_ALLOW_HOSTILE. (§2.3, VESTA-SPEC-243)
[spawn]
[spawn] Deploy into a new directory:  ${ENTITY:-<entity>} spawn $SKELETON_NAME --into <new-dir>
[spawn]
[spawn] Inside an identity home, any directory you create for a project is a legal
[spawn] target (interface/, websites/<domain>/, apps/<name>/). The identity home root
[spawn] and the 19 reserved subtrees in §2.3.1 are not. (§2.3.1, VESTA-SPEC-243)
[spawn]
[spawn] ('koad-io spawn' with no entity dead-ends: a skeleton's control/install
[spawn]  runs as an entity and refuses without one.)
REFUSAL
    fi
    exit 64
  fi
fi

unset _spawn_probe _spawn_first_entry _spawn_empty_state _spawn_i _SPAWN_OVERRIDABLE

# The target is verified from here on. The skeleton is resolved before anything
# is created, so a typo'd skeleton name cannot leave a stray directory behind.
if ! SKELETON_PATH="$(_find_skeleton "$SKELETON_NAME")"; then
  echo "Skeleton '$SKELETON_NAME' not found." >&2
  echo >&2
  echo "Searched (search root: $_SPAWN_SEARCH_ROOT):" >&2
  for _r in "${SKELETON_ROOTS[@]}"; do
    [ -n "$_r" ] && echo "  $_r/$SKELETON_NAME" >&2
  done
  echo >&2
  echo "Available skeletons:" >&2
  _available_skeletons >&2
  exit 64
fi

# Create the target if it was named and does not exist (§2.6 — a directory that
# did not exist a moment ago was empty by definition, so this is not a bypass),
# then work off the physical path so a symlinked project cannot deploy somewhere
# the guard did not inspect.
_SPAWN_CREATED=0
if [ ! -d "$_SPAWN_TARGET" ]; then
  mkdir -p "$_SPAWN_TARGET"
  _SPAWN_CREATED=1
fi
DATADIR="$(cd "$_SPAWN_TARGET" && pwd -P)"
export DATADIR

if [ "$_SPAWN_CREATED" = "1" ]; then
  echo "[spawn] created target directory: $DATADIR (§2.6 — it did not exist)"
fi
unset _SPAWN_CREATED

echo "Skeleton '$SKELETON_NAME' found at $SKELETON_PATH"

# Two layouts are supported:
#   wrapped  — <skeleton>/skeleton/ holds the payload (koad-io convention)
#   flat     — the skeleton directory IS the payload (project templates)
if [ -d "$SKELETON_PATH/skeleton" ]; then
  SKELETON_PAYLOAD="$SKELETON_PATH/skeleton"
  SKELETON_LAYOUT="wrapped"
else
  SKELETON_PAYLOAD="$SKELETON_PATH"
  SKELETON_LAYOUT="flat"
fi

# --- §2.8 — every merge is announced -----------------------------------------
# Refusing new damage is half the job; the other half is not repeating the damage
# already legal. The count is never capped, the LIST is capped at ten, and the
# announcement prints even when nothing collides -- "we looked and nothing is at
# risk" is information, and a report that only appears on danger trains operators
# to read its absence as safety (M2).
#
# M1 — a target's .env is machine identity (SPEC-005) and is never overwritten by
# a payload: the payload's copy is written as .env.skeleton and reported. When the
# target has no .env there is nothing to protect and the payload's copy lands
# normally, still announced. This is the file-level rule; §2.3.1's reserved set is
# the directory-level version of the same rule.
_SPAWN_PROTECT_ENV=0
if [ -f "$SKELETON_PAYLOAD/.env" ] && [ -f "$DATADIR/.env" ]; then
  _SPAWN_PROTECT_ENV=1
fi

_SPAWN_PAYLOAD_DIRS=0
_SPAWN_PAYLOAD_FILES=0
_SPAWN_COLLISIONS=()
while IFS= read -r _spawn_p; do
  [ -n "$_spawn_p" ] || continue
  _spawn_rel="${_spawn_p#"$SKELETON_PAYLOAD"/}"
  [ -n "$_spawn_rel" ] || continue
  if [ -d "$_spawn_p" ]; then
    _SPAWN_PAYLOAD_DIRS=$((_SPAWN_PAYLOAD_DIRS + 1))
  else
    _SPAWN_PAYLOAD_FILES=$((_SPAWN_PAYLOAD_FILES + 1))
  fi
  if [ "$_SPAWN_PROTECT_ENV" = "1" ] && [ "$_spawn_rel" = ".env" ]; then
    continue
  fi
  if [ -e "$DATADIR/$_spawn_rel" ] || [ -L "$DATADIR/$_spawn_rel" ]; then
    _SPAWN_COLLISIONS+=("$_spawn_rel")
  fi
done < <(_spawn_payload_paths "$SKELETON_PAYLOAD")
unset _spawn_p _spawn_rel

_SPAWN_TARGET_EMPTY=0
_spawn_is_empty "$DATADIR" || _SPAWN_TARGET_EMPTY=$?
if [ -n "$_SPAWN_DECLARED" ]; then
  echo "[spawn] target:  $DATADIR (declared: $_SPAWN_DECLARED)"
elif [ "$_SPAWN_TARGET_EMPTY" = "0" ]; then
  echo "[spawn] target:  $DATADIR (empty)"
else
  echo "[spawn] target:  $DATADIR (undeclared, forced)"
fi
unset _SPAWN_TARGET_EMPTY
echo "[spawn] payload: $_SPAWN_PAYLOAD_DIRS directories, $_SPAWN_PAYLOAD_FILES files"
if [ "${#_SPAWN_COLLISIONS[@]}" -eq 0 ]; then
  echo "[spawn] will overwrite 0 existing paths."
else
  echo "[spawn] will overwrite ${#_SPAWN_COLLISIONS[@]} existing paths:"
  _spawn_shown=0
  for _spawn_rel in "${_SPAWN_COLLISIONS[@]}"; do
    if [ "$_spawn_shown" -ge 10 ]; then break; fi
    echo "[spawn]   $_spawn_rel"
    _spawn_shown=$((_spawn_shown + 1))
  done
  if [ "${#_SPAWN_COLLISIONS[@]}" -gt 10 ]; then
    echo "[spawn]   … and $(( ${#_SPAWN_COLLISIONS[@]} - 10 )) more"
  fi
fi
if [ "$_SPAWN_PROTECT_ENV" = "1" ]; then
  echo "[spawn] .env:    target has one — the payload's copy will be written as .env.skeleton (§2.8 M1)"
fi
unset _spawn_shown _spawn_rel

if [ -f "$SKELETON_PATH/control/pre-install" ]; then
  echo "Running control/pre-install for skeleton '$SKELETON_NAME'..."
  echo "exec: $SKELETON_PATH/control/pre-install"
  bash "$SKELETON_PATH/control/pre-install" "$@"
else
  echo "No controls/pre-install script found."
fi

if [ -f "$SKELETON_PATH/control/install" ]; then
  echo "Running control/install..."
  echo "exec: $SKELETON_PATH/control/install"
  bash "$SKELETON_PATH/control/install" "$@"
else
  echo "No controls/install script found."
fi

echo "Deploying skeleton '$SKELETON_NAME' ($SKELETON_LAYOUT layout) into $DATADIR..."
_deploy_payload "$SKELETON_PAYLOAD" "$DATADIR" "$_SPAWN_PROTECT_ENV"

# §2.8 M1 — the payload's .env was held back from the merge; preserve it beside
# the target's own so the skeleton's declared values are visible without ever
# replacing machine identity.
if [ "$_SPAWN_PROTECT_ENV" = "1" ] && [ -f "$SKELETON_PAYLOAD/.env" ]; then
  cp "$SKELETON_PAYLOAD/.env" "$DATADIR/.env.skeleton"
  echo "[spawn] .env preserved: payload copy written as .env.skeleton (the target's .env was not touched)"
fi

# A copied Meteor app id makes two apps share one identity. Drop it so Meteor
# mints a fresh one on first run.
while IFS= read -r _meteor_id; do
  [ -n "$_meteor_id" ] || continue
  rm -f "$_meteor_id"
  echo "Cleared inherited Meteor app id: ${_meteor_id#"$DATADIR"/}"
done < <(_spawn_find "$DATADIR" -maxdepth 4 -path '*/.meteor/.id' 2>/dev/null || true)

if [ -f "$SKELETON_PATH/control/post-install" ]; then
  echo "Running control/post-install for skeleton '$SKELETON_NAME'..."
  echo "exec: $SKELETON_PATH/control/post-install"
  bash "$SKELETON_PATH/control/post-install" "$@"
else
  echo "No controls/post-install script found."
fi

echo "Skeleton deployed successfully."

source "$HOME/.koad-io/helpers/discovery.sh" 2>/dev/null && _koad_io_hint
