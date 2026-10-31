#!/usr/bin/env bash
set -euo pipefail

CURRICULUM_DIR="${KOAD_IO_CURRICULUM_DIR:-$HOME/.koad-io/curriculum}"

_field() {
  local file="$1" key="$2"
  awk -F': *' -v key="$key" '
    $0 == "---" { n++; next }
    n == 1 && $1 == key { print substr($0, index($0, $2)); exit }
    n >= 2 { exit }
  ' "$file"
}

_list() {
  if [ ! -d "$CURRICULUM_DIR" ]; then
    echo "curriculum directory not found: $CURRICULUM_DIR" >&2
    exit 1
  fi

  for file in "$CURRICULUM_DIR"/*.md; do
    [ -f "$file" ] || continue
    slug="$(_field "$file" slug)"
    title="$(_field "$file" title)"
    level="$(_field "$file" level)"
    difficulty="$(_field "$file" difficulty)"
    printf '%04d\t%s\t%s\t%s\n' "${difficulty:-999}" "${level:-?}" "${slug:-$(basename "$file" .md)}" "${title:-$(basename "$file" .md)}"
  done | sort -n | awk -F'\t' '{ printf "%s  %-8s  %-28s  %s\n", $1+0, $2, $3, $4 }'
}

_show() {
  local slug="${1:-}"
  if [ -z "$slug" ]; then
    echo "usage: curriculum show <slug>" >&2
    exit 64
  fi

  local file="$CURRICULUM_DIR/$slug.md"
  if [ ! -f "$file" ]; then
    echo "curriculum sight not found: $slug" >&2
    exit 66
  fi

  cat "$file"
}

case "${1:-list}" in
  list|ls) _list ;;
  show|read|cat) shift; _show "${1:-}" ;;
  path) echo "$CURRICULUM_DIR" ;;
  *)
    echo "usage: curriculum [list|show <slug>|path]" >&2
    exit 64
    ;;
esac
