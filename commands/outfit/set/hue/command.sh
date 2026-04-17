#!/usr/bin/env bash
# SPDX-License-Identifier: 0BSD

# Set the hue value in the entity's passenger.json outfit
# Usage: <entity> outfit set hue <0-360>

source "$HOME/.koad-io/commands/assert/datadir/command.sh"

HUE="$1"

if [[ -z "$HUE" ]]; then
  echo "Usage: $ENTITY outfit set hue <0-360>"
  exit 64
fi

if [[ "$HUE" -lt 0 || "$HUE" -gt 360 ]] 2>/dev/null; then
  echo "Hue must be 0-360"
  exit 64
fi

PASSENGER="$DATADIR/passenger.json"

if [[ ! -f "$PASSENGER" ]]; then
  echo "{}" > "$PASSENGER"
fi

# Update or create outfit.h using python3 (no jq dependency)
python3 -c "
import json, sys
with open('$PASSENGER') as f:
    data = json.load(f)
outfit = data.get('outfit', {})
outfit['h'] = int($HUE)
# Migrate legacy fields if present
if 'hue' in outfit:
    del outfit['hue']
if 'brightness' in outfit:
    del outfit['brightness']
if 'saturation' in outfit and 's' not in outfit:
    outfit['s'] = outfit.pop('saturation')
elif 'saturation' in outfit:
    del outfit['saturation']
data['outfit'] = outfit
with open('$PASSENGER', 'w') as f:
    json.dump(data, f, indent=2)
print('outfit.h = $HUE')
"
