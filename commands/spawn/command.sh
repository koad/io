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
