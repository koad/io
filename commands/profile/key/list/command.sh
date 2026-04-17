#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# profile key list — walk the sigchain and show root key rotation history
#
# Implements VESTA-SPEC-111 v1.5 §5.2 (koad.key-rotation update semantics).
#
# Algorithm:
#   1. Read the current tip CID from $ENTITY_DIR/var/sigchain-tip
#   2. Walk all cached sigchain entries from tip to genesis
#   3. Collect koad.key-rotation entries + koad.genesis entry (first key)
#   4. Print timeline: each key, when it became active, when it was rotated, reason
#   5. Mark the current active key
#
# Usage:
#   $ENTITY profile key list [--cache-dir DIR]

set -euo pipefail

ENTITY="${ENTITY:-koad}"
ENTITY_DIR="${ENTITY_DIR:-$HOME/.$ENTITY}"
SIGCHAIN_TIP_FILE="$ENTITY_DIR/var/sigchain-tip"
SIGN_HELPER="$(dirname "$(dirname "$(dirname "${BASH_SOURCE[0]}")")")/.helpers/sign.js"

# ── Usage ─────────────────────────────────────────────────────────────────────

usage() {
  cat >&2 <<EOF
profile key list — show root key rotation timeline

Usage:
  $ENTITY profile key list [options]

Options:
  --cache-dir DIR   Directory containing cached sigchain entry JSON files
                    Default: $ENTITY_DIR/var/sigchain-cache
  -h, --help        Show this help

Reads the sigchain tip from: $SIGCHAIN_TIP_FILE
Walks the chain from tip to genesis collecting koad.genesis and koad.key-rotation
entries. Shows the full timeline of root key changes.

Note: Without a live IPFS daemon, only locally cached entries are visible.

See also:
  $ENTITY profile key rotate       — rotate the root key
  $ENTITY profile device-key list  — show authorized device keys
EOF
}

# ── Arg parsing ───────────────────────────────────────────────────────────────

CACHE_DIR="$ENTITY_DIR/var/sigchain-cache"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --cache-dir) CACHE_DIR="$2"; shift 2 ;;
    -h|--help|help) usage; exit 0 ;;
    *) echo "profile key list: unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

# ── Pre-flight checks ─────────────────────────────────────────────────────────

if [[ ! -f "$SIGCHAIN_TIP_FILE" ]]; then
  echo "profile key list: sigchain tip not found: $SIGCHAIN_TIP_FILE" >&2
  echo "Run '$ENTITY profile create' first." >&2
  exit 1
fi

if ! command -v node &>/dev/null; then
  echo "profile key list: node not found." >&2
  exit 1
fi

CURRENT_TIP=$(cat "$SIGCHAIN_TIP_FILE")

# ── Walk sigchain and build key timeline ──────────────────────────────────────

node -e "
const fs   = require('fs');
const path = require('path');

const cacheDir  = process.argv[1];
const tipCid    = process.argv[2];
const entity    = process.argv[3];
const entityDir = process.argv[4];

// Load all cached entries into a CID map.
function loadCachedEntries(dir) {
  const map = {};
  if (!fs.existsSync(dir)) return map;
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  for (const f of files) {
    try {
      const raw  = fs.readFileSync(path.join(dir, f), 'utf8');
      const entry = JSON.parse(raw);
      if (entry._cid) map[entry._cid] = entry;
    } catch (_) {}
  }
  return map;
}

// Also check entityDir/var/ for individual entry files
function loadEntityVarEntries(eDir) {
  const map = {};
  const varDir = path.join(eDir, 'var');
  if (!fs.existsSync(varDir)) return map;
  const files = fs.readdirSync(varDir).filter(f => f.endsWith('.json'));
  for (const f of files) {
    try {
      const raw  = fs.readFileSync(path.join(varDir, f), 'utf8');
      const entry = JSON.parse(raw);
      if (entry._cid) map[entry._cid] = entry;
    } catch (_) {}
  }
  return map;
}

const entryMap = Object.assign(
  {},
  loadCachedEntries(cacheDir),
  loadEntityVarEntries(entityDir)
);

// Walk chain from tip to genesis
const chain = [];
let cid = tipCid;
const visited = new Set();

while (cid && !visited.has(cid)) {
  visited.add(cid);
  const entry = entryMap[cid];
  if (!entry) break;
  chain.push(entry);
  cid = entry.previous || null;
}

// Reverse to get chronological order (oldest first)
chain.reverse();

// Extract genesis pubkey and key rotation events
// The genesis entry establishes the original root key (entity field = pubkey source)
const keyEvents = [];

let genesisKey = null;

for (const entry of chain) {
  if (entry.type === 'koad.genesis') {
    // Genesis: initial root key. The genesis entry's pubkey is the entity's founding key.
    // Per SPEC-111, genesis payload has entity_pubkey or similar.
    const p = entry.payload || {};
    const pubkey = p.entity_pubkey || p.pubkey || null;
    genesisKey = {
      type:       'genesis',
      pubkey,
      activated:  entry.timestamp,
      reason:     'entity created',
      cid:        entry._cid,
    };
    keyEvents.push(genesisKey);
  }

  if (entry.type === 'koad.key-rotation') {
    const p = entry.payload || {};
    keyEvents.push({
      type:       'rotation',
      old_pubkey: p.old_pubkey,
      new_pubkey: p.new_pubkey,
      activated:  p.effective || entry.timestamp,
      rotated_at: p.rotated_at || entry.timestamp,
      reason:     p.reason || 'unspecified',
      cid:        entry._cid,
    });
  }
}

// Build timeline of key eras
// Each era: { pubkey, active_from, active_until, reason_activated, reason_retired, cid }
const eras = [];

if (keyEvents.length === 0) {
  // No genesis or rotation entries in cache — still show what we know
  console.log('');
  console.log('Root key timeline for ' + entity + ':');
  console.log('  Tip CID:    ' + tipCid);
  console.log('  Chain seen: ' + chain.length + ' entries (local cache)');
  console.log('');
  console.log('  No koad.genesis or koad.key-rotation entries found in local cache.');
  console.log('  Without IPFS, only entries written with --cache-dir or --output are visible.');
  process.exit(0);
}

let currentKey = null;

for (const ev of keyEvents) {
  if (ev.type === 'genesis') {
    currentKey = {
      pubkey:            ev.pubkey,
      active_from:       ev.activated,
      active_until:      null,
      reason_activated:  ev.reason,
      reason_retired:    null,
      genesis_cid:       ev.cid,
    };
  } else if (ev.type === 'rotation') {
    // Close out the previous era
    if (currentKey) {
      currentKey.active_until   = ev.rotated_at;
      currentKey.reason_retired = ev.reason;
      eras.push(currentKey);
    }
    // Start new era with the new key
    currentKey = {
      pubkey:            ev.new_pubkey,
      active_from:       ev.activated,
      active_until:      null,
      reason_activated:  'rotation: ' + ev.reason,
      reason_retired:    null,
      rotation_cid:      ev.cid,
    };
  }
}

// The last currentKey is the active one
if (currentKey) {
  eras.push(currentKey);
}

// Output
console.log('');
console.log('Root key timeline for ' + entity + ':');
console.log('  Tip CID:    ' + tipCid);
console.log('  Chain seen: ' + chain.length + ' entries (local cache)');
console.log('  Rotations:  ' + (eras.length - 1));
console.log('');

for (let i = 0; i < eras.length; i++) {
  const era    = eras[i];
  const isLast = i === eras.length - 1;
  const label  = isLast ? '[CURRENT]' : '[RETIRED] ';
  const pubkey = era.pubkey ? era.pubkey.slice(0, 32) + '...' : '(unknown — genesis predates cache)';

  console.log('  ' + label + ' Key ' + (i + 1) + ' of ' + eras.length);
  console.log('    Pubkey:      ' + pubkey);
  console.log('    Active from: ' + era.active_from);
  if (era.active_until) {
    console.log('    Retired:     ' + era.active_until);
    console.log('    Reason:      ' + era.reason_retired);
  }
  if (era.genesis_cid)  console.log('    Genesis CID: ' + era.genesis_cid);
  if (era.rotation_cid) console.log('    Rotation CID:' + era.rotation_cid);
  console.log('');
}
" "$CACHE_DIR" "$CURRENT_TIP" "$ENTITY" "$ENTITY_DIR"
