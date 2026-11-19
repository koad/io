#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# contacts — canon contacts + Keybase sync.
#
#   koad-io contacts sync     scrape Keybase into /kingdom/contacts/keybase/<username>/
#   koad-io contacts path     print the sync root
#   koad-io contacts list     summarize the last sync
#
# The app (koad:io-contacts) only READS the synced folders — it never calls Keybase
# live. Sync is manual (or the UI's Resync button) precisely so we don't hammer the
# Keybase servers.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${KOAD_IO_CONTACTS_DIR:-/kingdom/contacts/keybase}"

cmd="${1:-list}"
[ $# -gt 0 ] && shift || true

case "$cmd" in
  sync)
    exec node "$DIR/sync.mjs" "$@"
    ;;
  path)
    echo "$ROOT"
    ;;
  list)
    if [ -f "$ROOT/index.json" ]; then
      jq -r '"[\(.syncedAt)] \(.contacts|length) contacts · \(.teamCount) teams · me \(.me)"' "$ROOT/index.json"
    else
      echo "no keybase contacts synced yet — run: koad-io contacts sync"
    fi
    ;;
  *)
    echo "contacts: unknown subcommand '$cmd' (sync|path|list)" >&2
    exit 1
    ;;
esac
