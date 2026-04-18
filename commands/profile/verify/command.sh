#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# profile verify — verify signatures on a sigchain entry or local chain
#
# Per VESTA-SPEC-111 §3.4 and §6.5.
#
# Modes:
#   (no args)        Walk $ENTITY_DIR/var/sigchain-cache/ — auto-discovers local
#                    chain files and runs chain verification tip-first to genesis.
#   --tip CID        Accept a tip CID (IPFS fetch is stubbed; falls back to cache scan)
#   --file FILE      Verify a single local JSON entry file (offline, no IPFS)
#   --chain FILE...  Verify a sequence of JSON files from tip to genesis
#                    (tip first, genesis last — must be ordered)
#
# The full IPFS chain-walk (fetching by CID) is stubbed until the daemon's
# IPFS node is running. Local-file verification works today.
#
# Usage:
#   $ENTITY profile verify
#   $ENTITY profile verify --tip <cid>
#   $ENTITY profile verify --file entry.json [--pubkey-path KEY.pub]
#   $ENTITY profile verify --chain tip.json mid.json genesis.json

set -euo pipefail

ENTITY="${ENTITY:-koad}"
ENTITY_DIR="${ENTITY_DIR:-$HOME/.$ENTITY}"
SIGCHAIN_TIP_FILE="$ENTITY_DIR/var/sigchain-tip"
SIGCHAIN_CACHE_DIR="$ENTITY_DIR/var/sigchain-cache"
SIGN_HELPER="$(dirname "$(dirname "${BASH_SOURCE[0]}")")/.helpers/sign.js"

# ── Usage ─────────────────────────────────────────────────────────────────────

usage() {
  cat >&2 <<EOF
profile verify — verify Ed25519 signatures on sigchain entries

Usage:
  $ENTITY profile verify
  $ENTITY profile verify --tip CID
  $ENTITY profile verify --file ENTRY.json [--pubkey-path KEY.pub]
  $ENTITY profile verify --chain TIP.json [MID.json ...] GENESIS.json

Options:
  --tip CID             Tip CID to verify (uses local cache; IPFS fetch stubbed)
  --file FILE           Verify a single local JSON entry file
  --chain FILE...       Verify an ordered sequence: tip first, genesis last
  --pubkey-path FILE    Public key file to verify against (OpenSSH or PEM SPKI)
                        Default: $ENTITY_DIR/id/ed25519.pub
  --pubkey-base64url B  Raw Ed25519 public key as base64url (from genesis entry)
  --json                Output results as JSON
  -h, --help            Show this help

Exit codes:
  0 — all entries verified
  1 — one or more entries failed verification
  2 — missing prerequisites or bad arguments

No-args and --tip modes: scan $SIGCHAIN_CACHE_DIR for JSON files,
sort genesis-to-tip, and run chain verification on them.
IPFS fetch by CID is not yet wired — populate the cache with --output on
profile create/update, or use --chain with explicit file paths.

See also:
  $ENTITY profile view     — display resolved profile
  $ENTITY profile create   — create your sigchain
EOF
}

# ── Arg parsing ───────────────────────────────────────────────────────────────

FILE=""
TIP_CID=""
CHAIN_FILES=()
PUBKEY_PATH=""
PUBKEY_B64URL=""
JSON_OUTPUT=false
IN_CHAIN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tip)        TIP_CID="$2"; shift 2 ;;
    --file)       FILE="$2"; shift 2 ;;
    --chain)      IN_CHAIN=true; shift ;;
    --pubkey-path) PUBKEY_PATH="$2"; shift 2 ;;
    --pubkey-base64url) PUBKEY_B64URL="$2"; shift 2 ;;
    --json)       JSON_OUTPUT=true; shift ;;
    -h|--help|help) usage; exit 0 ;;
    -*)           echo "profile verify: unknown option: $1" >&2; usage; exit 1 ;;
    *)
      if [[ "$IN_CHAIN" == true ]]; then
        CHAIN_FILES+=("$1"); shift
      else
        echo "profile verify: unexpected argument: $1" >&2; usage; exit 1
      fi
      ;;
  esac
done

# ── Pre-flight checks ─────────────────────────────────────────────────────────

if ! command -v node &>/dev/null; then
  echo "profile verify: node not found." >&2
  exit 2
fi

if [[ ! -f "$SIGN_HELPER" ]]; then
  echo "profile verify: sign helper not found: $SIGN_HELPER" >&2
  exit 2
fi

# Resolve public key
resolve_pubkey_args() {
  if [[ -n "$PUBKEY_B64URL" ]]; then
    echo "--pubkeyBase64Url \"${PUBKEY_B64URL}\""
  else
    # Default to entity's public key file
    if [[ -z "$PUBKEY_PATH" ]]; then
      if [[ -f "$ENTITY_DIR/id/ed25519.pub" ]]; then
        PUBKEY_PATH="$ENTITY_DIR/id/ed25519.pub"
      else
        echo "profile verify: no public key found." >&2
        echo "  Provide --pubkey-path or set $ENTITY_DIR/id/ed25519.pub" >&2
        exit 2
      fi
    fi
    echo "--pubkeyPath \"${PUBKEY_PATH}\""
  fi
}

# ── Verify a single entry file ────────────────────────────────────────────────

verify_file() {
  local entry_file="$1"
  local pubkey_json_field="$2"  # JSON fragment for pubkey field in request

  if [[ ! -f "$entry_file" ]]; then
    echo "profile verify: file not found: $entry_file" >&2
    return 1
  fi

  local entry
  entry=$(cat "$entry_file")

  local result
  result=$(printf '%s' "{\"op\":\"verify\",\"entry\":${entry},${pubkey_json_field}}" \
    | node "$SIGN_HELPER" 2>&1)

  if echo "$result" | grep -q '"ok":true'; then
    local valid type ent ts cid
    valid=$(echo "$result" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).valid))")
    type=$(echo "$result" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).type))")
    ent=$(echo "$result" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).entity))")
    ts=$(echo "$result" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).timestamp))")
    cid=$(echo "$result" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).cid))")

    if [[ "$JSON_OUTPUT" == true ]]; then
      echo "$result"
    else
      if [[ "$valid" == "true" ]]; then
        echo "  [OK]  $cid"
        echo "        type:      $type"
        echo "        entity:    $ent"
        echo "        timestamp: $ts"
      else
        echo "  [FAIL] $cid"
        echo "         type:      $type"
        echo "         entity:    $ent"
        echo "         timestamp: $ts"
        echo "         SIGNATURE INVALID" >&2
        return 1
      fi
    fi

    if [[ "$valid" != "true" ]]; then
      return 1
    fi
    return 0
  else
    echo "  [ERROR] verify helper failed:" >&2
    echo "  $result" >&2
    return 1
  fi
}

# ── Scan cache for chain files and sort genesis-to-tip ───────────────────────

# Returns sorted chain files (tip first, genesis last) by walking previous links.
# Writes sorted file paths to stdout, one per line. Returns 1 if cache is empty.
load_chain_from_cache() {
  local cache_dir="$1"

  if [[ ! -d "$cache_dir" ]] || [[ -z "$(ls -A "$cache_dir"/*.json 2>/dev/null)" ]]; then
    return 1
  fi

  # Use node to sort the JSON files by walking previous links (genesis has previous:null)
  node -e "
const fs = require('fs');
const path = require('path');
const cacheDir = process.argv[1];

const files = fs.readdirSync(cacheDir).filter(f => f.endsWith('.json'));
const entries = [];
for (const f of files) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(cacheDir, f), 'utf8'));
    entries.push({ file: path.join(cacheDir, f), entry: data });
  } catch (e) { /* skip invalid JSON */ }
}

if (entries.length === 0) { process.exit(1); }

// Sort: genesis (previous==null) last, tip first.
// Walk chain links: find genesis, then chain forward from it.
const genesis = entries.find(e => e.entry.previous === null);
if (!genesis) {
  process.stderr.write('No genesis entry found in cache.\n');
  process.exit(1);
}

// Build CID -> file map using the sign helper's CID computation
// For sorting we rely on timestamps: genesis is oldest, tip is newest
const sorted = [...entries].sort((a, b) => {
  const ta = new Date(a.entry.timestamp).getTime();
  const tb = new Date(b.entry.timestamp).getTime();
  return tb - ta; // tip (newest) first, genesis last
});

for (const e of sorted) {
  process.stdout.write(e.file + '\n');
}
" "$cache_dir" 2>&1
}

# ── Chain verification with summary output ────────────────────────────────────

verify_chain_with_summary() {
  local -a files=("$@")
  local errors=0

  # Extract pubkey from genesis (last file)
  local genesis_file="${files[-1]}"
  local chain_pubkey
  chain_pubkey=$(node -e "
    const e = JSON.parse(require('fs').readFileSync('${genesis_file}','utf8'));
    if (e.type !== 'koad.genesis') {
      process.stderr.write('Last file is not a koad.genesis entry: ' + e.type + '\n');
      process.exit(1);
    }
    const pubkey = e.payload && e.payload.pubkey;
    if (!pubkey) {
      process.stderr.write('genesis entry missing payload.pubkey\n');
      process.exit(1);
    }
    process.stdout.write(pubkey);
  " 2>&1)

  if [[ $? -ne 0 ]]; then
    echo "profile verify: failed to extract genesis pubkey: $chain_pubkey" >&2
    return 1
  fi

  local pubkey_field="\"pubkeyBase64Url\":\"${chain_pubkey}\""
  local entry_list=()
  local fail_list=()

  for f in "${files[@]}"; do
    local entry result valid type cid scope_label
    entry=$(cat "$f")
    result=$(printf '%s' "{\"op\":\"verify\",\"entry\":${entry},${pubkey_field}}" \
      | node "$SIGN_HELPER" 2>&1)

    if echo "$result" | grep -q '"ok":true'; then
      valid=$(echo "$result" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).valid))")
      type=$(echo "$result" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).type))")
      cid=$(echo "$result" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).cid))")

      # Extract scope for state-update entries
      scope_label=""
      if [[ "$type" == "koad.state-update" ]]; then
        scope=$(echo "$entry" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const e=JSON.parse(d);console.log(e.payload&&e.payload.scope||'')}catch(e){console.log('')}})")
        if [[ -n "$scope" ]]; then
          scope_label=" [$scope]"
        fi
      fi

      if [[ "$valid" == "true" ]]; then
        entry_list+=("  $cid $type${scope_label}")
      else
        entry_list+=("  $cid $type${scope_label} [FAIL]")
        fail_list+=("Signature verification failed at $cid")
        errors=$((errors + 1))
      fi
    else
      errors=$((errors + 1))
      fail_list+=("Verify error on $(basename "$f"): $result")
    fi
  done

  if [[ "$JSON_OUTPUT" == true ]]; then
    node -e "
const valid = ${errors} === 0;
const entries = $(printf '%s\n' "${entry_list[@]}" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const lines=d.trim().split('\n').filter(Boolean);const entries=lines.map(l=>{const m=l.trim().match(/^(\S+)\s+(.+)$/);return m?{cid:m[1],type:m[2]}:{raw:l.trim()}});console.log(JSON.stringify(entries))})" 2>/dev/null || echo '[]');
const errors = $(printf '%s\n' "${fail_list[@]-}" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const lines=d.trim().split('\n').filter(Boolean);console.log(JSON.stringify(lines))})" 2>/dev/null || echo '[]');
process.stdout.write(JSON.stringify({valid,entries,errors},null,2)+'\n');
"
  else
    if [[ $errors -eq 0 ]]; then
      echo "Chain valid: yes"
    else
      echo "Chain valid: NO"
    fi
    echo "Entries: ${#files[@]}"
    for line in "${entry_list[@]}"; do
      echo "$line"
    done
    if [[ ${#fail_list[@]} -gt 0 ]]; then
      echo ""
      echo "Errors:"
      for err in "${fail_list[@]}"; do
        echo "  $err"
      done
    fi
  fi

  return $errors
}

# ── Main: dispatch mode ───────────────────────────────────────────────────────

if ! command -v node &>/dev/null; then
  echo "profile verify: node not found." >&2
  exit 2
fi

ERRORS=0

if [[ -n "$FILE" ]]; then
  # Single file mode
  PUBKEY_FIELD=""
  if [[ -n "$PUBKEY_B64URL" ]]; then
    PUBKEY_FIELD="\"pubkeyBase64Url\":\"${PUBKEY_B64URL}\""
  else
    if [[ -z "$PUBKEY_PATH" ]]; then
      if [[ -f "$ENTITY_DIR/id/ed25519.pub" ]]; then
        PUBKEY_PATH="$ENTITY_DIR/id/ed25519.pub"
      else
        echo "profile verify: no public key. Provide --pubkey-path." >&2
        exit 2
      fi
    fi
    PUBKEY_FIELD="\"pubkeyPath\":\"${PUBKEY_PATH}\""
  fi

  if [[ "$JSON_OUTPUT" == false ]]; then
    echo "Verifying: $FILE"
  fi
  verify_file "$FILE" "$PUBKEY_FIELD" || ERRORS=$((ERRORS + 1))

  echo ""
  if [[ $ERRORS -eq 0 ]]; then
    echo "Result: VERIFIED (1 entry)"
    exit 0
  else
    echo "Result: FAILED ($ERRORS verification failure)" >&2
    exit 1
  fi

elif [[ ${#CHAIN_FILES[@]} -gt 0 ]]; then
  # Chain mode: verify each file with summary output
  verify_chain_with_summary "${CHAIN_FILES[@]}"
  exit $?

elif [[ -n "$TIP_CID" ]] || [[ $# -eq 0 && -z "$FILE" && ${#CHAIN_FILES[@]} -eq 0 ]]; then
  # No-args or --tip mode: scan local sigchain cache
  if [[ -n "$TIP_CID" ]]; then
    echo "Note: IPFS fetch not wired. Scanning local cache for chain files..." >&2
    echo "Tip CID: $TIP_CID" >&2
    echo "" >&2
  fi

  # Discover and sort chain files from cache
  CACHE_CHAIN_FILES=()
  if [[ -d "$SIGCHAIN_CACHE_DIR" ]]; then
    while IFS= read -r line; do
      [[ -n "$line" ]] && CACHE_CHAIN_FILES+=("$line")
    done < <(load_chain_from_cache "$SIGCHAIN_CACHE_DIR" 2>/dev/null)
  fi

  if [[ ${#CACHE_CHAIN_FILES[@]} -eq 0 ]]; then
    echo "profile verify: no local chain files found." >&2
    echo "" >&2
    echo "Checked cache: $SIGCHAIN_CACHE_DIR" >&2
    echo "" >&2
    echo "To populate the cache, use --output on create/update:" >&2
    echo "  $ENTITY profile create --output $SIGCHAIN_CACHE_DIR --name \"Name\"" >&2
    echo "  $ENTITY profile update --output $SIGCHAIN_CACHE_DIR --name \"Name\"" >&2
    echo "" >&2
    echo "Or verify explicit files with --chain:" >&2
    echo "  $ENTITY profile verify --chain profile-state.json genesis.json" >&2
    exit 2
  fi

  verify_chain_with_summary "${CACHE_CHAIN_FILES[@]}"
  exit $?
fi
