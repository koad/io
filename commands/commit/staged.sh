#!/usr/bin/env bash
# SPDX-License-Identifier: 0BSD

PROMPT="
Review the currently staged files and craft a git commit message that is meaningful. 
Focus on the *why* behind the changes, not just what was mechanically modified. 
The subject line should be clear and concise (under 72 characters). 
Do not include any commentary or explanation outside of the commit message itself. 
If there are no staged files, then do nothing other than say so.
Once the message is ready, create the commit. Do not push.
"

if ! git rev-parse --is-inside-work-tree > /dev/null 2>&1; then
  echo "Error: not inside a git repository." >&2
  exit 1
fi

opencode --model "${OPENCODE_MODEL:-opencode/big-pickle}" run "$PROMPT"
