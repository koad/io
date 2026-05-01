#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# koad-io kingdom init <chain-uri> — bootstrap a kingdom garden from a chain URI
#
# Implements VESTA-SPEC-163 v1.1 — Chain-URI Kingdom Bootstrap
# Garden layout per VESTA-SPEC-164 v1.1 — Garden Model
# Kingdom config doc per VESTA-SPEC-115 §13 v1.6
# Taint resolution per ROOTY-SPEC-003 v1.2
#
# Usage:
#   koad-io kingdom init canadaecoin://<address>
#   koad-io kingdom init canadaecoin://<address> --kingdom-id=0x000003E9
#   koad-io kingdom init canadaecoin://<address> --bond=/path/to/bond.md
#   koad-io kingdom init canadaecoin://<address> --stale-threshold=52560
#   koad-io kingdom init canadaecoin://<address> --strict-stale
#   koad-io kingdom init --help
#
# Failure exit codes (distinct per error class):
#   1   — general / usage error
#   2   — CHAIN_UNREACHABLE
#   3   — TAINT_NOT_FOUND
#   4   — TAINT_RETIRED
#   5   — TAINT_STALE (only when --strict-stale or KOAD_IO_STALE_ABORT=true)
#   6   — KINGDOM_AMBIGUOUS
#   7   — KINGDOM_ID_NOT_FOUND
#   8   — IPFS_UNREACHABLE
#   9   — CONFIG_INVALID (signature verification failed)
#   10  — CONFIG_KINGDOM_ID_MISMATCH
#   11  — BOND_INVALID
#   12  — IDENTITY_AMBIGUOUS
#   13  — INSTALL_FAILED
#   14  — MISSING_INSTALL_SCRIPT

set -euo pipefail

# ── Constants ────────────────────────────────────────────────────────────────

KOAD_PREFIX="6b6f6164"       # 4-byte OP_RETURN prefix for taint payloads
DEFAULT_STALE_BLOCKS=105120  # ~1 year at CDN 5-min blocks
IDENTITY_MASTER_STANDARD="${HOME}/.koad/id/master.asc"
TRUST_STORE="${HOME}/.koad/trust/bonds"
IPFS_TIMEOUT=30              # seconds before IPFS fetch gives up
IPFS_GATEWAY="${KOAD_IO_IPFS_GATEWAY:-https://ipfs.io/ipfs}"

# ── Colour helpers ────────────────────────────────────────────────────────────

_tty() { [ -t 1 ] && [ -t 2 ]; }
_bold()  { _tty && printf '\033[1m%s\033[0m' "$*"  || printf '%s' "$*"; }
_dim()   { _tty && printf '\033[2m%s\033[0m' "$*"  || printf '%s' "$*"; }
_green() { _tty && printf '\033[0;32m%s\033[0m' "$*" || printf '%s' "$*"; }
_red()   { _tty && printf '\033[0;31m%s\033[0m' "$*" || printf '%s' "$*"; }
_yellow(){ _tty && printf '\033[0;33m%s\033[0m' "$*" || printf '%s' "$*"; }
_cyan()  { _tty && printf '\033[0;36m%s\033[0m' "$*" || printf '%s' "$*"; }

# ── Usage ────────────────────────────────────────────────────────────────────

usage() {
  cat >&2 <<EOF
$(_bold "koad-io kingdom init") — bootstrap a kingdom garden from a chain URI

$(_bold "USAGE")
  koad-io kingdom init <chain-uri> [flags]

$(_bold "ARGUMENTS")
  <chain-uri>              Chain URI of the kingdom's sovereign address.
                           Currently supported: canadaecoin://<address>

$(_bold "FLAGS")
  --kingdom-id=<hex>       Required when address has taints for multiple kingdoms.
                           Example: --kingdom-id=0x000003E9
  --bond=<path>            Path to a VESTA-SPEC-055 bond document. Triggers bonded track.
  --stale-threshold=<N>    Override the STALE block threshold (default: 105120 ~1yr CDN).
  --strict-stale           Abort if taint is STALE (instead of warn-and-proceed).
  --dry-run                Print what would happen without creating any files.
  --help                   Show this help.

$(_bold "EXAMPLES")
  koad-io kingdom init canadaecoin://CDNxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
  koad-io kingdom init canadaecoin://CDNxxx --kingdom-id=0x000003E9
  koad-io kingdom init canadaecoin://CDNxxx --bond=~/bonds/koad-builder.md.asc

$(_bold "ENVIRONMENT")
  KOAD_IO_STALE_ABORT=true     Same effect as --strict-stale
  KOAD_IO_STALE_THRESHOLD=N    Override default stale threshold
  KOAD_IO_IPFS_GATEWAY=<url>   IPFS gateway base URL (default: https://ipfs.io/ipfs)
  KOAD_IO_QUIET=1              Suppress discovery footer

$(_bold "SPECS")
  VESTA-SPEC-163 v1.1 — Chain-URI Kingdom Bootstrap (implementation contract)
  VESTA-SPEC-164 v1.1 — Garden Model (scaffold structure)
  VESTA-SPEC-115 §13 v1.6 — Kingdom Configuration Document
  ROOTY-SPEC-003 v1.2 — Taint Protocol

EOF
}

# ── Step/status helpers ──────────────────────────────────────────────────────

_step() {
  printf "  $(_dim "→") %s\n" "$*" >&2
}

_ok() {
  printf "  $(_green "✓") %s\n" "$*" >&2
}

_warn() {
  printf "  $(_yellow "⚠") %s\n" "$*" >&2
}

_err() {
  printf "\n$(_red "ERROR:") %s\n" "$*" >&2
}

# ── Argument parsing ─────────────────────────────────────────────────────────

CHAIN_URI=""
KINGDOM_ID_FLAG=""
BOND_PATH=""
STALE_THRESHOLD="${KOAD_IO_STALE_THRESHOLD:-$DEFAULT_STALE_BLOCKS}"
STRICT_STALE="${KOAD_IO_STALE_ABORT:-false}"
DRY_RUN=false

for arg in "$@"; do
  case "$arg" in
    --help|-h|help)
      usage; exit 0 ;;
    --kingdom-id=*)
      KINGDOM_ID_FLAG="${arg#--kingdom-id=}" ;;
    --bond=*)
      BOND_PATH="${arg#--bond=}" ;;
    --stale-threshold=*)
      STALE_THRESHOLD="${arg#--stale-threshold=}" ;;
    --strict-stale)
      STRICT_STALE=true ;;
    --dry-run)
      DRY_RUN=true ;;
    -*)
      echo "$(_red "ERROR:") Unknown flag: $arg" >&2
      echo "Run 'koad-io kingdom init --help' for usage." >&2
      exit 1 ;;
    *)
      if [ -z "$CHAIN_URI" ]; then
        CHAIN_URI="$arg"
      else
        echo "$(_red "ERROR:") Unexpected argument: $arg" >&2
        exit 1
      fi ;;
  esac
done

if [ -z "$CHAIN_URI" ]; then
  usage
  exit 1
fi

# ── Step 1: Parse chain URI (SPEC-163 §3 step 1) ────────────────────────────

_step "Parsing chain URI..."

# Parse URI: scheme://address
URI_SCHEME=""
URI_ADDRESS=""

case "$CHAIN_URI" in
  canadaecoin://*)
    URI_SCHEME="canadaecoin"
    URI_ADDRESS="${CHAIN_URI#canadaecoin://}"
    ;;
  eaglecoin://*)
    URI_SCHEME="eaglecoin"
    URI_ADDRESS="${CHAIN_URI#eaglecoin://}"
    _warn "eaglecoin:// support is v2. Proceeding with CDN resolution logic as fallback."
    ;;
  utxo-kingdom://*)
    _err "utxo-kingdom:// is a v2 URI scheme — not yet supported."
    echo "Use canadaecoin://<address> for CDN-based kingdoms." >&2
    exit 1
    ;;
  *)
    _err "Unrecognised URI scheme in: $CHAIN_URI"
    echo "Supported URI schemes: canadaecoin://" >&2
    echo "Example: koad-io kingdom init canadaecoin://CDNxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" >&2
    exit 1
    ;;
esac

# Validate address looks like a CDN P2PKH address (starts with C, 34 chars)
if [ -z "$URI_ADDRESS" ]; then
  _err "Empty address in URI: $CHAIN_URI"
  exit 1
fi

if ! echo "$URI_ADDRESS" | grep -qE '^[A-Za-z0-9]{25,50}$'; then
  _err "Address does not look like a valid P2PKH address: $URI_ADDRESS"
  echo "Expected base58check format, ~34 characters." >&2
  exit 1
fi

_ok "URI parsed: scheme=$URI_SCHEME address=$URI_ADDRESS"

# ── Step 2: Resolve taint (SPEC-163 §3 step 2 / ROOTY-SPEC-003 §5.1) ────────

_step "Resolving taint at $URI_ADDRESS..."

# The taint resolution requires the ecoincore stack (Node + electrum packages).
# Run via a Node bridge that calls eCoinCore.taint.resolveTaint() if available,
# or falls back to a direct electrum query via electrum-cli.
#
# Output format (JSON on stdout):
# {
#   "status": "CURRENT|STALE|RETIRED|NOT_FOUND",
#   "address": "CDN...",
#   "kingdom_ids": [1001],
#   "kingdom_id": 1001,
#   "sigchain_tip": "sha256hex...",
#   "avatar_cid": "bafybeie...|null",
#   "block_height": 1234567,
#   "taint_age_blocks": 5000,
#   "flags": 0,
#   "error": null
# }

TAINT_RESULT_FILE=$(mktemp /tmp/koad-io-taint-XXXXXX.json)
trap 'rm -f "$TAINT_RESULT_FILE"' EXIT

_resolve_taint() {
  local address="$1"
  local ecoincore_pkg="${HOME}/.ecoincore"

  # Try ecoincore Node bridge first
  if [ -d "$ecoincore_pkg" ] && command -v node >/dev/null 2>&1; then
    node - "$address" "$KINGDOM_ID_FLAG" << 'NODEBRIDGE' 2>/dev/null
const address = process.argv[2];
const kingdomIdFlag = process.argv[3] || "";

// Try to load ecoincore taint module
let resolveTaint;
try {
  // Look for the taint resolution module in ecoincore packages
  const possiblePaths = [
    process.env.HOME + '/.ecoincore/packages/sigchain-discovery/src/taint.js',
    process.env.HOME + '/.ecoincore/packages/taint/src/index.js',
    process.env.HOME + '/.ecoincore/src/taint.js',
  ];
  for (const p of possiblePaths) {
    try {
      const m = require(p);
      resolveTaint = m.resolveTaint || m.default?.resolveTaint;
      if (resolveTaint) break;
    } catch (_) {}
  }
} catch (_) {}

if (!resolveTaint) {
  // Stub: return NOT_FOUND with a clear signal that resolution is unavailable
  process.stdout.write(JSON.stringify({
    status: "RESOLUTION_UNAVAILABLE",
    address: address,
    error: "ecoincore taint module not found — install ecoincore or ensure packages are in place",
    kingdom_ids: [],
    kingdom_id: null,
    sigchain_tip: null,
    avatar_cid: null,
    block_height: null,
    taint_age_blocks: null,
    flags: 0
  }));
  process.exit(0);
}

resolveTaint(address, {
  kingdomIdFilter: kingdomIdFlag || null
}).then(result => {
  process.stdout.write(JSON.stringify(result));
}).catch(err => {
  process.stdout.write(JSON.stringify({
    status: "CHAIN_UNREACHABLE",
    address: address,
    error: err.message || String(err),
    kingdom_ids: [],
    kingdom_id: null,
    sigchain_tip: null,
    avatar_cid: null,
    block_height: null,
    taint_age_blocks: null,
    flags: 0
  }));
});
NODEBRIDGE
  else
    # Fallback: no ecoincore and/or no node available
    echo "{\"status\":\"RESOLUTION_UNAVAILABLE\",\"address\":\"$address\",\"error\":\"Node.js not available — cannot resolve taint without it\",\"kingdom_ids\":[],\"kingdom_id\":null,\"sigchain_tip\":null,\"avatar_cid\":null,\"block_height\":null,\"taint_age_blocks\":null,\"flags\":0}"
  fi
}

_resolve_taint "$URI_ADDRESS" > "$TAINT_RESULT_FILE"

# Parse taint result fields
_taint_field() {
  local field="$1"
  node -e "
    const d = require(process.argv[1]);
    const v = d['$field'];
    if (v === null || v === undefined) process.stdout.write('');
    else if (Array.isArray(v)) process.stdout.write(v.join(','));
    else process.stdout.write(String(v));
  " "$TAINT_RESULT_FILE" 2>/dev/null || echo ""
}

TAINT_STATUS=$(_taint_field "status")
TAINT_ERROR=$(_taint_field "error")
TAINT_KINGDOM_IDS=$(_taint_field "kingdom_ids")
TAINT_KINGDOM_ID=$(_taint_field "kingdom_id")
TAINT_SIGCHAIN_TIP=$(_taint_field "sigchain_tip")
TAINT_AVATAR_CID=$(_taint_field "avatar_cid")
TAINT_BLOCK_HEIGHT=$(_taint_field "block_height")
TAINT_AGE_BLOCKS=$(_taint_field "taint_age_blocks")

# Handle resolution unavailability as a clear operating error
if [ "$TAINT_STATUS" = "RESOLUTION_UNAVAILABLE" ]; then
  _err "Taint resolution unavailable"
  echo "" >&2
  echo "  The ecoincore stack is required to resolve chain URI taints." >&2
  echo "  Error: $TAINT_ERROR" >&2
  echo "" >&2
  echo "  Ensure ecoincore is installed at ${HOME}/.ecoincore and Node.js is available." >&2
  echo "  See ~/.ecoincore/README.md or rooty.cc for setup instructions." >&2
  exit 2  # CHAIN_UNREACHABLE (best approximation when stack is absent)
fi

# ── Step 2 result handling ────────────────────────────────────────────────────

case "$TAINT_STATUS" in
  CHAIN_UNREACHABLE)
    _err "Cannot connect to CDN Electrum server (CHAIN_UNREACHABLE)"
    echo "" >&2
    echo "  Error: $TAINT_ERROR" >&2
    echo "" >&2
    echo "  Check CDN Electrum server connectivity." >&2
    echo "  Chainpack: ${HOME}/.ecoincore/blockchains/CDN-*/chainpack.json" >&2
    exit 2
    ;;

  NOT_FOUND)
    _err "No kingdom taint found (TAINT_NOT_FOUND)"
    echo "" >&2
    echo "  Address:  $URI_ADDRESS" >&2
    echo "  No 'koad' prefix taint found at this address." >&2
    echo "" >&2
    echo "  This address has not published a kingdom identity payload." >&2
    echo "  Verify the address or check that you are connected to a CDN Electrum server." >&2
    exit 3
    ;;

  RETIRED)
    _err "Kingdom taint is RETIRED (TAINT_RETIRED)"
    echo "" >&2
    echo "  Address:  $URI_ADDRESS" >&2
    echo "  The kingdom operator has rotated keys." >&2
    echo "" >&2
    if [ -n "$TAINT_SIGCHAIN_TIP" ]; then
      echo "  A sigchain tip was present before retirement: $TAINT_SIGCHAIN_TIP" >&2
      echo "  Traverse the sigchain to find the operator's current tainted address:" >&2
      echo "    koad-io kingdom init canadaecoin://<new-address>" >&2
    else
      echo "  No forwarding sigchain tip available." >&2
      echo "  Contact the kingdom operator directly for the new address." >&2
    fi
    exit 4
    ;;

  STALE)
    # Per SPEC-163 §5.2: warn-and-proceed by default; abort if --strict-stale or KOAD_IO_STALE_ABORT=true
    echo "" >&2
    echo "$(_yellow "WARNING: Kingdom taint is STALE")" >&2
    echo "  Address:    $URI_ADDRESS" >&2
    if [ -n "$TAINT_BLOCK_HEIGHT" ] && [ -n "$TAINT_AGE_BLOCKS" ]; then
      echo "  Last seen:  block $TAINT_BLOCK_HEIGHT (~$TAINT_AGE_BLOCKS blocks ago)" >&2
    fi
    echo "  Threshold:  $STALE_THRESHOLD blocks (~1 year CDN)" >&2
    echo "" >&2
    echo "  This means the kingdom operator has not refreshed their on-chain identity" >&2
    echo "  recently. The kingdom configuration may be outdated." >&2
    echo "" >&2

    if [ "$STRICT_STALE" = "true" ] || [ "${KOAD_IO_STALE_ABORT:-false}" = "true" ]; then
      _err "Aborting due to STALE taint (--strict-stale / KOAD_IO_STALE_ABORT=true)"
      echo "  To proceed anyway, remove --strict-stale or unset KOAD_IO_STALE_ABORT." >&2
      echo "  To override the threshold: --stale-threshold=0" >&2
      exit 5
    fi

    echo "  Proceeding with bootstrap. Press Ctrl+C to abort." >&2
    echo "  To proceed silently in future: KOAD_IO_STALE_PROCEED=true" >&2
    echo "" >&2
    # Brief pause so operator can read and abort if needed
    sleep 2
    ;;

  CURRENT)
    _ok "Taint resolved: CURRENT"
    ;;

  *)
    _err "Unexpected taint status: $TAINT_STATUS"
    exit 2
    ;;
esac

# ── Step 3: Extract bootstrap manifest fields ─────────────────────────────────

_step "Extracting bootstrap manifest fields..."

if [ -z "$TAINT_SIGCHAIN_TIP" ]; then
  _err "Taint payload is missing sigchain_tip field."
  echo "  The kingdom has not published a valid identity taint with a sigchain tip." >&2
  echo "  Contact the kingdom operator." >&2
  exit 3
fi

_ok "sigchain_tip: $TAINT_SIGCHAIN_TIP"
[ -n "$TAINT_AVATAR_CID" ] && _ok "avatar_cid: $TAINT_AVATAR_CID"

# ── Step 4: Multi-kingdom disambiguation (SPEC-163 §6) ───────────────────────

_step "Determining kingdom ID..."

# Count distinct kingdom_ids
KINGDOM_ID_COUNT=0
if [ -n "$TAINT_KINGDOM_IDS" ]; then
  KINGDOM_ID_COUNT=$(echo "$TAINT_KINGDOM_IDS" | tr ',' '\n' | grep -c '.' || echo 0)
fi

if [ "$KINGDOM_ID_COUNT" -gt 1 ] && [ -z "$KINGDOM_ID_FLAG" ]; then
  _err "Multiple kingdom IDs found at this address (KINGDOM_AMBIGUOUS)"
  echo "" >&2
  echo "  Address: $URI_ADDRESS" >&2
  echo "" >&2
  echo "  This address has published taints for multiple kingdoms over time:" >&2
  echo "$TAINT_KINGDOM_IDS" | tr ',' '\n' | while read -r kid; do
    printf "    %-12s (kingdom_id: %s)\n" "0x$(printf '%08X' "$kid")" "$kid" >&2
  done
  echo "" >&2
  echo "  Disambiguate with:" >&2
  echo "    koad-io kingdom init $CHAIN_URI --kingdom-id=0x$(printf '%08X' "$(echo "$TAINT_KINGDOM_IDS" | cut -d',' -f1)")" >&2
  exit 6
fi

# Use explicit flag, or the resolved single kingdom_id from taint
KINGDOM_ID=""
if [ -n "$KINGDOM_ID_FLAG" ]; then
  # Convert hex flag to decimal for comparison
  KINGDOM_ID=$(node -e "process.stdout.write(String(parseInt('$KINGDOM_ID_FLAG', 16)))" 2>/dev/null || echo "")
  if [ -z "$KINGDOM_ID" ] || [ "$KINGDOM_ID" = "NaN" ]; then
    _err "Invalid --kingdom-id value: $KINGDOM_ID_FLAG"
    echo "  Expected 4-byte hex, e.g. 0x000003E9" >&2
    exit 1
  fi
  # Verify the requested kingdom_id is in the taint
  if [ -n "$TAINT_KINGDOM_IDS" ]; then
    if ! echo "$TAINT_KINGDOM_IDS" | tr ',' '\n' | grep -qx "$KINGDOM_ID"; then
      _err "Requested --kingdom-id=$KINGDOM_ID_FLAG not found at this address (KINGDOM_ID_NOT_FOUND)"
      echo "" >&2
      echo "  Available kingdom IDs at $URI_ADDRESS:" >&2
      echo "$TAINT_KINGDOM_IDS" | tr ',' '\n' | while read -r kid; do
        printf "    0x%08X (%s)\n" "$kid" "$kid" >&2
      done
      exit 7
    fi
  fi
else
  KINGDOM_ID="${TAINT_KINGDOM_ID}"
fi

if [ -z "$KINGDOM_ID" ]; then
  _err "Could not determine kingdom ID from taint payload."
  echo "  The taint may not include a kingdom_id field. Contact the kingdom operator." >&2
  exit 3
fi

_ok "kingdom_id: $KINGDOM_ID (0x$(printf '%08X' "$KINGDOM_ID"))"

# ── Step 5: Fetch sigchain tip entry from IPFS (SPEC-163 §3 step 5) ──────────

_step "Fetching sigchain tip from IPFS ($TAINT_SIGCHAIN_TIP)..."

SIGCHAIN_TIP_FILE=$(mktemp /tmp/koad-io-sigchain-XXXXXX.json)
trap 'rm -f "$TAINT_RESULT_FILE" "$SIGCHAIN_TIP_FILE"' EXIT

_ipfs_fetch() {
  local cid="$1"
  local outfile="$2"

  # Try ipfs CLI first
  if command -v ipfs >/dev/null 2>&1; then
    if timeout "$IPFS_TIMEOUT" ipfs cat "$cid" > "$outfile" 2>/dev/null; then
      return 0
    fi
  fi

  # Fallback: curl IPFS gateway
  if command -v curl >/dev/null 2>&1; then
    local gateway_url="$IPFS_GATEWAY/$cid"
    if curl --silent --fail --max-time "$IPFS_TIMEOUT" "$gateway_url" -o "$outfile" 2>/dev/null; then
      return 0
    fi
  fi

  return 1
}

if ! _ipfs_fetch "$TAINT_SIGCHAIN_TIP" "$SIGCHAIN_TIP_FILE"; then
  _err "Kingdom configuration unavailable (IPFS_UNREACHABLE)"
  echo "" >&2
  echo "  IPFS CID:  $TAINT_SIGCHAIN_TIP" >&2
  echo "  Error:     Fetch timeout or 404" >&2
  echo "" >&2
  echo "  The kingdom's sigchain tip is not reachable via IPFS." >&2
  echo "  The kingdom may be temporarily offline or the CID may not be pinned." >&2
  echo "" >&2
  echo "  Try again later or contact the kingdom operator." >&2
  echo "  IPFS gateway: $IPFS_GATEWAY" >&2
  echo "  Override: KOAD_IO_IPFS_GATEWAY=<url>" >&2
  exit 8
fi

_ok "Sigchain tip fetched."

# Validate it looks like a VESTA-SPEC-111 entry
SIGCHAIN_TYPE=$(node -e "
  try {
    const d = JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'));
    process.stdout.write(d.type || d.entry_type || '');
  } catch(e) { process.stdout.write(''); }
" "$SIGCHAIN_TIP_FILE" 2>/dev/null || echo "")

if [ -z "$SIGCHAIN_TYPE" ]; then
  _warn "Could not verify sigchain entry type — proceeding (entry may use legacy format)."
fi

# ── Step 6: Resolve kingdom_config_cid from sigchain entry (SPEC-163 §3 step 6) ──

_step "Extracting kingdom_config_cid from sigchain entry..."

KINGDOM_CONFIG_CID=$(node -e "
  try {
    const raw = require('fs').readFileSync(process.argv[1], 'utf8');
    const d = JSON.parse(raw);
    // SPEC-115 §13.3: kingdom_config_cid is in the genesis entry payload or payload.data
    const cid = d.payload?.kingdom_config_cid
      || d.data?.kingdom_config_cid
      || d.kingdom_config_cid
      || '';
    process.stdout.write(cid);
  } catch(e) { process.stdout.write(''); }
" "$SIGCHAIN_TIP_FILE" 2>/dev/null || echo "")

if [ -z "$KINGDOM_CONFIG_CID" ]; then
  _err "No kingdom_config_cid found in sigchain entry (CONFIG_INVALID)"
  echo "" >&2
  echo "  The sigchain entry at $TAINT_SIGCHAIN_TIP does not contain a kingdom_config_cid." >&2
  echo "  This kingdom may not support chain-URI bootstrap (VESTA-SPEC-163)." >&2
  echo "  Contact the kingdom operator." >&2
  exit 9
fi

_ok "kingdom_config_cid: $KINGDOM_CONFIG_CID"

# ── Step 7: Fetch and validate kingdom configuration (SPEC-163 §3 step 7) ────

_step "Fetching kingdom configuration ($KINGDOM_CONFIG_CID)..."

KINGDOM_CONFIG_FILE=$(mktemp /tmp/koad-io-config-XXXXXX.json)
trap 'rm -f "$TAINT_RESULT_FILE" "$SIGCHAIN_TIP_FILE" "$KINGDOM_CONFIG_FILE"' EXIT

if ! _ipfs_fetch "$KINGDOM_CONFIG_CID" "$KINGDOM_CONFIG_FILE"; then
  _err "Kingdom configuration unavailable (IPFS_UNREACHABLE)"
  echo "" >&2
  echo "  IPFS CID:  $KINGDOM_CONFIG_CID" >&2
  echo "  Error:     Fetch timeout or 404" >&2
  echo "" >&2
  echo "  The kingdom's configuration document is not reachable via IPFS." >&2
  echo "  Try again later or contact the kingdom operator." >&2
  exit 8
fi

# Extract required fields
CONFIG_VERSION=$(node -e "
  try { const d=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); process.stdout.write(String(d.version||'')); } catch(e){}
" "$KINGDOM_CONFIG_FILE" 2>/dev/null || echo "")

CONFIG_HANDLE=$(node -e "
  try { const d=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); process.stdout.write(d.handle||''); } catch(e){}
" "$KINGDOM_CONFIG_FILE" 2>/dev/null || echo "")

CONFIG_KINGDOM_ID=$(node -e "
  try { const d=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); process.stdout.write(String(d.kingdom_id||'')); } catch(e){}
" "$KINGDOM_CONFIG_FILE" 2>/dev/null || echo "")

CONFIG_NAME=$(node -e "
  try { const d=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); process.stdout.write(d.name||''); } catch(e){}
" "$KINGDOM_CONFIG_FILE" 2>/dev/null || echo "")

CONFIG_MCP_ENDPOINT=$(node -e "
  try { const d=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); process.stdout.write(d.mcp_endpoint||''); } catch(e){}
" "$KINGDOM_CONFIG_FILE" 2>/dev/null || echo "")

CONFIG_BOOTSTRAP_SCRIPTS_CID=$(node -e "
  try { const d=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); process.stdout.write(d.bootstrap_scripts_cid||''); } catch(e){}
" "$KINGDOM_CONFIG_FILE" 2>/dev/null || echo "")

CONFIG_SIGNED_BY=$(node -e "
  try { const d=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); process.stdout.write(d.signed_by||''); } catch(e){}
" "$KINGDOM_CONFIG_FILE" 2>/dev/null || echo "")

# Validate required fields present
if [ -z "$CONFIG_HANDLE" ] || [ -z "$CONFIG_KINGDOM_ID" ] || [ -z "$CONFIG_NAME" ]; then
  _err "Kingdom configuration document is missing required fields (CONFIG_INVALID)"
  echo "" >&2
  echo "  Required fields: handle, kingdom_id, name" >&2
  echo "  Got: handle='$CONFIG_HANDLE' kingdom_id='$CONFIG_KINGDOM_ID' name='$CONFIG_NAME'" >&2
  echo "" >&2
  echo "  The configuration document may be malformed. Contact the kingdom operator." >&2
  exit 9
fi

# SPEC-115 §13.4: Validate kingdom_id matches taint
if [ "$CONFIG_KINGDOM_ID" != "$KINGDOM_ID" ]; then
  _err "Kingdom configuration kingdom_id mismatch (CONFIG_KINGDOM_ID_MISMATCH)"
  echo "" >&2
  echo "  Taint kingdom_id:  $KINGDOM_ID" >&2
  echo "  Config kingdom_id: $CONFIG_KINGDOM_ID" >&2
  echo "" >&2
  echo "  The kingdom configuration document's kingdom_id does not match the taint." >&2
  echo "  This may indicate a misconfigured or corrupted kingdom. Contact the operator." >&2
  exit 10
fi

# SPEC-115 §13.4: Verify signature (if signed_by present)
if [ -n "$CONFIG_SIGNED_BY" ]; then
  _step "Verifying configuration document signature..."
  # Signature verification requires the sovereign pubkey from the sigchain genesis entry.
  # We attempt verification via Node; if the crypto module is unavailable, we warn but proceed.
  SIG_VALID=$(node -e "
    const fs = require('fs');
    const path = process.argv[1];
    const sig = '$CONFIG_SIGNED_BY';
    try {
      // Load sovereign pubkey from sigchain entry
      const sigchain = JSON.parse(fs.readFileSync('$SIGCHAIN_TIP_FILE', 'utf8'));
      const pubkeyB64 = sigchain.payload?.sovereign_pubkey
        || sigchain.data?.sovereign_pubkey
        || sigchain.sovereign_pubkey;
      if (!pubkeyB64) {
        process.stdout.write('NO_PUBKEY');
        process.exit(0);
      }
      // Build canonical JSON for verification (all fields except signed_by, sorted)
      const doc = JSON.parse(fs.readFileSync(path, 'utf8'));
      const { signed_by, ...rest } = doc;
      const canonical = JSON.stringify(
        Object.keys(rest).sort().reduce((a, k) => { a[k] = rest[k]; return a; }, {}),
        null, 0
      );
      const crypto = require('crypto');
      const pubKey = Buffer.from(pubkeyB64, 'base64url');
      const sigBuf = Buffer.from(sig, 'base64url');
      // Node's crypto.verify for Ed25519
      const result = crypto.verify(null, Buffer.from(canonical), { key: pubKey, format: 'raw', type: 'public', dsaEncoding: 'ieee-p1363', namedCurve: 'ed25519' }, sigBuf);
      process.stdout.write(result ? 'VALID' : 'INVALID');
    } catch(e) {
      process.stdout.write('VERIFY_ERROR:' + e.message);
    }
  " "$KINGDOM_CONFIG_FILE" 2>/dev/null || echo "VERIFY_ERROR:node_unavailable")

  case "$SIG_VALID" in
    VALID)
      _ok "Configuration document signature verified." ;;
    NO_PUBKEY)
      _warn "Sovereign pubkey not found in sigchain — skipping signature verification." ;;
    VERIFY_ERROR:*)
      _warn "Signature verification error: ${SIG_VALID#VERIFY_ERROR:} — proceeding without verification." ;;
    INVALID)
      _err "Kingdom configuration document signature is INVALID (CONFIG_INVALID)"
      echo "" >&2
      echo "  The configuration document at $KINGDOM_CONFIG_CID has an invalid signature." >&2
      echo "  This may indicate a tampered or corrupted configuration." >&2
      echo "  Do not proceed. Contact the kingdom operator." >&2
      exit 9
      ;;
  esac
else
  _warn "Configuration document has no signed_by field — proceeding without signature verification."
fi

_ok "Kingdom: '$CONFIG_NAME' (handle: $CONFIG_HANDLE, id: $CONFIG_KINGDOM_ID)"

# ── Step 8: Determine bootstrap track (SPEC-163 §4) ──────────────────────────

_step "Determining bootstrap track..."

GARDEN_PATH="${HOME}/.${CONFIG_HANDLE}"
BOOTSTRAP_TRACK="ANONYMOUS"

# Check for existing bond in trust store
BOND_FROM_STORE=""
if [ -d "$TRUST_STORE" ]; then
  for bond_file in "$TRUST_STORE"/*.md "$TRUST_STORE"/*.md.asc "$TRUST_STORE"/*.asc; do
    [ -f "$bond_file" ] || continue
    # Check if bond references our kingdom_id
    if grep -q "kingdom_id.*$KINGDOM_ID\|kingdom_id: $KINGDOM_ID" "$bond_file" 2>/dev/null; then
      BOND_FROM_STORE="$bond_file"
      break
    fi
  done
fi

# --bond flag overrides store lookup
if [ -n "$BOND_PATH" ]; then
  if [ ! -f "$BOND_PATH" ]; then
    _err "Bond file not found: $BOND_PATH"
    exit 11
  fi
  BOND_FROM_STORE="$BOND_PATH"
fi

# Check for existing SPEC-149 identity
EXISTING_IDENTITY=false
if [ -f "$IDENTITY_MASTER_STANDARD" ]; then
  EXISTING_IDENTITY=true
  _ok "Existing SPEC-149 identity detected at $IDENTITY_MASTER_STANDARD"
fi

# Determine track
if [ -n "$BOND_FROM_STORE" ]; then
  BOOTSTRAP_TRACK="BONDED"
  # Detect if this is a returning identity on a new device
  if [ "$EXISTING_IDENTITY" = "true" ] && [ -d "$GARDEN_PATH" ]; then
    # Garden already exists — this is a new device scenario
    BOOTSTRAP_TRACK="RETURNING_IDENTITY"
  fi
fi

_ok "Bootstrap track: $BOOTSTRAP_TRACK"

# Emit dry-run summary if requested
if [ "$DRY_RUN" = "true" ]; then
  echo "" >&2
  echo "$(_bold "DRY RUN — no files will be created")" >&2
  echo "" >&2
  echo "  Would scaffold garden at: $GARDEN_PATH" >&2
  echo "  Kingdom: $CONFIG_NAME ($CONFIG_HANDLE)" >&2
  echo "  Kingdom ID: $KINGDOM_ID" >&2
  echo "  Bootstrap track: $BOOTSTRAP_TRACK" >&2
  echo "  Chain address: $URI_ADDRESS" >&2
  [ -n "$CONFIG_MCP_ENDPOINT" ] && echo "  MCP endpoint: $CONFIG_MCP_ENDPOINT" >&2
  [ -n "$BOND_FROM_STORE" ] && echo "  Bond: $BOND_FROM_STORE" >&2
  echo "" >&2
  echo "$(_green "Dry run complete. No files created.")" >&2
  exit 0
fi

# ── Step 9: Generate or load operator identity (SPEC-163 §4.4) ───────────────

_step "Checking operator identity..."

ENTITY_HANDLE=""

# Load existing identity handle if available
if [ -f "${HOME}/.koad-io/.env" ]; then
  ENTITY_HANDLE=$(grep -oE '^KOAD_IO_ENTITY=[^[:space:]]*' "${HOME}/.koad-io/.env" 2>/dev/null | cut -d= -f2 || echo "")
fi
if [ -z "$ENTITY_HANDLE" ] && [ -n "${ENTITY:-}" ]; then
  ENTITY_HANDLE="$ENTITY"
fi

if [ "$BOOTSTRAP_TRACK" = "ANONYMOUS" ]; then
  if [ "$EXISTING_IDENTITY" = "false" ] && [ -z "$ENTITY_HANDLE" ]; then
    # Anonymous track with no local identity — prompt operator
    echo "" >&2
    _warn "No local identity found."
    echo "" >&2
    echo "  The anonymous bootstrap track does not create an identity." >&2
    echo "  For a richer experience, create an identity first:" >&2
    echo "    koad-io identity init" >&2
    echo "" >&2
    echo "  Proceeding with anonymous garden (no identity linked)." >&2
  else
    _ok "Proceeding with anonymous track (identity: ${ENTITY_HANDLE:-none})"
  fi
elif [ "$BOOTSTRAP_TRACK" = "RETURNING_IDENTITY" ]; then
  _ok "Returning identity — will derive new device leaf from existing master key."
elif [ "$BOOTSTRAP_TRACK" = "BONDED" ]; then
  if [ "$EXISTING_IDENTITY" = "false" ]; then
    _warn "No existing SPEC-149 master key found at $IDENTITY_MASTER_STANDARD"
    echo "  A new master+leaf identity will be generated." >&2
    echo "  Store the master key backup securely after bootstrap completes." >&2
  else
    _ok "Existing identity found — will derive new device leaf."
  fi
fi

# ── Step 10: Scaffold garden (SPEC-163 §3 step 10 / VESTA-SPEC-164) ──────────

_step "Scaffolding garden at $GARDEN_PATH..."

if [ -d "$GARDEN_PATH" ] && [ "$BOOTSTRAP_TRACK" != "RETURNING_IDENTITY" ]; then
  _warn "Garden directory already exists at $GARDEN_PATH"
  echo "  Existing garden will be extended, not overwritten." >&2
fi

mkdir -p "$GARDEN_PATH"

# Base structure: always created
mkdir -p "$GARDEN_PATH/signals"

if [ "$BOOTSTRAP_TRACK" = "ANONYMOUS" ]; then
  # SPEC-164 §3.3 — Tier 0 structure
  mkdir -p "$GARDEN_PATH/taint"
  mkdir -p "$GARDEN_PATH/stake"

  cat > "$GARDEN_PATH/.env" << ENVEOF
# Garden — ${CONFIG_NAME} (${CONFIG_HANDLE})
# Bootstrap: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
# Track: ANONYMOUS (Tier 0)
# Spec: VESTA-SPEC-163 v1.1 / VESTA-SPEC-164 v1.1

KOAD_IO_KINGDOM_ID=${KINGDOM_ID}
KOAD_IO_KINGDOM_HANDLE=${CONFIG_HANDLE}
KOAD_IO_GARDEN_TIER=0
KOAD_IO_CHAIN_ADDRESS=${URI_ADDRESS}
ENVEOF

  if [ -n "$ENTITY_HANDLE" ]; then
    echo "KOAD_IO_ENTITY_HANDLE=${ENTITY_HANDLE}" >> "$GARDEN_PATH/.env"
  fi

  cat > "$GARDEN_PATH/README.md" << READMEEOF
# Garden: ${CONFIG_NAME}

This is an anonymous explorer garden for the **${CONFIG_NAME}** kingdom.

- **Kingdom ID:** ${KINGDOM_ID}
- **Kingdom Handle:** ${CONFIG_HANDLE}
- **Chain Address:** ${URI_ADDRESS}
- **Bootstrap Date:** $(date -u +"%Y-%m-%d")
- **Tier:** 0 — Anonymous Explorer

## What This Garden Confers

- Publish taints on-chain (ROOTY-SPEC-003)
- Submit timelock stakes (ROOTY-SPEC-004)
- Cast chain-layer votes (ROOTY-SPEC-005)

## Upgrading to Bonded Insider (Tier 1)

Obtain a VESTA-SPEC-055 bond from the kingdom operator and re-run:

    koad-io kingdom init ${CHAIN_URI} --bond=/path/to/bond.md.asc

## Spec References

- VESTA-SPEC-163 v1.1 — Chain-URI Kingdom Bootstrap
- VESTA-SPEC-164 v1.1 — Garden Model
READMEEOF

else
  # SPEC-164 §4 — Tier 1 / bonded structure
  mkdir -p "$GARDEN_PATH/trust/bonds"
  mkdir -p "$GARDEN_PATH/keys"
  mkdir -p "$GARDEN_PATH/channels"
  mkdir -p "$GARDEN_PATH/inbox"
  mkdir -p "$GARDEN_PATH/control"

  # Copy bond document if provided
  BOND_TYPES=""
  if [ -n "$BOND_FROM_STORE" ]; then
    BOND_FILENAME=$(basename "$BOND_FROM_STORE")
    cp "$BOND_FROM_STORE" "$GARDEN_PATH/trust/bonds/$BOND_FILENAME"
    _ok "Bond document written to trust/bonds/$BOND_FILENAME"

    # Extract bond types from document
    BOND_TYPES=$(grep -oE 'type:\s+[a-z][a-z0-9-]+' "$BOND_FROM_STORE" 2>/dev/null | cut -d: -f2 | tr -d ' ' | tr '\n' ',' | sed 's/,$//' || echo "")
    if [ -z "$BOND_TYPES" ]; then
      BOND_TYPES=$(grep -oE 'bond_type:\s+[a-z][a-z0-9-]+' "$BOND_FROM_STORE" 2>/dev/null | cut -d: -f2 | tr -d ' ' | tr '\n' ',' | sed 's/,$//' || echo "")
    fi
  fi

  # Bond-type-specific directories per SPEC-164 §4.5
  if echo "$BOND_TYPES" | grep -q "authorized-builder"; then
    mkdir -p "$GARDEN_PATH/workspace"
  fi
  if echo "$BOND_TYPES" | grep -q "authorized-specialist"; then
    mkdir -p "$GARDEN_PATH/consulting"
  fi
  if echo "$BOND_TYPES" | grep -q "peer"; then
    mkdir -p "$GARDEN_PATH/shared"
  fi
  if echo "$BOND_TYPES" | grep -q "member"; then
    mkdir -p "$GARDEN_PATH/stake"
  fi
  if echo "$BOND_TYPES" | grep -q "employee"; then
    mkdir -p "$GARDEN_PATH/tasks"
  fi

  # Generate device key (SPEC-163 §4.4)
  # Delegates to koad-io identity subsystem — no ssh-keygen stubs here.
  # Branch A (new identity): full identity init (master+leaf+genesis sigchain entry).
  # Branch B (RETURNING_IDENTITY): device-key add only (extends existing sigchain).
  #
  # After either branch the garden always gets the device leaf written to keys/.
  DEVICE_KEY_PATH="$GARDEN_PATH/keys/device.private.asc"
  if [ ! -f "$DEVICE_KEY_PATH" ]; then
    if [ "$BOOTSTRAP_TRACK" = "RETURNING_IDENTITY" ] || [ "$EXISTING_IDENTITY" = "true" ]; then
      # Branch B — existing identity on disk, derive a new device leaf only
      _step "Existing identity found; deriving device key for this kingdom..."
      IDENTITY_CMD="$HOME/.koad-io/commands/identity/device-key/add/command.sh"
      if [ ! -x "$IDENTITY_CMD" ]; then
        _err "koad-io identity device-key add not found at $IDENTITY_CMD"
        echo "  Ensure the koad-io identity package is installed." >&2
        exit 13
      fi
      DEVICE_KEY_ADD_ARGS=(
        "--entity=${ENTITY_HANDLE:-operator}"
        "--device-name=${CONFIG_HANDLE}"
        "--no-confirm"
      )
      if bash "$IDENTITY_CMD" "${DEVICE_KEY_ADD_ARGS[@]}"; then
        # Copy the generated leaf into the garden's keys/ directory
        ENTITY_ID_DIR="$HOME/.${ENTITY_HANDLE:-operator}/id"
        if [ -f "$ENTITY_ID_DIR/leaf.private.asc" ]; then
          cp "$ENTITY_ID_DIR/leaf.private.asc" "$DEVICE_KEY_PATH"
          [ -f "$ENTITY_ID_DIR/device.key" ] && cp "$ENTITY_ID_DIR/device.key" "$GARDEN_PATH/keys/device.key"
          chmod 600 "$DEVICE_KEY_PATH"
          _ok "Device leaf derived and written: keys/device.private.asc"
          _ok "Next step: koad-io identity submit --entity=${ENTITY_HANDLE:-operator} to publish the new leaf"
        else
          _warn "device-key add succeeded but leaf.private.asc not found at $ENTITY_ID_DIR/ — check identity dir"
        fi
      else
        _err "koad-io identity device-key add failed (exit $?)"
        echo "  Try manually: koad-io identity device-key add --entity=${ENTITY_HANDLE:-operator} --device-name=${CONFIG_HANDLE} --mnemonic=<phrase>" >&2
        exit 13
      fi
    else
      # Branch A — no identity on disk, generate full SPEC-149 master+leaf
      _step "Generating fresh SPEC-149 identity (master+leaf) for this operator..."
      IDENTITY_CMD="$HOME/.koad-io/commands/identity/init/command.sh"
      if [ ! -x "$IDENTITY_CMD" ]; then
        _err "koad-io identity init not found at $IDENTITY_CMD"
        echo "  Ensure the koad-io identity package is installed." >&2
        exit 13
      fi
      IDENTITY_INIT_ARGS=(
        "--entity=${ENTITY_HANDLE:-operator}"
        "--no-confirm"
      )
      if bash "$IDENTITY_CMD" "${IDENTITY_INIT_ARGS[@]}"; then
        ENTITY_ID_DIR="$HOME/.${ENTITY_HANDLE:-operator}/id"
        if [ -f "$ENTITY_ID_DIR/leaf.private.asc" ]; then
          cp "$ENTITY_ID_DIR/leaf.private.asc" "$DEVICE_KEY_PATH"
          [ -f "$ENTITY_ID_DIR/device.key" ] && cp "$ENTITY_ID_DIR/device.key" "$GARDEN_PATH/keys/device.key"
          chmod 600 "$DEVICE_KEY_PATH"
          _ok "Identity generated and device leaf written: keys/device.private.asc"
          _ok "Next step: koad-io identity submit --entity=${ENTITY_HANDLE:-operator} --mnemonic=<phrase>"
        else
          _warn "identity init succeeded but leaf.private.asc not found at $ENTITY_ID_DIR/ — check identity dir"
        fi
      else
        _err "koad-io identity init failed (exit $?)"
        echo "  Try manually: koad-io identity init --entity=${ENTITY_HANDLE:-operator}" >&2
        exit 13
      fi
    fi
  else
    _ok "Existing device key found at keys/device.private.asc — preserved."
  fi

  cat > "$GARDEN_PATH/.env" << ENVEOF
# Garden — ${CONFIG_NAME} (${CONFIG_HANDLE})
# Bootstrap: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
# Track: ${BOOTSTRAP_TRACK} (Tier 1)
# Spec: VESTA-SPEC-163 v1.1 / VESTA-SPEC-164 v1.1

KOAD_IO_KINGDOM_ID=${KINGDOM_ID}
KOAD_IO_KINGDOM_HANDLE=${CONFIG_HANDLE}
KOAD_IO_GARDEN_TIER=1
KOAD_IO_BOND_TYPES=${BOND_TYPES}
KOAD_IO_CHAIN_ADDRESS=${URI_ADDRESS}
KOAD_IO_DEVICE_KEY_PATH=keys/device.private.asc
ENVEOF

  [ -n "$CONFIG_MCP_ENDPOINT" ] && echo "KOAD_IO_MCP_ENDPOINT=${CONFIG_MCP_ENDPOINT}" >> "$GARDEN_PATH/.env"
  [ -n "$ENTITY_HANDLE" ] && echo "KOAD_IO_ENTITY_HANDLE=${ENTITY_HANDLE}" >> "$GARDEN_PATH/.env"

  cat > "$GARDEN_PATH/README.md" << READMEEOF
# Garden: ${CONFIG_NAME}

This is a bonded insider garden for the **${CONFIG_NAME}** kingdom.

- **Kingdom ID:** ${KINGDOM_ID}
- **Kingdom Handle:** ${CONFIG_HANDLE}
- **Bootstrap Track:** ${BOOTSTRAP_TRACK}
- **Bond Types:** ${BOND_TYPES:-unknown}
- **Bootstrap Date:** $(date -u +"%Y-%m-%d")
- **Tier:** 1 — Bonded Insider

## MCP Endpoint

${CONFIG_MCP_ENDPOINT:-Not configured}

## Garden Structure

- \`trust/bonds/\` — Bond documents with the kingdom
- \`keys/\` — Device keys (VESTA-SPEC-149)
- \`channels/\` — Channel subscriptions (VESTA-SPEC-154)
- \`inbox/\` — Kingdom messages for this operator
- \`signals/\` — Outgoing and incoming signal log

## Spec References

- VESTA-SPEC-163 v1.1 — Chain-URI Kingdom Bootstrap
- VESTA-SPEC-164 v1.1 — Garden Model
- VESTA-SPEC-055 — Trust Bond File Format
- VESTA-SPEC-149 — Entity Identity Substrate
READMEEOF

fi

_ok "Garden scaffolded at $GARDEN_PATH"

# ── Step 11: Run handoff scripts (SPEC-163 §7) ────────────────────────────────

# Only run scripts if kingdom config has bootstrap_scripts_cid
if [ -n "$CONFIG_BOOTSTRAP_SCRIPTS_CID" ]; then
  _step "Fetching bootstrap scripts from IPFS ($CONFIG_BOOTSTRAP_SCRIPTS_CID)..."

  SCRIPTS_TMP=$(mktemp -d /tmp/koad-io-scripts-XXXXXX)
  trap 'rm -f "$TAINT_RESULT_FILE" "$SIGCHAIN_TIP_FILE" "$KINGDOM_CONFIG_FILE"; rm -rf "$SCRIPTS_TMP"' EXIT

  # Fetch the scripts IPFS directory
  SCRIPTS_FETCHED=false
  if command -v ipfs >/dev/null 2>&1; then
    if timeout "$IPFS_TIMEOUT" ipfs get "$CONFIG_BOOTSTRAP_SCRIPTS_CID" -o "$SCRIPTS_TMP/bootstrap" 2>/dev/null; then
      SCRIPTS_FETCHED=true
    fi
  fi
  if [ "$SCRIPTS_FETCHED" = "false" ] && command -v curl >/dev/null 2>&1; then
    mkdir -p "$SCRIPTS_TMP/bootstrap/control"
    for script in preinstall install postinstall; do
      curl --silent --fail --max-time "$IPFS_TIMEOUT" \
        "$IPFS_GATEWAY/$CONFIG_BOOTSTRAP_SCRIPTS_CID/control/$script" \
        -o "$SCRIPTS_TMP/bootstrap/control/$script" 2>/dev/null || true
    done
    [ -f "$SCRIPTS_TMP/bootstrap/control/install" ] && SCRIPTS_FETCHED=true
  fi

  if [ "$SCRIPTS_FETCHED" = "true" ]; then
    # Write scripts to garden control/ dir and chmod
    for script in preinstall install postinstall; do
      src="$SCRIPTS_TMP/bootstrap/control/$script"
      dst="$GARDEN_PATH/control/$script"
      if [ -f "$src" ]; then
        cp "$src" "$dst"
        chmod +x "$dst"
        _ok "Script fetched: control/$script"
      fi
    done

    # Verify control/install is present (required per SPEC-115 §13.2)
    if [ ! -f "$GARDEN_PATH/control/install" ]; then
      _err "Required control/install script missing from bootstrap bundle (MISSING_INSTALL_SCRIPT)"
      echo "" >&2
      echo "  bootstrap_scripts_cid: $CONFIG_BOOTSTRAP_SCRIPTS_CID" >&2
      echo "  The IPFS directory must contain control/install (required)." >&2
      echo "  Contact the kingdom operator." >&2
      exit 14
    fi

    # Build handoff environment per SPEC-163 §7.4
    HANDOFF_ENV=(
      "KOAD_IO_KINGDOM_ID=$KINGDOM_ID"
      "KOAD_IO_KINGDOM_HANDLE=$CONFIG_HANDLE"
      "KOAD_IO_GARDEN_PATH=$GARDEN_PATH"
      "KOAD_IO_BOOTSTRAP_TRACK=$BOOTSTRAP_TRACK"
      "KOAD_IO_ENTITY_HANDLE=${ENTITY_HANDLE:-}"
      "KOAD_IO_CHAIN_ADDRESS=$URI_ADDRESS"
    )

    # Run preinstall (optional — non-zero exit aborts bootstrap)
    if [ -f "$GARDEN_PATH/control/preinstall" ]; then
      _step "Running control/preinstall..."
      if ! env "${HANDOFF_ENV[@]}" bash "$GARDEN_PATH/control/preinstall"; then
        _err "control/preinstall exited non-zero — aborting bootstrap."
        echo "  Garden left at $GARDEN_PATH for inspection." >&2
        exit 13
      fi
      _ok "control/preinstall complete."
    fi

    # Run install (required — non-zero exit = INSTALL_FAILED)
    _step "Running control/install..."
    if ! env "${HANDOFF_ENV[@]}" bash "$GARDEN_PATH/control/install"; then
      _err "control/install failed (INSTALL_FAILED)"
      echo "" >&2
      echo "  The kingdom's install script exited non-zero." >&2
      echo "  Garden left at $GARDEN_PATH for inspection." >&2
      echo "  Inspect: $GARDEN_PATH/control/install" >&2
      exit 13
    fi
    _ok "control/install complete."

    # Run postinstall (optional by default; hard if postinstall_required in config)
    POSTINSTALL_REQUIRED=$(node -e "
      try { const d=JSON.parse(require('fs').readFileSync('$KINGDOM_CONFIG_FILE','utf8')); process.stdout.write(String(d.postinstall_required||false)); } catch(e){process.stdout.write('false');}
    " 2>/dev/null || echo "false")

    if [ -f "$GARDEN_PATH/control/postinstall" ]; then
      _step "Running control/postinstall..."
      if ! env "${HANDOFF_ENV[@]}" bash "$GARDEN_PATH/control/postinstall"; then
        if [ "$POSTINSTALL_REQUIRED" = "true" ]; then
          _err "control/postinstall failed and postinstall_required=true in kingdom config."
          echo "  Garden left at $GARDEN_PATH for inspection." >&2
          exit 13
        else
          _warn "control/postinstall exited non-zero (advisory — kingdom did not require it)."
        fi
      else
        _ok "control/postinstall complete."
      fi
    fi

  else
    _warn "Could not fetch bootstrap scripts from IPFS ($CONFIG_BOOTSTRAP_SCRIPTS_CID) — skipping handoff phase."
    echo "  The garden has been scaffolded but the kingdom's install scripts were not run." >&2
    echo "  You may need to run them manually or contact the kingdom operator." >&2
  fi
else
  _step "No bootstrap_scripts_cid in kingdom config — skipping handoff phase."
fi

# ── Step 12: Report success ───────────────────────────────────────────────────

echo "" >&2
echo "$(_green "$(_bold "Garden bootstrapped successfully.")")" >&2
echo "" >&2
echo "  $(_bold "Garden:") $GARDEN_PATH" >&2
echo "  $(_bold "Kingdom:") $CONFIG_NAME" >&2
echo "  $(_bold "Kingdom ID:") $KINGDOM_ID (0x$(printf '%08X' "$KINGDOM_ID"))" >&2
echo "  $(_bold "Track:") $BOOTSTRAP_TRACK" >&2
echo "  $(_bold "Chain address:") $URI_ADDRESS" >&2
if [ "$BOOTSTRAP_TRACK" != "ANONYMOUS" ] && [ -n "$BOND_TYPES" ]; then
  echo "  $(_bold "Active bonds:") $BOND_TYPES" >&2
fi
if [ -n "$CONFIG_MCP_ENDPOINT" ] && [ "$BOOTSTRAP_TRACK" != "ANONYMOUS" ]; then
  echo "  $(_bold "MCP endpoint:") $CONFIG_MCP_ENDPOINT" >&2
fi
echo "" >&2

if [ "$BOOTSTRAP_TRACK" = "ANONYMOUS" ]; then
  echo "  $(_dim "Anonymous track — chain-layer participation only.")" >&2
  echo "  $(_dim "Upgrade to Tier 1 via: koad-io kingdom init $CHAIN_URI --bond=<path>")" >&2
fi

echo "" >&2

source "$HOME/.koad-io/helpers/discovery.sh" 2>/dev/null && _koad_io_hint
