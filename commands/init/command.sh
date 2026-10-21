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
#   koad-io init entity <name> … → entity/command.sh     (SPEC-175 state machine)
#   koad-io init kingdom ...     → kingdom/command.sh    (chain-URI garden bootstrap)
#   koad-io init <name> [...]    → entity/command.sh     (compatibility: same path)
#   koad-io init                 → usage
#
# `init` is a NAMESPACE (2026-10-21, koad: "we moved init into entity subcommand
# to make way for init sovereign and init kingdom"). The bare-name form is a
# compatibility reading of the same code path, and a namespace is only real if a
# wrong word in it is an error — `init soverign` used to gestate an entity called
# "soverign" at ~/.soverign. Words that look like a namespace word are now
# refused with the canonical form spelled out.
#
# Ref: VESTA-SPEC-175 §6 — entity key shape
# Ref: VESTA-SPEC-149 — master/leaf split

set -euo pipefail

_INIT_DIR="$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")"

_usage() {
    cat <<'USAGE'
koad-io init — state-aware, idempotent initialization

Usage:
  koad-io init sovereign                  Kingdom genesis — your sovereign identity (do this first)
  koad-io init entity <name>              Initialize / adopt / migrate an entity by name
  koad-io init entity <name> <repo-url>   Clone an entity repo, then initialize it
  koad-io init entity <name> --forceful   Force a re-run (key rotation, launcher overwrite)
  koad-io init kingdom                   Bootstrap a kingdom garden from a chain URI

`init` is a namespace, and the three sub-commands are peers: sovereign, entity,
kingdom. The entity state machine is one of them, not the default reading of
whatever word follows `init`.

Compatibility: `koad-io init <name>` still runs the entity path, for scripts and
docs written before the namespace existed. It is supported, not recommended —
and a word that looks like a namespace is an error (use `init entity <name>` for
an entity that happens to be named like one).

The entity path detects what shape ~/.<name>/ is already in (no keys, legacy
keys, SPEC-175 keys, SPEC-175 + this device's leaf) and takes the minimal
action. On an already-initialized entity it exits 0 and changes nothing.

Before a device leaf is minted for an entity key it did not mint, `init` looks
for a koad.entity.genesis in your own sigchain. No proof, no adoption — it says
what it found and asks (--adopt / --re-seed). See install.md §7.
USAGE
}

# A word that is one or two characters away from a namespace, and shares its
# first three letters, is far more likely to be a typo than an entity name.
# Deliberately a heuristic: the cost of a false positive is one extra word
# (`init entity kingsley`), the cost of a false negative is a directory named
# ~/.soverign and a confused newcomer.
_resembles_namespace() {
    local word="$1" ns lw ln
    for ns in sovereign kingdom entity; do
        [ "${word:0:1}" = "${ns:0:1}" ] || continue
        lw=${#word}; ln=${#ns}
        if [ $(( lw > ln ? lw - ln : ln - lw )) -le 2 ] && [ "${word:0:3}" = "${ns:0:3}" ]; then
            echo "$ns"
            return 0
        fi
    done
    return 1
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
    entity)
        shift
        exec bash "$_INIT_DIR/entity/command.sh" "$@"
        ;;
    *)
        if resembling=$(_resembles_namespace "$SUB"); then
            {
                echo "koad-io init: '$SUB' is not a sub-command, and it is not an entity name"
                echo "              this command is willing to guess at."
                echo ""
                echo "  sub-commands:  init sovereign  |  init entity <name>  |  init kingdom"
                if [ "$resembling" = "entity" ]; then
                    echo "  did you mean:  koad-io init entity ${2:-<name>} ${*:3}" | sed 's/ *$//'
                else
                    echo "  did you mean:  koad-io init $resembling ${*:2}" | sed 's/ $//'
                    echo "  or, if this is an entity:  koad-io init entity $SUB ${*:2}" | sed 's/ $//'
                fi
            } >&2
            exit 1
        fi
        # Any other first argument is an entity name (compatibility reading).
        exec bash "$_INIT_DIR/entity/command.sh" "$@"
        ;;
esac

