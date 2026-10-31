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

# The note line is the map: difficulty, level, slug, title — the same 27 notes in
# the same order that kingofalldata.com/learn serves them.
#
# --blurb / --hypothesis / --long add the prose the notes already carry in their
# frontmatter to each line, unlabelled (blurb) or labelled (hypothesis), indented
# so the map stays greppable and the default output stays byte-identical.
#
# Why this flag exists (2026-10-31): a sovereign install could not run this
# command at all — the file was committed 644 — so the learner rebuilt the whole
# index by hand, with the one-sentence claim per note, and handed it in as
# homework. `curriculum list --blurb` prints exactly that index: his file was a
# missing flag, not a piece of curriculum design.
_list_usage() {
  cat <<'USAGE'
usage: curriculum [list [--blurb|--hypothesis|--long]|show <slug>|path]

  curriculum list                 the map — difficulty, level, slug, title
  curriculum list --blurb         ...with the one-sentence claim each note makes
  curriculum list --hypothesis    ...with the note's hypothesis
  curriculum list --long          ...with both
  curriculum show <slug>          the whole note
  curriculum path                 where the notes live
USAGE
}

_list() {
  local show_blurb=0 show_hyp=0

  while [ $# -gt 0 ]; do
    case "$1" in
      --blurb)      show_blurb=1 ;;
      --hypothesis) show_hyp=1 ;;
      --long)       show_blurb=1; show_hyp=1 ;;
      -h|--help)    _list_usage; exit 0 ;;
      -*)           echo "curriculum list: unknown flag '$1'" >&2; exit 64 ;;
      *)            echo "curriculum list: unexpected argument '$1'" >&2; exit 64 ;;
    esac
    shift
  done

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
    blurb="$(_field "$file" blurb)"
    hypothesis="$(_field "$file" hypothesis)"
    printf '%04d\t%s\t%s\t%s\t%s\t%s\n' \
      "${difficulty:-999}" "${level:-?}" "${slug:-$(basename "$file" .md)}" \
      "${title:-$(basename "$file" .md)}" "$blurb" "$hypothesis"
  done | sort -n | awk -F'\t' -v sb="$show_blurb" -v sh="$show_hyp" '
    {
      printf "%s  %-8s  %-28s  %s\n", $1+0, $2, $3, $4
      if (sb && $5 != "") printf "    %s\n", $5
      if (sh && $6 != "") printf "    hypothesis: %s\n", $6
    }
  '
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
  list|ls) shift || true; _list "$@" ;;
  show|read|cat) shift; _show "${1:-}" ;;
  path) echo "$CURRICULUM_DIR" ;;
  -h|--help|help) _list_usage ;;
  *)
    _list_usage >&2
    exit 64
    ;;
esac
