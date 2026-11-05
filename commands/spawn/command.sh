#!/bin/bash
# SPDX-License-Identifier: AGPL-3.0-or-later
set -e

if [ -z "$1" ]; then
  echo "Usage: koad spawn <skeleton> [args...]"
  echo "       koad spawn list"
  exit 1
fi

SKELETON_NAME="$1"
shift

# §2.5's canonical override -- visible in shell history where an env var is not.
# Stripped from the argument list here so a skeleton's control scripts never see
# it; the scripted equivalent is SPAWN_ALLOW_HOSTILE=1 (see the guard comment).
_SPAWN_FORCE=0
_SPAWN_ARGV=()
for _arg in "$@"; do
  case "$_arg" in
    --force) _SPAWN_FORCE=1 ;;
    *) _SPAWN_ARGV+=("$_arg") ;;
  esac
done
set -- ${_SPAWN_ARGV[@]+"${_SPAWN_ARGV[@]}"}
unset _arg _SPAWN_ARGV

export CURRENTDATETIME=$(date +"%Y-%m-%d-%H-%M")
export DATADIR="${DATADIR:-${CWD:-$PWD}}"
export SKELETON="${SKELETON:-$SKELETON_NAME}"

# --- Skeleton roots -----------------------------------------------------------
# Mirrors the command-resolution cascade: CWD > entity > framework.
# ENTITY is set by the entity launcher (e.g. `ecoincore` → ~/.ecoincore), so a
# domain resolves its own skeletons without hardcoding the domain name.
_entity_dir="${ENTITY_DIR:-}"
if [ -z "$_entity_dir" ] && [ -n "${ENTITY:-}" ]; then
  _entity_dir="$HOME/.$(printf '%s' "$ENTITY" | tr '[:upper:]' '[:lower:]')"
fi

SKELETON_DIRS="${KOAD_IO_SKELETONS_DIRS:-${CWD:-$PWD}/skeletons${_entity_dir:+:$_entity_dir/skeletons}:$HOME/.forge/skeletons:$HOME/.koad-io/skeletons}"

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

_deploy_payload() {
  local src="$1" dst="$2" item base
  if command -v rsync >/dev/null 2>&1; then
    rsync -a \
      --exclude='.git/' \
      --exclude='node_modules/' \
      --exclude='control/' \
      --exclude='flavours/' \
      --exclude='*.log' \
      "$src/" "$dst/"
  else
    for item in "$src"/* "$src"/.[!.]*; do
      [ -e "$item" ] || continue
      base="$(basename "$item")"
      case "$base" in
        .git|node_modules|control|flavours) continue ;;
        *.log) continue ;;
      esac
      cp -r "$item" "$dst/"
    done
  fi
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
# `spawn` DEPLOYS into the directory you are standing in, and _deploy_payload is
# `rsync -a` with no --delete: it MERGES, silently overwriting colliding names.
# Run from the framework root it merged a bare skeleton's src/ into ~/.koad-io
# (reproduced on valhalla, 2026-11-05). Nothing asked whether the target was a
# project. This asks.
#
# Implements VESTA-SPEC-243 v1.1 §2.3 + §2.3.1 for the identity-home half of the
# rule set. v1.0 refused "an entity home, or anything inside it", which refused
# every subdirectory of every identity home -- including ~/.mikki/interface, a
# target the operator had recommended to that user by name. F3 protects two
# things now, and only two:
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
# project": --force (§2.5 canonical) and SPAWN_ALLOW_HOSTILE=1 (the scripted
# equivalent). Both override the non-empty/undeclared refusal and NOTHING else
# (§2.5): a protected root has no legitimate case, so no flag reaches it.
#
# NOTE THE MISSING PREFIX ON SPAWN_ALLOW_HOSTILE. It is deliberate. bin/koad-io's
# pre-cascade env sanitization wipes everything matching ^(KOAD_IO_|ENTITY)
# (lines 54-56 direct, 76-83 launcher path, exceptions: ENTITY,
# KOAD_IO_MODEL_CEILING, plus the KOAD_IO_ROOM/KOAD_IO_QUIET pin-and-restore).
# A KOAD_IO_-prefixed override is therefore dropped before this command ever runs
# and can never be honoured. Do not "fix" this name to match the others; it
# works BECAUSE it does not match.

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
# forced-merge warning. Never walks the tree it is about to overwrite.
_spawn_entry_counts() {
  local d=0 f=0 p
  while IFS= read -r p; do
    [ -n "$p" ] || continue
    if [ -d "$p" ]; then d=$((d + 1)); else f=$((f + 1)); fi
  done < <(find "$1" -mindepth 1 -maxdepth 1 2>/dev/null || true)
  printf '%s (%s directories, %s files)\n' "$((d + f))" "$d" "$f"
}

_SPAWN_TARGET="$(_spawn_real "$DATADIR")"
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

# A directory that already holds something — most of all another payload.
# An empty target is the shape we want; a .git/ directory is not payload.
if [ -z "$_SPAWN_RULE" ] && [ -d "$_SPAWN_TARGET" ]; then
  _spawn_first="$(find "$_SPAWN_TARGET" -mindepth 1 -maxdepth 1 \
                     ! -name '.git' ! -name '.DS_Store' -print -quit 2>/dev/null || true)"
  if [ -n "$_spawn_first" ]; then
    _SPAWN_RULE="occupied"
    _spawn_name="$(basename "$_spawn_first")"
    if [ -e "$_SPAWN_TARGET/src/.meteor" ] || [ -d "$_SPAWN_TARGET/src" ] || [ -f "$_SPAWN_TARGET/.env" ]; then
      _SPAWN_WHY="it already carries a project payload (found: $_spawn_name)."
    else
      _SPAWN_WHY="it is not empty (found: $_spawn_name)."
    fi
  fi
fi

# Exactly two override spellings (§2.5). They override the non-empty /
# undeclared refusal and nothing else: a protected root has no legitimate case.
_SPAWN_OVERRIDE=""
if [ "${SPAWN_ALLOW_HOSTILE:-}" = "1" ]; then
  _SPAWN_OVERRIDE="SPAWN_ALLOW_HOSTILE=1"
fi
if [ "$_SPAWN_FORCE" = "1" ]; then
  _SPAWN_OVERRIDE="--force"
fi

if [ -n "$_SPAWN_RULE" ]; then
  case "$_SPAWN_RULE" in
    occupied) _SPAWN_OVERRIDABLE=1 ;;
    *)        _SPAWN_OVERRIDABLE=0 ;;
  esac

  if [ -n "$_SPAWN_OVERRIDE" ] && [ "$_SPAWN_OVERRIDABLE" = "1" ]; then
    # §2.5 — loud, and it names the risk instead of blessing it. The §2.2
    # declaration test is the next pass, so this claims only what was checked:
    # nothing here verifies that the directory declares itself a project.
    echo "[spawn] WARNING — forcing deployment into a non-empty directory"
    echo "[spawn]   target:      $_SPAWN_TARGET"
    echo "[spawn]   entries:     $(_spawn_entry_counts "$_SPAWN_TARGET")"
    echo "[spawn]   override:    $_SPAWN_OVERRIDE"
    echo "[spawn]   The §2.2 declaration test is not implemented yet, so nothing here"
    echo "[spawn]   has verified that this directory declares itself a koad:io project."
    echo "[spawn]   Proceeding under §2.5 of VESTA-SPEC-243. Colliding paths WILL be overwritten."
  else
    if [ -n "$_SPAWN_OVERRIDE" ]; then
      echo "[spawn] note: $_SPAWN_OVERRIDE does not apply to a protected root — §2.3 has no override." >&2
    fi
    if [ "$_SPAWN_RULE" = "occupied" ]; then
      # §2.2's refusal. The declaration test it should quote is the next pass, so
      # this names only what was checked: the directory is not empty.
      _SPAWN_COUNTS="$(_spawn_entry_counts "$_SPAWN_TARGET")"
      # This heredoc is UNQUOTED so $DATADIR/$SKELETON_NAME expand. Anything
      # between backticks or inside a dollar-paren is COMMAND SUBSTITUTION here
      # and runs -- that is how a refusal message once recursively invoked
      # `koad-io spawn` (2026-11-05). Keep this body free of both.
      cat >&2 <<REFUSAL
[spawn] REFUSED — target is not empty
[spawn]   target:      $DATADIR
[spawn]   entries:     $_SPAWN_COUNTS
[spawn]   $_SPAWN_WHY
[spawn]   spawn MERGES a payload (rsync -a, no --delete): colliding names are
[spawn]   overwritten and nothing asks again. Pick a new directory instead.
[spawn]   (The §2.2 declaration test — KOAD_IO_TYPE / KOAD_IO_APP_NAME in ./.env —
[spawn]    is not implemented yet; it is the next pass. VESTA-SPEC-243 §2.2)
[spawn]
[spawn] Create the project directory first, then spawn into it, under an entity handle:
[spawn]   mkdir -p ~/dev/myapp && cd ~/dev/myapp && ${ENTITY:-<entity>} spawn $SKELETON_NAME
[spawn]
[spawn] Deploy here anyway, loudly — override the non-empty refusal only:
[spawn]   ${ENTITY:-<entity>} spawn $SKELETON_NAME --force
REFUSAL
    else
      # §2.3 / §2.3.1 — a protected root. No override reaches this branch.
      # Same heredoc discipline as above: no backticks, no dollar-paren.
      cat >&2 <<REFUSAL
[spawn] REFUSED — target is structurally protected
[spawn]   target:   $DATADIR
[spawn]   matched:  $_SPAWN_MATCH
[spawn]   $_SPAWN_WHY
[spawn]   A skeleton payload is never merged into a protected root. This refusal
[spawn]   has no override: no --force, no SPAWN_ALLOW_HOSTILE. (§2.3, VESTA-SPEC-243)
[spawn]
[spawn] Create the project directory first, then spawn into it, under an entity handle:
[spawn]   mkdir -p ~/dev/myapp && cd ~/dev/myapp && ${ENTITY:-<entity>} spawn $SKELETON_NAME
[spawn]
[spawn] Inside an identity home, any directory you create for a project is a legal
[spawn] target (interface/, websites/<domain>/, apps/<name>/). The identity home root
[spawn] and the 19 reserved subtrees in §2.3.1 are not. (§2.3.1, VESTA-SPEC-243)
[spawn]
[spawn] ('koad-io spawn' with no entity dead-ends: a skeleton's control/install
[spawn]  runs as an entity and refuses without one.)
REFUSAL
    fi
    exit 1
  fi
fi

unset _spawn_probe _spawn_first _spawn_name _spawn_i _SPAWN_TARGET _SPAWN_HOME \
      _SPAWN_FRAMEWORK _SPAWN_SOVEREIGN_HOME _SPAWN_IDHOME _SPAWN_REL _SPAWN_FIRST \
      _SPAWN_FIRST_LC _SPAWN_RULE _SPAWN_MATCH _SPAWN_WHY \
      _SPAWN_OVERRIDE _SPAWN_OVERRIDABLE

# The target is a real directory from here on. Create it if absent and work off
# the physical path, so a symlinked project cannot deploy somewhere the guard
# did not inspect.
mkdir -p "$DATADIR"
DATADIR="$(cd "$DATADIR" && pwd -P)"
export DATADIR

if ! SKELETON_PATH="$(_find_skeleton "$SKELETON_NAME")"; then
  echo "Skeleton '$SKELETON_NAME' not found." >&2
  echo >&2
  echo "Searched:" >&2
  for _r in "${SKELETON_ROOTS[@]}"; do
    [ -n "$_r" ] && echo "  $_r/$SKELETON_NAME" >&2
  done
  echo >&2
  echo "Available skeletons:" >&2
  _available_skeletons >&2
  exit 1
fi

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
_deploy_payload "$SKELETON_PAYLOAD" "$DATADIR"

# A copied Meteor app id makes two apps share one identity. Drop it so Meteor
# mints a fresh one on first run.
while IFS= read -r _meteor_id; do
  [ -n "$_meteor_id" ] || continue
  rm -f "$_meteor_id"
  echo "Cleared inherited Meteor app id: ${_meteor_id#"$DATADIR"/}"
done < <(find "$DATADIR" -maxdepth 4 -path '*/.meteor/.id' 2>/dev/null || true)

if [ -f "$SKELETON_PATH/control/post-install" ]; then
  echo "Running control/post-install for skeleton '$SKELETON_NAME'..."
  echo "exec: $SKELETON_PATH/control/post-install"
  bash "$SKELETON_PATH/control/post-install" "$@"
else
  echo "No controls/post-install script found."
fi

echo "Skeleton deployed successfully."

source "$HOME/.koad-io/helpers/discovery.sh" 2>/dev/null && _koad_io_hint
