# discovery — self-documenting footer for koad:io commands
#
# Any command that sources this file and calls `_koad_io_hint` at the end
# gets a small footer printed to stderr showing nearby structure:
#   - sibling subcommands (directories with command.sh beside it)
#   - flags it recognizes (parsed from its own case statement)
#
# The idea: a command you found in a PRIMER should, when you run it, tell
# you what else it can do — so discovery happens in-flow, not in docs.
#
# Gates:
#   - Only renders on a TTY (silent when piped or scripted)
#   - Silenced entirely by KOAD_IO_QUIET_DISCOVERY=1
#   - Silenced by KOAD_IO_QUIET=1 (the kingdom-wide quiet flag)
#
# Usage at the end of a command.sh:
#
#   source "$HOME/.koad-io/helpers/discovery.sh" 2>/dev/null && _koad_io_hint
#
# The source line tolerates absence — if the helper isn't present, the
# command still runs; it just doesn't print the footer.

# _koad_io_hint [command_path]
#   command_path defaults to $0 — the running command.sh
#   introspects sibling dirs and own --flags, prints a dim footer to stderr
_koad_io_hint() {
  # Respect quiet flags
  [ "${KOAD_IO_QUIET_DISCOVERY:-0}" = "1" ] && return 0
  [ "${KOAD_IO_QUIET:-0}" = "1" ] && return 0

  # Only on a TTY — piped/scripted output stays clean
  [ -t 2 ] || return 0

  local _cmd="${1:-${BASH_SOURCE[1]:-$0}}"
  # Resolve to absolute, follow symlinks
  _cmd="$(readlink -f "$_cmd" 2>/dev/null || echo "$_cmd")"
  local _cmd_dir
  _cmd_dir="$(dirname "$_cmd")"

  # --- Collect sibling subcommands ---
  # A "subcommand" is a subdirectory of _cmd_dir that has its own command.sh.
  local -a _subs=()
  local _d _name
  for _d in "$_cmd_dir"/*/; do
    [ -d "$_d" ] || continue
    [ -x "${_d}command.sh" ] || continue
    _name="$(basename "$_d")"
    _subs+=("$_name")
  done

  # --- Collect recognized flags ---
  # Parse the current command.sh for flags that appear as case labels, which
  # is the user-facing entry point convention across the kingdom:
  #     --foo)
  #     --foo|--bar)
  #     --foo=*)
  # This avoids false positives from internal args to rg/curl/grep passed
  # through as string literals elsewhere in the file.
  local _flags=""
  if [ -r "$_cmd" ]; then
    _flags=$(
      grep -oE '(^|[[:space:]])(--[a-z][a-z0-9-]+)(\)|=\*\)|\|)' "$_cmd" 2>/dev/null \
        | grep -oE -- '--[a-z][a-z0-9-]+' \
        | sort -u \
        | { grep -vE '^--(help|h|[0-9])$' || true; } \
        | tr '\n' ' '
    )
  fi

  # If nothing to say, stay quiet
  [ -z "${_subs[*]:-}" ] && [ -z "$_flags" ] && return 0

  # --- Render to stderr, dim ---
  local _R=$'\033[0m'
  local _dim=$'\033[2m'
  local _c=$'\033[0;36m'

  # Leading blank line to separate from command output
  printf '\n' >&2

  if [ ${#_subs[@]} -gt 0 ]; then
    printf '%ssubs:%s  ' "$_dim" "$_R" >&2
    local _s
    for _s in "${_subs[@]}"; do
      printf '%s%s%s ' "$_c" "$_s" "$_R" >&2
    done
    printf '\n' >&2
  fi

  if [ -n "$_flags" ]; then
    # Wrap at terminal width minus the "flags: " prefix
    local _cols="${COLUMNS:-$(tput cols 2>/dev/null || echo 80)}"
    local _prefix="flags: "
    local _wrap=$(( _cols - ${#_prefix} ))
    [ "$_wrap" -lt 40 ] && _wrap=40

    printf '%sflags:%s ' "$_dim" "$_R" >&2
    local _line_len=0 _w
    for _w in $_flags; do
      local _w_len=$(( ${#_w} + 1 ))
      if [ $(( _line_len + _w_len )) -gt "$_wrap" ]; then
        printf '\n%s       ' "$_dim" >&2
        _line_len=0
      fi
      printf '%s%s%s ' "$_dim" "$_w" "$_R" >&2
      _line_len=$(( _line_len + _w_len ))
    done
    printf '\n' >&2
  fi
}
