#!/usr/bin/env bash
# SPDX-License-Identifier: 0BSD
#
# control/q/cancel — cancel a question without answering (VESTA-SPEC-165)
#
# Usage: <entity> control q cancel <id> [--reason="<text>"]
#
# Appends a cancelled record to the queue. No resume fires.
# The asker sees the cancellation at next session start until they ack it.

set -euo pipefail

exec node "${ENTITY_DIR:-$HOME/.juno}/control/app/bin/control.js" q cancel "$@"
