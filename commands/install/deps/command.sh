#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# koad-io install deps — install the module dependencies koad:io does not ship
#
# WHY THIS EXISTS (2026-10-21)
# ----------------------------
# `modules/node` is the shared @koad-io/node module (crypto, identity, ceremony,
# bond gate). Its `package.json` and `package-lock.json` are committed; its
# `node_modules/` is gitignored — correctly, it is 60+ packages. Nothing in
# `commands/` or `bin/` ever ran `npm install` for it.
#
# Consequence, seen on both a fresh clone and a machine that had been running
# koad:io for months (citadel, 2026-10-21):
#
#   $ koad-io generate cid 'skatefish'
#   Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@scure/bip39'
#     imported from /home/koad/.koad-io/modules/node/index.js
#
# A raw Node stack trace, from a command whose real problem is one missing
# directory. This command is the remedy; `bin/koad-io` detects the condition and
# names it before the stack trace can happen.
#
# Usage:
#   koad-io install deps              modules/node
#   koad-io install deps --daemon     modules/node + daemon/src
#   koad-io install deps --check      report only, change nothing (exit 1 if missing)

set -euo pipefail

FRAMEWORK_DIR="$HOME/.koad-io"
NODE_MOD_DIR="$FRAMEWORK_DIR/modules/node"
DAEMON_DIR="$FRAMEWORK_DIR/daemon/src"

WITH_DAEMON=0
CHECK_ONLY=0
for arg in "$@"; do
    case "$arg" in
        --daemon|--all) WITH_DAEMON=1 ;;
        --check)        CHECK_ONLY=1 ;;
        -h|--help)
            sed -n '3,30p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
            exit 0
            ;;
    esac
done

say() { echo "[deps] $*"; }
die() { echo "[deps] ERROR: $*" >&2; exit 1; }

command -v node >/dev/null 2>&1 || die "node is not on PATH — install Node.js (>=18) first"
command -v npm  >/dev/null 2>&1 || die "npm is not on PATH — install it alongside Node.js"

# One directory: has lockfile → `npm ci` (reproducible, exactly the lock), else `npm install`.
install_one() {
    local dir="$1" label="$2"

    [ -d "$dir" ] || { say "$label — not present at $dir, skipping"; return 0; }
    [ -f "$dir/package.json" ] || { say "$label — no package.json, skipping"; return 0; }

    if [ -d "$dir/node_modules" ] && [ "$CHECK_ONLY" -eq 1 ]; then
        say "$label — installed (node_modules present)"
        return 0
    fi

    if [ "$CHECK_ONLY" -eq 1 ]; then
        say "$label — MISSING (node_modules absent)"
        return 1
    fi

    if [ -d "$dir/node_modules" ]; then
        say "$label — already installed, nothing to do"
        return 0
    fi

    say "$label — installing into $dir"
    if [ -f "$dir/package-lock.json" ]; then
        ( cd "$dir" && npm ci --no-audit --no-fund ) || die "$label — npm ci failed in $dir"
    else
        ( cd "$dir" && npm install --no-audit --no-fund ) || die "$label — npm install failed in $dir"
    fi
    say "$label — done"
}

# A root-owned node_modules cannot be replaced by a later `npm ci`; say so plainly.
for dir in "$NODE_MOD_DIR" "$DAEMON_DIR"; do
    if [ -d "$dir/node_modules" ] && [ ! -w "$dir/node_modules" ]; then
        die "$dir/node_modules is not writable by $(id -un) — fix with: sudo chown -R \$USER:\$USER $dir"
    fi
done

STATUS=0
install_one "$NODE_MOD_DIR" "modules/node" || STATUS=1
[ "$WITH_DAEMON" -eq 1 ] && { install_one "$DAEMON_DIR" "daemon/src" || STATUS=1; }

if [ "$STATUS" -eq 0 ]; then
    # Prove it, rather than claiming it: importing the module is the check the
    # failing commands actually perform.
    if [ -d "$NODE_MOD_DIR/node_modules" ]; then
        if ( cd "$NODE_MOD_DIR" && node -e "import('./index.js').then(m=>process.exit(Object.keys(m).length?0:1)).catch(e=>{console.error(e.code||e.message);process.exit(1)})" >/dev/null 2>&1 ); then
            say "modules/node imports cleanly"
        else
            say "WARNING: modules/node still fails to import — run: cd $NODE_MOD_DIR && npm ci"
            STATUS=1
        fi
    fi
fi

exit "$STATUS"
