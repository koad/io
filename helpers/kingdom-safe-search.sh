#!/usr/bin/env bash
# shellcheck shell=bash

# Shared defaults for the kingdom-safe grep/find wrappers in ~/.koad-io/bin.
# Sourced by the wrappers; not intended to execute on its own.

KG_SAFE_DIR_NAMES=(
  node_modules
  isopacks
  .git
  dist
  coverage
  vendor
  .cache
  cache
  .tmp
  tmp
  temp
  builds
  .next
  .nuxt
  .svelte-kit
  .turbo
  .parcel-cache
  .yarn
  .pnpm-store
  .local
  .opencode
  .claude
  .pytest_cache
)

# Path-specific toxic trees we want to skip without hiding the whole parent.
KG_SAFE_PATH_PATTERNS=(
  '*/.meteor/local'
  '*/.meteor/local/*'
)

# Absolute runtime/exhaust trees. These matter most when the operator searches
# a broad home/project root and accidentally walks the runtime substrate.
KG_SAFE_ABS_PATHS=(
  "$HOME/.local/share/koad-io/runtime"
  "$HOME/.local/share/koad-io/passenger"
  "$HOME/.koad-io/harness/sessions"
)

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

kg_safe_excludes_summary() {
  local _summary=()
  _summary+=("$(kg_safe_join_by ', ' "${KG_SAFE_DIR_NAMES[@]}")")
  _summary+=(".meteor/local")
  _summary+=("~/.local/share/koad-io/runtime")
  _summary+=("~/.local/share/koad-io/passenger")
  _summary+=("~/.koad-io/harness/sessions")
  kg_safe_join_by ', ' "${_summary[@]}"
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
  printf '%s safe excludes:\n' "$_tool"
  local _name
  for _name in "${KG_SAFE_DIR_NAMES[@]}"; do
    printf '  - %s/\n' "$_name"
  done
  printf '  - .meteor/local/\n'
  printf '  - %s/\n' "$HOME/.local/share/koad-io/runtime"
  printf '  - %s/\n' "$HOME/.local/share/koad-io/passenger"
  printf '  - %s/\n' "$HOME/.koad-io/harness/sessions"
}
