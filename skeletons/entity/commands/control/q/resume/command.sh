#!/usr/bin/env bash
# SPDX-License-Identifier: 0BSD
#
# control/q/resume — manually re-trigger resume for an answered question (VESTA-SPEC-165)
#
# Usage: <entity> control q resume <id>
#
# Question must be in "answered" state. Fires the resume dispatch via daemon REST.
# If daemon is unavailable, prints the resume prompt for manual use.

set -euo pipefail

exec node "${ENTITY_DIR:-$HOME/.juno}/control/app/bin/control.js" q resume "$@"
