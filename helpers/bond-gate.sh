#!/usr/bin/env bash
# SPDX-License-Identifier: 0BSD

_koad_io_bond_gate_cli() {
  node "$HOME/.koad-io/modules/node/bond-gate-cli.js" "$@"
}

koad_io_require_command() {
  local _cmd="$1"
  shift || true
  local _args=(command "$_cmd")
  while [ $# -gt 0 ]; do
    _args+=("--alias=$1")
    shift
  done
  _koad_io_bond_gate_cli "${_args[@]}" || return $?
}

koad_io_require_path() {
  local _mode="$1"
  local _target="$2"
  _koad_io_bond_gate_cli path "$_mode" "$_target" --cwd="$PWD" || return $?
}

koad_io_bond_scope() {
  _koad_io_bond_gate_cli scope "$@"
}
