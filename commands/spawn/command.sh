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
# Deliberately conservative: the canon ruling on what MAKES a directory a project
# root is still owed to Vesta (2026-11-05). This refuses the structures we can
# name today and explains itself; it does not pretend to define a project root.
#
# KOAD_IO_SPAWN_ALLOW_HOSTILE=1 overrides, loudly, for the rare legitimate case.

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

_SPAWN_TARGET="$(_spawn_real "$DATADIR")"
_SPAWN_HOME="$(_spawn_real "$HOME")"
_SPAWN_RULE=""
_SPAWN_WHY=""

# Home itself, then any skeletons/ tree (a skeleton or its payload directory),
# then the framework root and ~/.forge — is or inside, all of them. Most specific
# rule first, so the message names the closest true reason.
if [ "$_SPAWN_TARGET" = "$_SPAWN_HOME" ]; then
  _SPAWN_RULE="home"
  _SPAWN_WHY="that is your home directory, not a project."
else
  case "/$_SPAWN_TARGET/" in
    */skeletons/*|*/skeleton/*)
      _SPAWN_RULE="skeleton"
      _SPAWN_WHY="that is a skeleton source tree, not a project."
      ;;
  esac
fi

if [ -z "$_SPAWN_RULE" ]; then
  if _spawn_is_or_inside "$_SPAWN_TARGET" "$_SPAWN_HOME/.koad-io"; then
    _SPAWN_RULE="framework"
    if [ "$_SPAWN_TARGET" = "$_SPAWN_HOME/.koad-io" ]; then
      _SPAWN_WHY="that is the framework root, not a project."
    else
      _SPAWN_WHY="that is inside the framework (~/.koad-io)."
    fi
  elif _spawn_is_or_inside "$_SPAWN_TARGET" "$_SPAWN_HOME/.forge"; then
    _SPAWN_RULE="forge"
    if [ "$_SPAWN_TARGET" = "$_SPAWN_HOME/.forge" ]; then
      _SPAWN_WHY="that is the forge root, not a project."
    else
      _SPAWN_WHY="that is inside ~/.forge, which holds existing kingdom work."
    fi
  fi
fi

# An entity home, or anything inside one. Walk up to $HOME and look for markers.
if [ -z "$_SPAWN_RULE" ]; then
  _spawn_probe="$_SPAWN_TARGET"
  while _spawn_is_or_inside "$_spawn_probe" "$_SPAWN_HOME"; do
    if [ -f "$_spawn_probe/ENTITY.md" ] || [ -f "$_spawn_probe/passenger.json" ]; then
      _SPAWN_RULE="entity"
      if [ "$_spawn_probe" = "$_SPAWN_TARGET" ]; then
        _SPAWN_WHY="that is an entity home (it carries ENTITY.md or passenger.json)."
      else
        _SPAWN_WHY="that is inside the entity home $_spawn_probe."
      fi
      break
    fi
    [ "$_spawn_probe" = "$_SPAWN_HOME" ] && break
    _spawn_probe="$(dirname "$_spawn_probe")"
  done
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

if [ -n "$_SPAWN_RULE" ]; then
  if [ "${KOAD_IO_SPAWN_ALLOW_HOSTILE:-}" = "1" ]; then
    echo "spawn: KOAD_IO_SPAWN_ALLOW_HOSTILE=1 — override engaged."
    echo "spawn: $_SPAWN_WHY"
    echo "spawn: deploying anyway into $_SPAWN_TARGET. rsync -a merges: colliding names WILL be overwritten."
  else
    cat >&2 <<REFUSAL
refusing to spawn into $DATADIR — $_SPAWN_WHY

spawn deploys into the directory you are standing in, so that directory has to be
a new, empty project folder — not the framework, not ~/.forge, not an entity home,
not a skeleton, and not a folder that already holds something.

Create the project first, then spawn into it:
  mkdir -p ~/dev/myapp && cd ~/dev/myapp && koad-io spawn $SKELETON_NAME

Refused by rule: $_SPAWN_RULE
Override (it prints what it is doing):
  KOAD_IO_SPAWN_ALLOW_HOSTILE=1 koad-io spawn $SKELETON_NAME
REFUSAL
    exit 1
  fi
fi

unset _spawn_probe _spawn_first _spawn_name _SPAWN_TARGET _SPAWN_HOME _SPAWN_RULE _SPAWN_WHY

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
