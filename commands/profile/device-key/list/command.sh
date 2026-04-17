#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# profile device-key list — walk the sigchain and show currently authorized device keys
#
# Implements VESTA-SPEC-111 v1.1 §6.5 (device key authorization set).
#
# Algorithm:
#   1. Read the current tip CID from $ENTITY_DIR/var/sigchain-tip
#   2. Walk all sigchain entries from tip to genesis (via cached .json files or IPFS stub)
#   3. Build the authorization set:
#      - koad.device-key-add → add to set
#      - koad.device-key-revoke → remove from set
#   4. Print the currently-authorized device keys
#
# Chain walking uses local cached JSON files first (from --output on prior commands),
# then falls back to a node-based walker that reads the entry objects from disk cache.
#
# Usage:
#   $ENTITY profile device-key list [--cache-dir DIR] [--all]

set -euo pipefail

ENTITY="${ENTITY:-koad}"
ENTITY_DIR="${ENTITY_DIR:-$HOME/.$ENTITY}"
SIGCHAIN_TIP_FILE="$ENTITY_DIR/var/sigchain-tip"
SIGN_HELPER="$(dirname "$(dirname "$(dirname "${BASH_SOURCE[0]}")")")/.helpers/sign.js"

# ── Usage ─────────────────────────────────────────────────────────────────────

usage() {
  cat >&2 <<EOF
profile device-key list — show currently authorized device keys

Usage:
  $ENTITY profile device-key list [options]

Options:
  --cache-dir DIR   Directory containing cached sigchain entry JSON files
                    (written by --output on profile create/update/device-key add/revoke)
                    Default: $ENTITY_DIR/var/sigchain-cache
  --all             Include revoked keys (marked as revoked in output)
  -h, --help        Show this help

Reads the sigchain tip from: $SIGCHAIN_TIP_FILE
Walks the chain from tip to genesis collecting koad.device-key-add and
koad.device-key-revoke entries. Builds the authorization set per SPEC-111 §6.5.

Note: Without a live IPFS daemon, only locally cached entries are visible.
To see the full chain, push entries to IPFS with:
  ipfs dag put --input-codec dag-json --store-codec dag-json < entry.json
EOF
}

# ── Arg parsing ───────────────────────────────────────────────────────────────

CACHE_DIR="$ENTITY_DIR/var/sigchain-cache"
SHOW_ALL=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --cache-dir) CACHE_DIR="$2"; shift 2 ;;
    --all)       SHOW_ALL=true; shift ;;
    -h|--help|help) usage; exit 0 ;;
    *) echo "profile device-key list: unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

# ── Pre-flight checks ─────────────────────────────────────────────────────────

if [[ ! -f "$SIGCHAIN_TIP_FILE" ]]; then
  echo "profile device-key list: sigchain tip not found: $SIGCHAIN_TIP_FILE" >&2
  echo "Run '$ENTITY profile create' first." >&2
  exit 1
fi

if ! command -v node &>/dev/null; then
  echo "profile device-key list: node not found." >&2
  exit 1
fi

CURRENT_TIP=$(cat "$SIGCHAIN_TIP_FILE")

# ── Walk sigchain and build authorization set ─────────────────────────────────

node -e "
const fs = require('fs');
const path = require('path');

const cacheDir  = process.argv[1];
const tipCid    = process.argv[2];
const showAll   = process.argv[3] === 'true';

// Build a CID → entry map from the cache directory.
// Files are named *.json and contain signed entry objects (with _cid if present,
// or CID is derived from the filename if it encodes the CID).
// We walk from tip by following the 'previous' field.

function loadCachedEntries(dir) {
  const map = {}; // cid → entry
  if (!fs.existsSync(dir)) return map;

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  for (const f of files) {
    try {
      const raw = fs.readFileSync(path.join(dir, f), 'utf8');
      const entry = JSON.parse(raw);
      if (entry._cid) {
        map[entry._cid] = entry;
      }
    } catch (_) { /* skip unparseable files */ }
  }
  return map;
}

// Also check $ENTITY_DIR/var/ for individual entry files written with default names
function loadEntityVarEntries(entityDir) {
  const map = {};
  const varDir = path.join(entityDir, 'var');
  if (!fs.existsSync(varDir)) return map;
  const files = fs.readdirSync(varDir).filter(f => f.endsWith('.json'));
  for (const f of files) {
    try {
      const raw = fs.readFileSync(path.join(varDir, f), 'utf8');
      const entry = JSON.parse(raw);
      if (entry._cid) {
        map[entry._cid] = entry;
      }
    } catch (_) {}
  }
  return map;
}

const entityDir = process.argv[4];
const entryMap = Object.assign(
  {},
  loadCachedEntries(cacheDir),
  loadEntityVarEntries(entityDir)
);

// Walk chain from tip collecting device key entries
const chain = [];
let cid = tipCid;
const visited = new Set();

while (cid && !visited.has(cid)) {
  visited.add(cid);
  const entry = entryMap[cid];
  if (!entry) {
    // CID not in local cache — can't walk further without IPFS
    break;
  }
  chain.push(entry);
  cid = entry.previous || null;
}

// Build authorization set per SPEC-111 §6.5 (oldest first)
chain.reverse();

const authorized = {}; // device_id → { device_pubkey, device_description, added_ts, authorized_by }
const revoked    = {}; // device_id → { device_pubkey, reason, revoked_ts }

for (const entry of chain) {
  if (entry.type === 'koad.device-key-add') {
    const p = entry.payload || {};
    authorized[p.device_id] = {
      device_id:          p.device_id,
      device_pubkey:      p.device_pubkey,
      device_description: p.device_description || p.device_id,
      key_type:           p.key_type || 'ed25519',
      authorized_by:      p.authorized_by,
      added_ts:           entry.timestamp,
      cid:                entry._cid,
    };
    delete revoked[p.device_id]; // re-authorized (different pubkey)
  }

  if (entry.type === 'koad.device-key-revoke') {
    const p = entry.payload || {};
    // Only remove if pubkey matches (prevents stale revocations from affecting re-keyed devices)
    if (authorized[p.device_id] && authorized[p.device_id].device_pubkey === p.device_pubkey) {
      revoked[p.device_id] = {
        device_id:     p.device_id,
        device_pubkey: p.device_pubkey,
        reason:        p.reason || 'decommissioned',
        revoked_ts:    entry.timestamp,
        cid:           entry._cid,
      };
      delete authorized[p.device_id];
    }
  }
}

// Output
const authorizedList = Object.values(authorized);
const revokedList    = Object.values(revoked);
const chainDepth     = chain.length;
const uncachedNote   = (Object.keys(entryMap).length === 0 && tipCid)
  ? 'No locally cached entries found. Walk is limited to cached JSON files.'
  : '';

console.log('');
console.log('Authorized device keys for ' + (process.argv[5] || 'entity') + ':');
console.log('  Tip CID:    ' + tipCid);
console.log('  Chain seen: ' + chainDepth + ' entries (local cache)');
if (uncachedNote) {
  console.log('  Note: ' + uncachedNote);
}
console.log('');

if (authorizedList.length === 0) {
  console.log('  No authorized device keys.');
} else {
  for (const k of authorizedList) {
    console.log('  [ACTIVE] ' + k.device_id);
    console.log('    Description: ' + k.device_description);
    console.log('    Pubkey:      ' + k.device_pubkey.slice(0, 16) + '...');
    console.log('    Key type:    ' + k.key_type);
    console.log('    Authorized:  ' + k.added_ts);
    if (k.cid) {
      console.log('    Entry CID:   ' + k.cid);
    }
    console.log('');
  }
}

if (showAll && revokedList.length > 0) {
  console.log('Revoked device keys:');
  for (const k of revokedList) {
    console.log('  [REVOKED] ' + k.device_id);
    console.log('    Pubkey:  ' + k.device_pubkey.slice(0, 16) + '...');
    console.log('    Reason:  ' + k.reason);
    console.log('    Revoked: ' + k.revoked_ts);
    if (k.cid) {
      console.log('    Entry CID: ' + k.cid);
    }
    console.log('');
  }
}

if (!showAll && revokedList.length > 0) {
  console.log('  (' + revokedList.length + ' revoked key(s) hidden. Use --all to show.)');
}
" "$CACHE_DIR" "$CURRENT_TIP" "$SHOW_ALL" "$ENTITY_DIR" "$ENTITY"
