#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# koad-io test modes — every command.sh in a commands tree must be committed 755
#
# WHY THIS EXISTS (2026-10-31)
# ----------------------------
# The command cascade resolves a command by DIRECTORY, then execs the shim inside
# it. Git records a file's executable bit in the index, so a command.sh committed
# 100644 arrives at every fresh clone non-executable, and `exec` answers with the
# shell's own "Permission denied" — no file name, no cause, no fix.
#
# That is not hypothetical. On a real sovereign install (valhala.is, 2026-10-21)
# the FIRST act of the whole install was:
#
#     chmod +x ~/.koad-io/commands/curriculum/command.sh   # it was not executable
#
# because curriculum/command.sh was the only command.sh in the tree committed
# 644. The mode bit blocked the map — the 27-note difficulty ramp that
# `curriculum list` prints — so three days later the same learner hand-wrote that
# map from memory and handed it in as homework. One character in an index entry.
#
# Wonderland could not see it: the local copy had been chmod'd without staging
# the mode change, so the file ran here and shipped broken everywhere else.
# A defect that only reproduces on a fresh clone needs a check that reads the
# INDEX, not the working tree. That is this command.
#
# WHAT IT ASSERTS
#   HARD  every `command.sh` in a commands tree is committed 100755.
#         Anything else ships the defect above to every clone.
#   WARN  other tracked `*.sh` in a commands tree that are not 755. The resolver
#         can exec a `<sub>.sh` as a named shim, so these are reachable, but no
#         working path depends on it today — report, do not fail the build.
#   WARN  a command.sh that IS committed 755 but lost the bit in this checkout
#         (copy/restore without modes). Nothing is shipping broken; the resolver
#         restores the bit on first use (bin/koad-io executable-bit preflight).
#
#   Interpreter-run helpers (*.mjs, *.js, *.py — always invoked as `node <file>`
#   or `python3 <file>`) are not entrypoints and are not checked.
#
# Usage:
#   koad-io test modes                 # every commands tree in the cascade
#   koad-io test modes <dir> [...]     # specific trees (any repo with commands/)
#
# Exit: 0 committed modes clean · 1 committed-mode offenders · 2 no trees found

set -uo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; BOLD='\033[1m'; NC='\033[0m'
TAB=$'\t'
_c() { if [ -t 1 ]; then printf '%b' "$1"; else printf '%s' "$2"; fi; }

# ── Which trees ──────────────────────────────────────────────────────────────
# Default: the cascade's own search path (KOAD_IO_COMMANDS_DIRS, PATH-style),
# plus $PWD/commands when run from inside a project.

TREES=()
if [ $# -gt 0 ]; then
    TREES=("$@")
else
    IFS=':' read -ra _dirs <<< "${KOAD_IO_COMMANDS_DIRS:-$HOME/.forge/commands:$HOME/.koad-io/commands}"
    for _d in "${_dirs[@]}"; do
        [ -n "$_d" ] && [ -d "$_d" ] && TREES+=("$_d")
    done
    [ -d "$PWD/commands" ] && TREES+=("$PWD/commands")
fi

if [ ${#TREES[@]} -eq 0 ]; then
    echo "koad-io test modes: no commands tree to check" >&2
    echo "  looked in: KOAD_IO_COMMANDS_DIRS=${KOAD_IO_COMMANDS_DIRS:-<unset>} and \$PWD/commands" >&2
    exit 2
fi

# The cascade list plus $PWD/commands can name the same tree twice; count it once.
_deduped=()
for _t in "${TREES[@]}"; do
    _seen=0
    for _u in ${_deduped[@]+"${_deduped[@]}"}; do
        if [ "$_t" = "$_u" ]; then _seen=1; break; fi
    done
    [ "$_seen" -eq 0 ] && _deduped+=("$_t")
done
TREES=("${_deduped[@]}")
unset _deduped _t _u _seen

# ── Scan ─────────────────────────────────────────────────────────────────────

OFFENDERS=()   # repo<TAB>path<TAB>index-mode  — would ship broken
WARNINGS=()    # path<TAB>problem              — reported, not failing
SHIMS=0        # command.sh files examined
TREE_COUNT=0

for tree in "${TREES[@]}"; do
    if [ ! -d "$tree" ]; then
        echo "  $(_c "$YELLOW" '?') $tree  (not a directory — skipped)"
        continue
    fi
    TREE_COUNT=$((TREE_COUNT + 1))

    repo="$(cd "$tree" && git rev-parse --show-toplevel 2>/dev/null || true)"

    if [ -z "$repo" ]; then
        # No git: there is no committed mode to judge. The working-tree bit still
        # decides whether this box can run anything, so it is reported.
        while IFS= read -r -d '' f; do
            case "$f" in */command.sh) ;; *) continue ;; esac
            SHIMS=$((SHIMS + 1))
            [ -x "$f" ] || WARNINGS+=("$f${TAB}not executable (tree is not a git work tree)")
        done < <(find "$tree" -type f -name command.sh -print0 2>/dev/null)
        continue
    fi

    # The INDEX is the authority on what a fresh clone receives.
    while IFS=$TAB read -r mode path; do
        [ -n "${path:-}" ] || continue
        case "$path" in
            */command.sh) ;;
            *.sh|*.bash)
                # Reachable as a named shim (`koad-io <dir> <sub>` → <dir>/<sub>.sh),
                # so worth reporting — but nothing depends on it today.
                [ "$mode" = "100755" ] || WARNINGS+=("$repo/$path${TAB}(shell script, committed $mode — reachable as a named shim)")
                continue ;;
            *) continue ;;
        esac

        SHIMS=$((SHIMS + 1))
        # A pending deletion keeps its index entry but has no file to judge.
        [ -f "$repo/$path" ] || continue
        if [ "$mode" != "100755" ]; then
            OFFENDERS+=("$repo$TAB$path$TAB$mode")
        elif [ ! -x "$repo/$path" ]; then
            WARNINGS+=("$repo/$path${TAB}committed 100755, but not executable in this checkout")
        fi
    done < <(cd "$repo" && git ls-files -s -- "$tree" 2>/dev/null \
                | awk -F'\t' '{ print substr($1,1,6) "\t" $2 }')
done

# ── Report ───────────────────────────────────────────────────────────────────

echo

if [ ${#OFFENDERS[@]} -eq 0 ]; then
    printf '%s %s\n' "$(_c "$GREEN$BOLD" '[ok]')" \
        "$SHIMS command.sh shim(s) across $TREE_COUNT commands tree(s) — every one committed 100755."
else
    printf '%s\n\n' "$(_c "$RED$BOLD" "[fail] ${#OFFENDERS[@]} of $SHIMS command.sh shim(s) are not committed 100755")"
    printf '  %-10s %s\n' "INDEX" "PATH"
    printf '  %s\n' "--------------------------------------------------------------------------"
    for o in "${OFFENDERS[@]}"; do
        IFS=$TAB read -r repo path mode <<< "$o"
        printf '  %-10s %s\n' "$mode" "$path"
    done
    echo
    echo '  Why it matters: the cascade resolves a command by DIRECTORY, then execs'
    echo '  the shim inside it. A file committed 644 arrives non-executable at every'
    echo '  fresh clone and fails with a bare "Permission denied" — no file, no'
    echo '  cause, no fix. That is how a real sovereign lost the curriculum map on'
    echo '  2026-10-21: the first act of his install was chmod +x on the one'
    echo '  command.sh in the tree that was 644. See this file'"'"'s header.'
    echo
    echo '  Fix by changing the MODE IN THE INDEX, then commit:'
    for o in "${OFFENDERS[@]}"; do
        IFS=$TAB read -r repo path mode <<< "$o"
        echo "    git -C $repo update-index --chmod=+x $path"
        [ -x "$repo/$path" ] || echo "    chmod +x $repo/$path"
    done
    echo
    echo '  (A bare chmod changes the working tree only — exactly how the curriculum'
    echo '  defect stayed invisible on the operator machine while breaking every'
    echo '  clone.)'
fi

if [ ${#WARNINGS[@]} -gt 0 ]; then
    echo
    printf '%s\n' "$(_c "$YELLOW" "[warn] ${#WARNINGS[@]} entrypoint(s) need attention but are not shipping broken:")"
    for w in "${WARNINGS[@]}"; do
        IFS=$TAB read -r path problem <<< "$w"
        printf '  - %s\n      %s\n' "$path" "$problem"
    done
fi

echo
[ ${#OFFENDERS[@]} -eq 0 ] && exit 0
exit 1
