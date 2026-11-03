#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# koad-io env reader — one reader, one meaning.
#
# Usage (source — the normal form):
#   source "$HOME/.koad-io/helpers/env.sh"
#   value="$(env_value /path/to/.env KEY || true)"
#
# Usage (exec):
#   bash "$HOME/.koad-io/helpers/env.sh" /path/to/.env KEY
#
# env_value FILE KEY
#   Prints the value that `source FILE` would assign to KEY:
#     - surrounding quotes removed
#     - the writer's escapes reversed:  \\ -> \   and   \" -> "
#   Exit 0 and print the value when the key is present. An empty value is a
#   PRESENT key: exit 0, print nothing.
#   Exit 1 with no output when the key is absent, or FILE is missing/unreadable.
#   Exit 2 on misuse (bad arguments, malformed key); the message goes to stderr.
#
# WHY THIS EXISTS
#   helpers/ask.sh `_ask_write_env` and commands/init/sovereign `ensure_env_line`
#   write every value as KEY="escaped value" — deliberately, because values may
#   contain spaces and are read back with `set -a; source FILE; set +a`. Bash
#   `source` unquotes correctly. Ad-hoc readers (`grep KEY= | cut -d= -f2-`)
#   do not, and the same file then means different things depending on which
#   code path opens it. This function is the single reader for a single key.
#   The write format is unchanged; whole-file `source` loads are unchanged and
#   define the semantics this function reproduces.
#
# NOT REPRODUCED (deliberate, documented):
#   - command substitution, parameter expansion and arithmetic inside values
#     (`KEY="$(hostname)"` prints the literal `$(hostname)`, not the output).
#     The framework writer never emits these, and a reader must not execute
#     file content to read it.
#   - multi-line values (the writer cannot produce one; a hand-written one is
#     truncated at the first line, like a reader that stops at the newline).
#   - shell source errors (e.g. `KEY="unterminated`): the accumulated text is
#     returned rather than the shell's continuation behaviour.

# _env_parse_value RAW
#
# Parses a shell assignment's right-hand side into the string `source` would
# assign, stopping at the first unquoted whitespace (the assignment word ends
# there; anything after it is another word/comment to the shell).
_env_parse_value() {
    local raw="${1-}"
    local out=""
    local quote=""          # "" = unquoted, '"' or "'"
    local i=0
    local n="${#raw}"
    local ch nx

    while [ "$i" -lt "$n" ]; do
        ch="${raw:i:1}"

        if [ -z "$quote" ]; then
            case "$ch" in
                ' '|$'\t')
                    break
                    ;;
                '"')
                    quote='"'
                    i=$((i + 1))
                    continue
                    ;;
                "'")
                    quote="'"
                    i=$((i + 1))
                    continue
                    ;;
                '\')
                    if [ $((i + 1)) -lt "$n" ]; then
                        nx="${raw:i+1:1}"
                        case "$nx" in
                            $'\n') i=$((i + 2)); continue ;;
                            *) out+="$nx"; i=$((i + 2)); continue ;;
                        esac
                    fi
                    i=$((i + 1))
                    continue
                    ;;
                *)
                    out+="$ch"
                    i=$((i + 1))
                    continue
                    ;;
            esac
        elif [ "$quote" = '"' ]; then
            case "$ch" in
                '"')
                    quote=""
                    i=$((i + 1))
                    continue
                    ;;
                '\')
                    if [ $((i + 1)) -lt "$n" ]; then
                        nx="${raw:i+1:1}"
                        case "$nx" in
                            '\'|'"'|'$'|'`')
                                out+="$nx"
                                i=$((i + 2))
                                continue
                                ;;
                            $'\n')
                                i=$((i + 2))
                                continue
                                ;;
                            *)
                                # Backslash is literal before any other character.
                                out+='\'
                                i=$((i + 1))
                                continue
                                ;;
                        esac
                    fi
                    out+='\'
                    i=$((i + 1))
                    continue
                    ;;
                *)
                    out+="$ch"
                    i=$((i + 1))
                    continue
                    ;;
            esac
        else
            # single-quoted: everything literal until the closing quote
            case "$ch" in
                "'")
                    quote=""
                    i=$((i + 1))
                    continue
                    ;;
                *)
                    out+="$ch"
                    i=$((i + 1))
                    continue
                    ;;
            esac
        fi
    done

    printf '%s' "$out"
}

# env_value FILE KEY — see the header for the contract.
env_value() {
    local file="${1-}"
    local key="${2-}"

    if [ -z "$file" ] || [ -z "$key" ]; then
        printf 'env_value: usage: env_value FILE KEY\n' >&2
        return 2
    fi
    # A key must be a shell identifier, otherwise the `KEY=` suffix match
    # below could accept an expression the shell would read differently.
    case "$key" in
        [A-Za-z_]*)
            case "$key" in
                *[!A-Za-z0-9_]*)
                    printf 'env_value: invalid key: %s\n' "$key" >&2
                    return 2
                    ;;
            esac
            ;;
        *)
            printf 'env_value: invalid key: %s\n' "$key" >&2
            return 2
            ;;
    esac

    [ -f "$file" ] && [ -r "$file" ] || return 1

    local line assignment raw value
    local last=""
    local found=0

    # Last assignment wins, exactly as repeated `source` lines do.
    while IFS= read -r line || [ -n "$line" ]; do
        assignment="$line"

        # `export KEY=...` is a legal hand-edit; the shell accepts it.
        case "$assignment" in
            export[[:space:]]*)
                assignment="${assignment#export}"
                assignment="${assignment#"${assignment%%[![:space:]]*}"}"
                ;;
        esac

        case "$assignment" in
            "$key"=*)
                raw="${assignment#"$key"=}"
                last="$(_env_parse_value "$raw")"
                found=1
                ;;
        esac
    done < "$file"

    [ "$found" -eq 1 ] || return 1

    printf '%s' "$last"
    return 0
}

# Direct execution: `bash env.sh FILE KEY`
if [ "${BASH_SOURCE[0]:-}" = "${0:-}" ]; then
    env_value "${1-}" "${2-}"
fi
