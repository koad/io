#!/usr/bin/env bash
# SPDX-License-Identifier: 0BSD
#
# feedback — entity triage for sponsor-contributed feedback
#
# Reads and triages Feedback documents stored in kingofalldata.com's Mongo.
# Entities can list pending items, accept/reject/forward/ship them.
# Sponsors can see their own contribution history.
#
# VESTA-SPEC-132 v1.0 — Feedback Capture Protocol
# Auth note: Entity RPC auth to the site is not yet specced.
#   Flag: VESTA needs a spec for off-machine entity HTTP RPC auth before
#   these commands can authenticate as the entity identity.
#   Current implementation calls the site via HTTP with a session token
#   (KOAD_IO_SITE_TOKEN) if present. Set it before using triage commands.
#
# Usage:
#   juno feedback pending [--entity=<handle>]
#                                   List pending feedback for the entity
#   juno feedback show <id>         Show full detail of one feedback item
#   juno feedback accept <id> [--brief=<path>] [--summary=<text>]
#                                   Accept pending → accepted; optionally
#                                   refine the summary and link a brief
#   juno feedback reject <id> [--note=<text>]
#                                   Reject pending → rejected
#   juno feedback forward <id> --to=<entity>
#                                   Forward to another entity
#   juno feedback ship <id> [--commit=<sha>] [--ref=<path>]
#                                   Mark accepted → shipped with artifact refs
#   juno feedback mine [--status=<status>] [--limit=<n>]
#                                   Your own contribution history (as sponsor)
#   juno feedback attribution <id>  Print Contributed-By commit trailer string
#
# Common flags:
#   --json                          Raw JSON response, no formatting
#   --entity=<handle>               Override entity (default: $ENTITY)
#
# Exit codes:
#   0 success
#   1 error
#   2 site unreachable
#   64 bad args

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────

_SITE_URL="${KOAD_IO_SITE_URL:-https://kingofalldata.com}"
_SITE_TOKEN="${KOAD_IO_SITE_TOKEN:-}"
_ENTITY="${ENTITY:-}"
_SUB=""
_ID=""
_JSON=""
_NOTE=""
_BRIEF=""
_SUMMARY=""
_TO=""
_COMMIT=""
_REF=""
_STATUS=""
_LIMIT=50

# ── Arg parse ─────────────────────────────────────────────────────────────────

while [ $# -gt 0 ]; do
  case "$1" in
    pending|show|accept|reject|forward|ship|mine|attribution)
      _SUB="$1"; shift ;;
    --json)            _JSON=1; shift ;;
    --entity=*)        _ENTITY="${1#--entity=}"; shift ;;
    --entity)          _ENTITY="$2"; shift 2 ;;
    --note=*)          _NOTE="${1#--note=}"; shift ;;
    --brief=*)         _BRIEF="${1#--brief=}"; shift ;;
    --summary=*)       _SUMMARY="${1#--summary=}"; shift ;;
    --to=*)            _TO="${1#--to=}"; shift ;;
    --commit=*)        _COMMIT="${1#--commit=}"; shift ;;
    --ref=*)           _REF="${1#--ref=}"; shift ;;
    --status=*)        _STATUS="${1#--status=}"; shift ;;
    --limit=*)         _LIMIT="${1#--limit=}"; shift ;;
    -*)
      printf 'unknown flag: %s\n' "$1" >&2; exit 64 ;;
    *)
      # Positional: first non-flag after sub is the feedback ID
      if [ -z "$_SUB" ]; then
        _SUB="$1"
      elif [ -z "$_ID" ]; then
        _ID="$1"
      fi
      shift ;;
  esac
done

# ── Helpers ───────────────────────────────────────────────────────────────────

_b=$'\033[1m'
_R=$'\033[0m'
_dim=$'\033[2m'
_g=$'\033[32m'
_y=$'\033[33m'
_r=$'\033[31m'
_c=$'\033[36m'

_err() { printf '%sERROR: %s%s\n' "$_r" "$1" "$_R" >&2; }

# HTTP call to site API
# Usage: _call <method_name> <json_body>
_call() {
  local _method="$1"
  local _body="$2"

  if [ -z "$_SITE_TOKEN" ]; then
    _err "KOAD_IO_SITE_TOKEN not set — entity RPC auth not available"
    printf '%snote: VESTA needs an entity HTTP RPC auth spec (Track B gap)%s\n' "$_dim" "$_R" >&2
    printf '%s      set KOAD_IO_SITE_TOKEN=<token> to call site methods%s\n' "$_dim" "$_R" >&2
    exit 2
  fi

  local _payload
  _payload=$(printf '{"method":"%s","params":%s}' "$_method" "$_body")

  local _resp
  if ! _resp=$(curl -sSf --max-time 10 \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $_SITE_TOKEN" \
    -d "$_payload" \
    "$_SITE_URL/api/rpc" 2>&1); then
    _err "site unreachable: $_SITE_URL"
    exit 2
  fi

  echo "$_resp"
}

# ── Sub-commands ──────────────────────────────────────────────────────────────

case "$_SUB" in
  pending)
    _ent="${_ENTITY:-}"
    if [ -z "$_ent" ]; then
      _err "entity required: use --entity=<handle> or set \$ENTITY"
      exit 64
    fi
    _resp=$(_call "feedback.pending" "[\"$_ent\"]")
    if [ -n "$_JSON" ]; then echo "$_resp"; exit 0; fi

    # Format
    _count=$(echo "$_resp" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('result',[])))" 2>/dev/null || echo "?")
    printf '%s%s pending feedback items for %s%s\n\n' "$_b" "$_count" "$_ent" "$_R"
    echo "$_resp" | python3 -c "
import sys, json
data = json.load(sys.stdin)
items = data.get('result', [])
for item in items:
    stale = '  [STALE]' if item.get('stale') else ''
    print(f\"  {item['_id']}  {item.get('created','')[:10]}  {item['summary'][:80]}{stale}\")
" 2>/dev/null || echo "$_resp"
    ;;

  show)
    if [ -z "$_ID" ]; then _err "usage: feedback show <id>"; exit 64; fi
    _resp=$(_call "feedback.show" "[\"$_ID\"]")
    if [ -n "$_JSON" ]; then echo "$_resp"; exit 0; fi
    echo "$_resp" | python3 -c "
import sys, json
data = json.load(sys.stdin)
item = data.get('result', {})
for k, v in item.items():
    if k == 'raw_context':
        print(f'  raw_context: [{len(v)} messages]')
    else:
        print(f'  {k}: {v}')
" 2>/dev/null || echo "$_resp"
    ;;

  accept)
    if [ -z "$_ID" ]; then _err "usage: feedback accept <id> [--brief=<path>] [--summary=<text>]"; exit 64; fi
    _opts="{}"
    [ -n "$_BRIEF" ]   && _opts=$(printf '{"brief_path":"%s"}' "$_BRIEF")
    [ -n "$_SUMMARY" ] && _opts=$(printf '{"summary":"%s"}' "$_SUMMARY")
    [ -n "$_BRIEF" ] && [ -n "$_SUMMARY" ] && \
      _opts=$(printf '{"brief_path":"%s","summary":"%s"}' "$_BRIEF" "$_SUMMARY")
    _resp=$(_call "feedback.accept" "[\"$_ID\",$_opts]")
    if [ -n "$_JSON" ]; then echo "$_resp"; exit 0; fi
    printf '%s✓ accepted: %s%s\n' "$_g" "$_ID" "$_R"
    ;;

  reject)
    if [ -z "$_ID" ]; then _err "usage: feedback reject <id> [--note=<text>]"; exit 64; fi
    _opts="null"
    [ -n "$_NOTE" ] && _opts=$(printf '{"note":"%s"}' "$_NOTE")
    _resp=$(_call "feedback.reject" "[\"$_ID\",$_opts]")
    if [ -n "$_JSON" ]; then echo "$_resp"; exit 0; fi
    printf '%s✓ rejected: %s%s\n' "$_y" "$_ID" "$_R"
    ;;

  forward)
    if [ -z "$_ID" ]; then _err "usage: feedback forward <id> --to=<entity>"; exit 64; fi
    if [ -z "$_TO" ]; then _err "--to=<entity> required"; exit 64; fi
    _resp=$(_call "feedback.forward" "[\"$_ID\",{\"to\":\"$_TO\"}]")
    if [ -n "$_JSON" ]; then echo "$_resp"; exit 0; fi
    _new_id=$(echo "$_resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('result',''))" 2>/dev/null || echo "?")
    printf '%s✓ forwarded: %s → %s (new id: %s)%s\n' "$_g" "$_ID" "$_TO" "$_new_id" "$_R"
    ;;

  ship)
    if [ -z "$_ID" ]; then _err "usage: feedback ship <id> [--commit=<sha>] [--ref=<path>]"; exit 64; fi
    if [ -z "$_COMMIT" ] && [ -z "$_REF" ]; then
      _err "at least one of --commit=<sha> or --ref=<path> required"
      exit 64
    fi
    _opts="{"
    [ -n "$_COMMIT" ] && _opts="${_opts}\"commit_sha\":\"$_COMMIT\","
    [ -n "$_REF" ]    && _opts="${_opts}\"ref\":\"$_REF\","
    _opts="${_opts%,}}"
    _resp=$(_call "feedback.ship" "[\"$_ID\",$_opts]")
    if [ -n "$_JSON" ]; then echo "$_resp"; exit 0; fi
    printf '%s✓ shipped: %s%s\n' "$_g" "$_ID" "$_R"
    ;;

  mine)
    _opts="{"
    [ -n "$_STATUS" ] && _opts="${_opts}\"status\":\"$_STATUS\","
    _opts="${_opts}\"limit\":$_LIMIT}"
    _resp=$(_call "feedback.mine" "[$_opts]")
    if [ -n "$_JSON" ]; then echo "$_resp"; exit 0; fi
    echo "$_resp" | python3 -c "
import sys, json
data = json.load(sys.stdin)
items = data.get('result', [])
print(f'{len(items)} feedback item(s)')
for item in items:
    status_sym = {'pending':'○','accepted':'✓','shipped':'●','rejected':'✗','forwarded':'→'}.get(item.get('status','?'), '?')
    print(f\"  {status_sym} {item['_id']}  [{item.get('entity','?')}]  {item['summary'][:70]}\")
" 2>/dev/null || echo "$_resp"
    ;;

  attribution)
    if [ -z "$_ID" ]; then _err "usage: feedback attribution <id>"; exit 64; fi
    _resp=$(_call "feedback.attribution" "[\"$_ID\"]")
    if [ -n "$_JSON" ]; then echo "$_resp"; exit 0; fi
    _trailer=$(echo "$_resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('result',''))" 2>/dev/null || echo "?")
    printf '%s\n' "$_trailer"
    ;;

  ""|help|--help|-h)
    printf '%sfeedback — entity triage for sponsor-contributed feedback%s\n\n' "$_b" "$_R"
    printf 'Subcommands:\n'
    printf '  %spending%s [--entity=X]        list pending feedback for entity\n' "$_c" "$_R"
    printf '  %sshow%s <id>                   full detail of one feedback item\n' "$_c" "$_R"
    printf '  %saccept%s <id>                 accept; optionally --brief=<path> --summary=<text>\n' "$_c" "$_R"
    printf '  %sreject%s <id>                 reject; optionally --note=<text>\n' "$_c" "$_R"
    printf '  %sforward%s <id> --to=<entity>  forward to another entity\n' "$_c" "$_R"
    printf '  %sship%s <id>                   mark shipped; --commit=<sha> and/or --ref=<path>\n' "$_c" "$_R"
    printf '  %smine%s                        your own contribution history as sponsor\n' "$_c" "$_R"
    printf '  %sattribution%s <id>            print Contributed-By trailer for commit message\n' "$_c" "$_R"
    printf '\nAuth: set KOAD_IO_SITE_TOKEN and KOAD_IO_SITE_URL before calling\n'
    printf '%s(entity RPC auth spec is pending — Vesta Track B)%s\n' "$_dim" "$_R"
    ;;

  *)
    _err "unknown subcommand: $_SUB"
    exit 64
    ;;
esac

# Self-documenting footer
# shellcheck source=/dev/null
source "$HOME/.koad-io/helpers/discovery.sh" 2>/dev/null && _koad_io_hint
