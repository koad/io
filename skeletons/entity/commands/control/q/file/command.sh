#!/usr/bin/env bash
# SPDX-License-Identifier: 0BSD
#
# control/q/file — file a blocking question to another entity (VESTA-SPEC-165)
#
# Usage: <entity> control q file --to=<entity> --question="<text>" \
#          [--options="a,b,c"] [--workdir=<path>] [--context-ref=<file>]
#
# Files a question to the kingdom-wide queue, exits with question_id on stdout.
# After this, close the flight with --blocked --question-id=<id> per SPEC-096.

set -euo pipefail

exec node "${ENTITY_DIR:-$HOME/.juno}/control/app/bin/control.js" q file "$@"
