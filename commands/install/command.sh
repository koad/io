#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# koad-io install — umbrella dispatcher
#
# WHY THIS EXISTS (2026-10-21)
# ----------------------------
# `~/.koad-io/commands/install/` carries sub-commands (opencode/, starship/, deps/)
# and shipped no shim of its own. On a machine that has `~/.forge`, the resolver
# fell through to `~/.forge/commands/install/command.sh` — a *different* script, from
# a different repo — so `koad-io install <thing>` meant one thing on the operator's
# box and another thing on a clean one. On a box with no ~/.forge it simply failed.
#
# install.md §1 documents `koad-io install starship`. It should mean the framework's
# own installer, everywhere.
#
# Routing:
#   koad-io install deps       → deps/command.sh      (module dependencies)
#   koad-io install starship   → starship/command.sh  (prompt)
#   koad-io install opencode   → opencode/command.sh  (harness CLI)
#   koad-io install            → usage, exit 1

set -euo pipefail

_INSTALL_DIR="$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")"

_usage() {
    cat <<'USAGE'
koad-io install — install the things koad:io needs (and does not ship)

Usage:
  koad-io install deps              Install ~/.koad-io/modules/node dependencies
  koad-io install deps --daemon     …and ~/.koad-io/daemon/src dependencies
  koad-io install starship          The prompt
  koad-io install opencode          The default harness CLI

`deps` is the one to run first. Several commands (generate, gestate, init) import
the shared @koad-io/node module, whose dependencies are NOT committed — they are
installed, once per machine. Without them those commands stop with
ERR_MODULE_NOT_FOUND on @scure/bip39.

Always run as the normal user — never with sudo. A root-owned modules/node is not
overwritable later.
USAGE
}

SUB="${1:-}"

case "$SUB" in
    ""|-h|--help|help)
        _usage
        [[ -z "$SUB" ]] && exit 1
        exit 0
        ;;
    --*)
        echo "koad-io install: expected a sub-command, got a flag: $SUB" >&2
        exit 1
        ;;
    *)
        if [ -f "$_INSTALL_DIR/$SUB/command.sh" ]; then
            shift
            exec bash "$_INSTALL_DIR/$SUB/command.sh" "$@"
        fi
        echo "koad-io install: no such installer: $SUB" >&2
        echo "  available: $(cd "$_INSTALL_DIR" && ls -d */ 2>/dev/null | tr -d '/' | tr '\n' ' ')" >&2
        exit 1
        ;;
esac
