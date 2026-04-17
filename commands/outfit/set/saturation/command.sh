#!/usr/bin/env bash
# SPDX-License-Identifier: 0BSD

# Set the saturation value in the entity's passenger.json outfit
# Usage: <entity> outfit set saturation <0-100>

source "$HOME/.koad-io/commands/assert/datadir/command.sh"

SAT="$1"

if [[ -z "$SAT" ]]; then
  echo "Usage: $ENTITY outfit set saturation <0-100>"
  exit 64
fi

if [[ "$SAT" -lt 0 || "$SAT" -gt 100 ]] 2>/dev/null; then
  echo "Saturation must be 0-100"
  exit 64
fi

PASSENGER="$DATADIR/passenger.json"

if [[ ! -f "$PASSENGER" ]]; then
  echo "{}" > "$PASSENGER"
fi

python3 -c "
import json
with open('$PASSENGER') as f:
    data = json.load(f)
outfit = data.get('outfit', {})
outfit['s'] = int($SAT)
# Migrate legacy fields if present
if 'saturation' in outfit:
    del outfit['saturation']
if 'brightness' in outfit:
    del outfit['brightness']
if 'hue' in outfit and 'h' not in outfit:
    outfit['h'] = outfit.pop('hue')
elif 'hue' in outfit:
    del outfit['hue']
data['outfit'] = outfit
with open('$PASSENGER', 'w') as f:
    json.dump(data, f, indent=2)
print('outfit.s = $SAT')
"
