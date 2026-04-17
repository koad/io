#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# profile verify — verify signatures on a sigchain entry or local chain
#
# Per VESTA-SPEC-111 §3.4 and §6.5.
#
# Two modes:
#   --file FILE      Verify a single local JSON entry file (offline, no IPFS)
#   --chain FILE...  Verify a sequence of JSON files from tip to genesis
#                    (tip first, genesis last — must be ordered)
#
# The full IPFS chain-walk (fetching by CID) is stubbed until the daemon's
# IPFS node is running. Local-file verification works today.
#
# Usage:
#   $ENTITY profile verify --file entry.json [--pubkey-path KEY.pub]
#   $ENTITY profile verify --chain tip.json mid.json genesis.json
#   $ENTITY profile verify                    # verifies own sigchain-tip file entries

set -euo pipefail

ENTITY="${ENTITY:-koad}"
ENTITY_DIR="${ENTITY_DIR:-$HOME/.$ENTITY}"
SIGCHAIN_TIP_FILE="$ENTITY_DIR/var/sigchain-tip"
SIGN_HELPER="$(dirname "$(dirname "${BASH_SOURCE[0]}")")/.helpers/sign.js"

# ── Usage ─────────────────────────────────────────────────────────────────────

usage() {
  cat >&2 <<EOF
profile verify — verify Ed25519 signatures on sigchain entries

Usage:
  $ENTITY profile verify --file ENTRY.json [--pubkey-path KEY.pub]
  $ENTITY profile verify --chain TIP.json [MID.json ...] GENESIS.json
  $ENTITY profile verify --json            output results as JSON

Options:
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

Note: IPFS chain-walk by CID is not yet implemented. Use --file or --chain
with locally exported entry JSON files.

See also:
  $ENTITY profile view     — display resolved profile
  $ENTITY profile create   — create your sigchain
EOF
}

# ── Arg parsing ───────────────────────────────────────────────────────────────

FILE=""
CHAIN_FILES=()
PUBKEY_PATH=""
PUBKEY_B64URL=""
JSON_OUTPUT=false
IN_CHAIN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
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

elif [[ ${#CHAIN_FILES[@]} -gt 0 ]]; then
  # Chain mode: verify each file, use genesis pubkey for all
  # First pass: extract pubkey from genesis entry (last file in the chain)
  GENESIS_FILE="${CHAIN_FILES[-1]}"
  CHAIN_PUBKEY_B64URL=$(node -e "
    const e = JSON.parse(require('fs').readFileSync('${GENESIS_FILE}','utf8'));
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
    echo "profile verify: failed to extract genesis pubkey: $CHAIN_PUBKEY_B64URL" >&2
    exit 1
  fi

  PUBKEY_FIELD="\"pubkeyBase64Url\":\"${CHAIN_PUBKEY_B64URL}\""

  if [[ "$JSON_OUTPUT" == false ]]; then
    echo "Verifying chain of ${#CHAIN_FILES[@]} entries (pubkey from genesis):"
    echo ""
  fi

  for f in "${CHAIN_FILES[@]}"; do
    verify_file "$f" "$PUBKEY_FIELD" || ERRORS=$((ERRORS + 1))
  done

else
  # No args — not yet wired to IPFS fetch
  echo "profile verify: no --file or --chain specified." >&2
  echo "" >&2
  echo "To verify local entry files:" >&2
  echo "  $ENTITY profile verify --file genesis.json" >&2
  echo "  $ENTITY profile verify --chain profile-state.json genesis.json" >&2
  echo "" >&2
  echo "Note: IPFS chain-walk by CID (from $SIGCHAIN_TIP_FILE) is not yet" >&2
  echo "wired — requires running IPFS daemon. Local file verification works today." >&2
  exit 2
fi

echo ""
if [[ $ERRORS -eq 0 ]]; then
  echo "Result: VERIFIED ($((${#CHAIN_FILES[@]} + ${#FILE})) entries)"
  exit 0
else
  echo "Result: FAILED ($ERRORS verification failures)" >&2
  exit 1
fi
