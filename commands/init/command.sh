#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# koad-io init — umbrella dispatcher
#
# WHY THIS EXISTS (2026-10-21)
# ----------------------------
# `~/.koad-io/commands/init/` has carried sub-commands (entity/, sovereign/,
# kingdom/) since the 2026-06 move, but shipped no shim of its own. The resolver
# therefore fell through to `~/.forge/commands/init/command.sh` — a 2026-03-06
# script whose "likelihood" gate scores the FRAMEWORK's directory names
# (.local commands skeletons desktop extension daemon) as if they were an
# entity's. Five of those six never exist inside an entity home, so a fully
# initialized entity scored 1/6 and was declared "not a koad:io entity", exit 1.
#
# That is the verb install.md documented for every newcomer:
#
#     git clone https://github.com/koad/alice.git ~/.alice
#     koad-io init alice          # ← died here, exit 1, on a real entity
#
# The umbrella command was never broken — it was simply absent, and the
# resolver's shimless-directory safety net (bin/koad-io, 2026-10-18) correctly
# walked on to the next candidate. This file makes the documented verb mean what
# the framework PRIMERs say it means: `koad-io init <name>` runs the SPEC-175
# entity state machine.
#
# Routing:
#   koad-io init sovereign ...   → sovereign/command.sh  (kingdom genesis)
#   koad-io init kingdom ...     → kingdom/command.sh
#   koad-io init <name> [...]    → entity/command.sh     (state-aware entity init)
#   koad-io init                 → usage
#
# Ref: VESTA-SPEC-175 §6 — entity key shape
# Ref: VESTA-SPEC-149 — master/leaf split

set -euo pipefail

_INIT_DIR="$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")"

_usage() {
    cat <<'USAGE'
koad-io init — state-aware, idempotent initialization

Usage:
  koad-io init sovereign            Kingdom genesis — create your sovereign identity (do this first)
  koad-io init <name>               Initialize / adopt / migrate an entity by name
  koad-io init <name> <repo-url>    Clone an entity repo, then initialize it
  koad-io init <name> --forceful    Force a re-run (key rotation, launcher overwrite)
  koad-io init kingdom              Kingdom-level initialisation

The entity path detects what shape ~/.<name>/ is already in (no keys, legacy
keys, SPEC-175 keys, SPEC-175 + this device's leaf) and takes the minimal
action. On an already-initialized entity it exits 0 and changes nothing.
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
        echo "koad-io init: expected a sub-command or an entity name, got a flag: $SUB" >&2
        echo "" >&2
        _usage >&2
        exit 1
        ;;
    sovereign)
        shift
        exec bash "$_INIT_DIR/sovereign/command.sh" "$@"
        ;;
    kingdom)
        shift
        exec bash "$_INIT_DIR/kingdom/command.sh" "$@"
        ;;
    *)
        # Any other first argument is an entity name. entity/command.sh routes
        # `sovereign` itself too, so this is the single real entry point.
        exec bash "$_INIT_DIR/entity/command.sh" "$@"
        ;;
esac
