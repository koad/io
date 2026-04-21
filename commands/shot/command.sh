#!/bin/bash
# shot — capture a full-page screenshot of a URL or same-origin path
#
# Usage:
#   <entity> shot <url-or-path> [width] [--wait=N] [--out=<path>] [--reload]
#
# Examples:
#   juno shot https://kingofalldata.com/overview            # width 1920, 20s wait
#   juno shot /overview 1440                                # router-nav (same origin)
#   juno shot https://example.com 1280 --wait=30            # slow sites
#   juno shot /flights/abc --reload                         # force full reload
#
# Behavior:
# - Absolute URL → playwright-cli goto (full page load)
# - Leading-slash path → Router.go() via eval (same-origin, faster, preserves state)
# - Default wait: 20s (network can be slow + reactive templates take time)
# - Default output: ~/.<entity>/screenshots/<timestamp>-<slug>.png

set -e

PW="$HOME/.koad-io/bin/playwright-cli"
[ -x "$PW" ] || { echo "[shot] error: $PW not executable" >&2; exit 1; }

url=""
width="1920"
wait_s="20"
out=""
reload=""

while [ $# -gt 0 ]; do
  case "$1" in
    --wait=*) wait_s="${1#--wait=}" ;;
    --wait) wait_s="$2"; shift ;;
    --out=*) out="${1#--out=}" ;;
    --out) out="$2"; shift ;;
    --reload) reload="1" ;;
    --help|-h)
      grep '^#' "$0" | sed 's/^# \?//'
      exit 0 ;;
    -*) echo "[shot] unknown flag: $1" >&2; exit 1 ;;
    *)
      if [ -z "$url" ]; then
        url="$1"
      elif [[ "$1" =~ ^[0-9]+$ ]]; then
        width="$1"
      else
        echo "[shot] unexpected positional: $1" >&2; exit 1
      fi ;;
  esac
  shift
done

if [ -z "$url" ]; then
  echo "[shot] error: url required. see 'shot --help'" >&2
  exit 1
fi

# Default output path under the calling entity's home
entity="${ENTITY:-juno}"
if [ -z "$out" ]; then
  mkdir -p "$HOME/.$entity/screenshots"
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  slug="$(echo "$url" | sed -E 's#^https?://##; s#[^a-zA-Z0-9]+#-#g; s#^-+##; s#-+$##' | cut -c1-80)"
  [ -z "$slug" ] && slug="page"
  out="$HOME/.$entity/screenshots/${ts}-${slug}.png"
fi

# Set viewport width (height held at 1080)
"$PW" resize "$width" 1080 > /dev/null 2>&1 || true

# Navigate
if [[ "$url" == /* ]]; then
  echo "[shot] Router.go('$url') @ ${width}w"
  "$PW" eval "() => Router.go('$url')" > /dev/null 2>&1
elif [ -n "$reload" ]; then
  echo "[shot] reload + goto $url @ ${width}w"
  "$PW" eval "() => location.reload(true)" > /dev/null 2>&1 || true
  "$PW" goto "$url" > /dev/null 2>&1
else
  echo "[shot] goto $url @ ${width}w"
  "$PW" goto "$url" > /dev/null 2>&1
fi

# Wait for render (network + reactive templates)
echo "[shot] waiting ${wait_s}s for render to settle..."
sleep "$wait_s"

# Capture
"$PW" screenshot --filename="$out" --full-page > /dev/null 2>&1

if [ -s "$out" ]; then
  sz=$(stat -c%s "$out" 2>/dev/null || stat -f%z "$out" 2>/dev/null || echo "?")
  echo "[shot] saved: $out (${sz} bytes)"
else
  echo "[shot] FAILED — no output at $out" >&2
  exit 1
fi
