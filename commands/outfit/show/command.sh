#!/usr/bin/env bash
# SPDX-License-Identifier: 0BSD

# Show the current entity's outfit
# Usage: <entity> outfit show

source "$HOME/.koad-io/commands/assert/datadir/command.sh"

PASSENGER="$DATADIR/passenger.json"

if [[ ! -f "$PASSENGER" ]]; then
  echo "No passenger.json found"
  exit 64
fi

python3 -c "
import json
with open('$PASSENGER') as f:
    data = json.load(f)
outfit = data.get('outfit', {})
if not outfit:
    print('No outfit defined')
else:
    for k, v in outfit.items():
        print(f'  {k}: {v}')
"
