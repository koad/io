#!/usr/bin/env bash
# SPDX-License-Identifier: 0BSD
#
# control/q/ack — acknowledge a cancelled question (VESTA-SPEC-165 §9.4)
#
# Usage: <entity> control q ack <id>
#
# Marks the cancellation as acknowledged. The question is suppressed from
# session-start surfacing once acknowledged.

set -euo pipefail

exec node "${ENTITY_DIR:-$HOME/.juno}/control/app/bin/control.js" q ack "$@"
