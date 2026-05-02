#!/usr/bin/env bash
# SPDX-License-Identifier: 0BSD
#
# control/q/answer — answer a question from the kingdom-wide queue (VESTA-SPEC-165)
#
# Usage: <entity> control q answer <id> "<answer-text>"
#        <entity> control q answer <id> --option=<1-based-index-or-string>
#
# Status must be "open". On success, the daemon fires the resume trigger for the asker.

set -euo pipefail

exec node "${ENTITY_DIR:-$HOME/.juno}/control/app/bin/control.js" q answer "$@"
