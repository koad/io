#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# profile view — display a sigchain entry or local profile JSON
#
# Two modes:
#   --file FILE    Display a local JSON entry file (parses any sigchain entry type)
#   --chain FILE...  Walk a sequence of local files and display the resolved profile
#
# IPFS chain-walk (fetch by CID) is stubbed until the daemon's IPFS node is running.
# Local file mode works today.
#
# Usage:
#   $ENTITY profile view --file entry.json
#   $ENTITY profile view --chain profile-state.json genesis.json
#   $ENTITY profile view --json

set -euo pipefail

ENTITY="${ENTITY:-koad}"
ENTITY_DIR="${ENTITY_DIR:-$HOME/.$ENTITY}"
SIGCHAIN_TIP_FILE="$ENTITY_DIR/var/sigchain-tip"

# ── Usage ─────────────────────────────────────────────────────────────────────

usage() {
  cat >&2 <<EOF
profile view — display a sovereign profile from a local sigchain entry

Usage:
  $ENTITY profile view --file ENTRY.json        display a single entry
  $ENTITY profile view --chain TIP.json [...]    display resolved profile from chain
  $ENTITY profile view --json                    output as JSON

Options:
  --file FILE           Parse and display a single local JSON entry
  --chain FILE...       Walk chain files (tip first); display resolved profile
  --verify              Also run signature verification (requires --file or --chain)
  --json                Output profile data as JSON
  -h, --help            Show this help

Note: IPFS fetch by CID is not yet wired. Use --file or --chain with locally
exported entry JSON files (from 'profile create --output DIR').

See also:
  $ENTITY profile create   — create your profile
  $ENTITY profile update   — update your profile
  $ENTITY profile verify   — verify chain signatures
  $ENTITY profile publish  — announce tip to canonical location
EOF
}

# ── Arg parsing ───────────────────────────────────────────────────────────────

FILE=""
CHAIN_FILES=()
DO_VERIFY=false
JSON_OUTPUT=false
IN_CHAIN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --file)     FILE="$2"; shift 2 ;;
    --chain)    IN_CHAIN=true; shift ;;
    --verify)   DO_VERIFY=true; shift ;;
    --json)     JSON_OUTPUT=true; shift ;;
    -h|--help|help) usage; exit 0 ;;
    -*)         echo "profile view: unknown option: $1" >&2; usage; exit 1 ;;
    *)
      if [[ "$IN_CHAIN" == true ]]; then
        CHAIN_FILES+=("$1"); shift
      else
        echo "profile view: unexpected argument: $1" >&2; usage; exit 1
      fi
      ;;
  esac
done

# ── Display a single entry ────────────────────────────────────────────────────

display_entry() {
  local entry_file="$1"
  local entry

  if [[ ! -f "$entry_file" ]]; then
    echo "profile view: file not found: $entry_file" >&2
    return 1
  fi

  entry=$(cat "$entry_file")

  if ! command -v node &>/dev/null; then
    echo "profile view: node not found." >&2
    return 1
  fi

  if [[ "$JSON_OUTPUT" == true ]]; then
    # Pretty-print the entry JSON
    echo "$entry" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.stringify(JSON.parse(d),null,2)))"
    return 0
  fi

  # Human-readable display
  node -e "
const fs = require('fs');
const entry = JSON.parse(process.argv[1]);
const type = entry.type || 'unknown';
const entity = entry.entity || '(unknown)';
const ts = entry.timestamp || '(unknown)';
const prev = entry.previous;
const sig = entry.signature ? entry.signature.substring(0, 16) + '...' : '(none)';

console.log('Type:      ' + type);
console.log('Entity:    ' + entity);
console.log('Timestamp: ' + ts);
console.log('Previous:  ' + (prev || '(genesis)'));
console.log('Signature: ' + sig);
console.log('');

if (type === 'koad.genesis') {
  const p = entry.payload || {};
  console.log('Genesis payload:');
  console.log('  pubkey:      ' + (p.pubkey || '(missing)'));
  console.log('  created:     ' + (p.created || ''));
  console.log('  description: ' + (p.description || ''));
} else if (type === 'koad.state-update') {
  const p = entry.payload || {};
  const scope = p.scope || '(no scope)';
  console.log('State update (scope: ' + scope + '):');
  if (scope === 'profile') {
    const d = p.data || {};
    console.log('  name:    ' + (d.name || '(not set)'));
    console.log('  bio:     ' + (d.bio || '(not set)'));
    console.log('  avatar:  ' + (d.avatar || '(not set)'));
    const proofs = d.socialProofs || [];
    if (proofs.length > 0) {
      console.log('  proofs:  ' + JSON.stringify(proofs));
    } else {
      console.log('  proofs:  (none)');
    }
  } else {
    console.log('  data: ' + JSON.stringify(p.data || {}, null, 2).replace(/\n/g, '\n  '));
  }
} else {
  console.log('Payload:');
  console.log('  ' + JSON.stringify(entry.payload || {}, null, 2).replace(/\n/g, '\n  '));
}
" "$entry"
}

# ── Resolve profile from chain ────────────────────────────────────────────────

display_chain_profile() {
  local -a files=("$@")
  local profile_name="" profile_bio="" profile_avatar="" profile_proofs=""
  local found_profile=false

  # Walk chain files (tip first) looking for most recent koad.state-update scope:profile
  for f in "${files[@]}"; do
    if [[ ! -f "$f" ]]; then
      echo "profile view: file not found: $f" >&2
      continue
    fi

    local type scope
    type=$(node -e "const e=JSON.parse(require('fs').readFileSync('$f','utf8')); process.stdout.write(e.type||'');" 2>/dev/null)

    if [[ "$type" == "koad.state-update" ]]; then
      scope=$(node -e "const e=JSON.parse(require('fs').readFileSync('$f','utf8')); process.stdout.write((e.payload&&e.payload.scope)||'');" 2>/dev/null)
      if [[ "$scope" == "profile" ]] && [[ "$found_profile" == false ]]; then
        found_profile=true
        profile_name=$(node -e "const e=JSON.parse(require('fs').readFileSync('$f','utf8')); process.stdout.write((e.payload&&e.payload.data&&e.payload.data.name)||'');" 2>/dev/null)
        profile_bio=$(node -e "const e=JSON.parse(require('fs').readFileSync('$f','utf8')); process.stdout.write((e.payload&&e.payload.data&&e.payload.data.bio)||'');" 2>/dev/null)
        profile_avatar=$(node -e "const e=JSON.parse(require('fs').readFileSync('$f','utf8')); const a=(e.payload&&e.payload.data&&e.payload.data.avatar); process.stdout.write(a||'');" 2>/dev/null)
      fi
    fi
  done

  if [[ "$JSON_OUTPUT" == true ]]; then
    local tip_file="${files[0]}"
    local tip_cid
    tip_cid=$(node -e "
      const SIGN_HELPER = process.argv[1];
      const e = JSON.parse(require('fs').readFileSync(process.argv[2],'utf8'));
      // Recompute CID manually
      const sorted = sortKeysDeep(e);
      function sortKeysDeep(o) { if (!o||typeof o!=='object'||Array.isArray(o)) return o; const s={}; Object.keys(o).sort().forEach(k=>s[k]=sortKeysDeep(o[k])); return s; }
      const bytes = Buffer.from(JSON.stringify(sorted));
      const crypto = require('crypto');
      const digest = crypto.createHash('sha256').update(bytes).digest();
      function encodeVarint(n) { const b=[]; while(n>0x7f){b.push((n&0x7f)|0x80);n=n>>>7;} b.push(n&0x7f); return Buffer.from(b); }
      function base32lower(bytes) { const a='abcdefghijklmnopqrstuvwxyz234567'; let r='',bits=0,val=0; for(const b of bytes){val=(val<<8)|b;bits+=8;while(bits>=5){bits-=5;r+=a[(val>>>bits)&0x1f];}} if(bits>0)r+=a[(val<<(5-bits))&0x1f]; return r; }
      const cidBytes = Buffer.concat([Buffer.from([0x01]), encodeVarint(0x0129), encodeVarint(0x12), encodeVarint(32), digest]);
      process.stdout.write('b' + base32lower(cidBytes));
    " "" "$tip_file" 2>/dev/null || echo "(unknown)")

    node -e "
const o = {
  entity: process.argv[1],
  tipCid: process.argv[2],
  profile: {
    name: process.argv[3],
    bio: process.argv[4],
    avatar: process.argv[5] || null,
    socialProofs: []
  }
};
console.log(JSON.stringify(o, null, 2));
" "$ENTITY" "$tip_cid" "$profile_name" "$profile_bio" "$profile_avatar"
  else
    echo "Profile: $ENTITY"
    echo "Source:  ${#files[@]} local file(s)"
    echo ""
    if [[ "$found_profile" == true ]]; then
      echo "  Name:    ${profile_name:-(not set)}"
      echo "  Bio:     ${profile_bio:-(not set)}"
      echo "  Avatar:  ${profile_avatar:-(not set)}"
    else
      echo "  No koad.state-update[scope:profile] entry found in chain."
    fi
  fi
}

# ── Main dispatch ─────────────────────────────────────────────────────────────

if [[ -n "$FILE" ]]; then
  if [[ "$DO_VERIFY" == true ]]; then
    VERIFY_CMD="$(dirname "$(dirname "${BASH_SOURCE[0]}")")/verify/command.sh"
    if [[ -f "$VERIFY_CMD" ]]; then
      ENTITY="$ENTITY" ENTITY_DIR="$ENTITY_DIR" bash "$VERIFY_CMD" --file "$FILE"
      echo ""
    fi
  fi
  display_entry "$FILE"

elif [[ ${#CHAIN_FILES[@]} -gt 0 ]]; then
  if [[ "$DO_VERIFY" == true ]]; then
    VERIFY_CMD="$(dirname "$(dirname "${BASH_SOURCE[0]}")")/verify/command.sh"
    if [[ -f "$VERIFY_CMD" ]]; then
      ENTITY="$ENTITY" ENTITY_DIR="$ENTITY_DIR" bash "$VERIFY_CMD" --chain "${CHAIN_FILES[@]}"
      echo ""
    fi
  fi
  display_chain_profile "${CHAIN_FILES[@]}"

else
  echo "profile view: no --file or --chain specified." >&2
  echo "" >&2
  echo "To view local entry files:" >&2
  echo "  $ENTITY profile view --file genesis.json" >&2
  echo "  $ENTITY profile view --chain profile-state.json genesis.json" >&2
  echo "" >&2
  echo "Note: IPFS fetch by CID from $SIGCHAIN_TIP_FILE is not yet wired." >&2
  if [[ -f "$SIGCHAIN_TIP_FILE" ]]; then
    echo "Tip CID: $(cat "$SIGCHAIN_TIP_FILE")" >&2
  fi
  exit 2
fi
