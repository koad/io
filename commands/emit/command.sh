#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# emit — structured narration for open lifecycle emissions
#
# Every entity has an active emission ID in $KOAD_IO_EMISSION_ID (set by the
# harness/dispatch hook). These subcommands PATCH that emission with structured
# fields so work becomes visible live on the storefront active-flights pane.
#
# Subcommands:
#   status "..."       Set the current activity headline (replaced each call)
#   note   "..."       Append a timeline note (push-only, never replaced)
#   results "..." | @path  Set the results payload (markdown, replaces prior)
#
# Usage:
#   koad-io emit status "diagnosing the failing test"
#   koad-io emit note "found root cause: stale cache"
#   koad-io emit results "## Done\n\n- shipped X\n- verified Y"
#   koad-io emit results @/tmp/results.md
#
# Flags:
#   --quiet    Suppress stdout confirmation messages
#
# Gate:
#   KOAD_IO_EMIT=1 must be set (same gate as all emission helpers)
#   KOAD_IO_EMISSION_ID must be set to an open emission's _id
#
# This top-level file fires when no subcommand sub-dir matches.
# The dispatcher descends into emit/<sub>/command.sh automatically.

set -euo pipefail

EMIT_CMD_DIR="$(dirname "${BASH_SOURCE[0]}")"

# --- display help if no subcommand ---
echo
echo "koad-io emit"
echo "------------"
echo
echo "Structured narration for open lifecycle emissions."
echo
echo "Usage:   koad-io emit <subcommand> <text>"
echo
echo "Subcommands:"
echo "  status  \"...\"         Set current activity headline (replaced)"
echo "  note    \"...\"         Append a timeline note (push-only)"
echo "  results \"...\" | @path Set results payload (markdown, replaces)"
echo
echo "Environment:"
echo "  KOAD_IO_EMISSION_ID   Active emission _id (required)"
echo "  KOAD_IO_EMIT=1        Opt-in gate (required)"
echo
if [ -z "${KOAD_IO_EMISSION_ID:-}" ]; then
  echo "  (KOAD_IO_EMISSION_ID is not set — set it before calling subcommands)"
fi
if [ "${KOAD_IO_EMIT:-0}" != "1" ]; then
  echo "  (KOAD_IO_EMIT is not 1 — emissions are gated off)"
fi
echo

source "${HOME}/.koad-io/helpers/discovery.sh" 2>/dev/null && _koad_io_hint

exit 0
