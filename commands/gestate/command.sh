#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# koad-io gestate — umbrella dispatcher
#
# WHY THIS EXISTS (2026-10-21)
# ----------------------------
# `~/.koad-io/commands/gestate/` has carried a single sub-command (entity/)
# and shipped no shim of its own. The resolver therefore reported
#
#     Could not find command file for 'gestate' — checked:
#       /home/<user>/.koad-io/commands/gestate
#     'gestate' has sub-commands: entity
#     try: koad-io gestate entity ...
#
# and — the part that matters — **exited 0**. A script that checks `$?` after
# `koad-io gestate myentity` believes an entity was created; nothing was.
#
# Same class as the missing `init` shim (acab331) and the same silent-success
# defect: a command that cannot do what it was asked must not report success.
#
# Routing:
#   koad-io gestate entity <name> …  → entity/command.sh   (gestation ceremony)
#   koad-io gestate <name> [...]     → entity/command.sh   (compatibility: same path)
#   koad-io gestate                  → usage, exit 1
#
# The bare-name form is a compatibility reading for docs and scripts written
# before the namespace existed. `gestate <name>` and `gestate entity <name>` are
# the same code path.
#
# Ref: VESTA-SPEC-175 §7 — sovereign-signed entity key flow
# Ref: install.md §7 Option 2

set -euo pipefail

_GESTATE_DIR="$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")"

_usage() {
    cat <<'USAGE'
koad-io gestate — create a new entity from scratch

Usage:
  koad-io gestate entity <name>              Create ~/.<name> with keys, dirs, launcher
  koad-io gestate entity <name> --as-authorized-agent
                                             Provisional entity; a sovereign countersigns later

Name rules: 3–12 lowercase letters, no hyphens, underscores or digits.
`me` is reserved — ~/.koad-io/me/ is the sovereign.

A gestated entity is created without any sovereign identity on this device: its
own keypair is minted, it is marked provisional, and a sovereign countersigns it
when one exists. Minting an entity's key does not require a sovereign; certifying
it does. See install.md §7.

Compatibility: `koad-io gestate <name>` runs the same path as
`koad-io gestate entity <name>`.
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
        echo "koad-io gestate: expected a sub-command or an entity name, got a flag: $SUB" >&2
        echo "" >&2
        _usage >&2
        exit 1
        ;;
    entity)
        shift
        exec bash "$_GESTATE_DIR/entity/command.sh" "$@"
        ;;
    *)
        # Any other first argument is an entity name (compatibility reading).
        exec bash "$_GESTATE_DIR/entity/command.sh" "$@"
        ;;
esac
