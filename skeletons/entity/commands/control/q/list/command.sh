#!/usr/bin/env bash
# SPDX-License-Identifier: 0BSD
#
# control/q/list — list questions from the kingdom-wide queue (VESTA-SPEC-165)
#
# Usage: <entity> control q list [--to=<entity>] [--from=<entity>] [--status=<s>] [--json]
#        <entity> control q list --incoming   # session-start scanner (SPEC-165 §9.2)
#        <entity> control q list [--brief <slug>]   # local bookmarks (SPEC-110)
#
# With --to/--from/--status: queries daemon REST, falls back to local JSONL scan.
# With --incoming: surfaces pending questions + unacked cancellations for session start.
# Without kingdom-wide flags: falls back to legacy local bookmark listing (SPEC-110).

set -euo pipefail

exec node "${ENTITY_DIR:-$HOME/.juno}/control/app/bin/control.js" q list "$@"
