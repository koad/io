#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# koad-io ask helper — interactive question primitives
#
# Usage: source "$HOME/.koad-io/helpers/ask.sh"
#
# Provides:
#   ask "prompt text" "ENV_VALUE_IF_SET" "default_if_empty" [--write /path/.env VAR_NAME]
#   ask_yn "prompt text" "ENV_VALUE_IF_SET" [--write /path/.env VAR_NAME]
#
# ENV-first: if the env value arg is non-empty, skip the prompt and return it.
# Interactive: if stdin is a terminal, prompt the user.
# Non-interactive: if not a terminal and no env value, exit 1 with a clear message.
#
# --write /path/to/.env VAR_NAME
#   When present and the answer came from the user (not from a pre-set ENV value),
#   persist VAR_NAME=answer to the specified .env file so future runs skip the prompt.
#   - If the .env file doesn't exist, it is created with a comment header.
#   - If VAR_NAME already exists in the file, its value is updated in place.
#   - If the answer came from ENV (second arg non-empty), nothing is written.

# _ask_write_env ENVFILE VARNAME VALUE
#
# Internal helper — writes or updates VAR=value in an .env file.
_ask_write_env() {
    local envfile="$1"
    local varname="$2"
    local value="$3"

    # Create with header if missing
    if [ ! -f "$envfile" ]; then
        mkdir -p "$(dirname "$envfile")"
        cat > "$envfile" << 'HEADER'
# SPDX-License-Identifier: AGPL-3.0-or-later
# Auto-written by koad-io ask helper. Do not commit.
HEADER
    fi

    if grep -q "^${varname}=" "$envfile" 2>/dev/null; then
        # Update in place — portable sed (works on GNU + BSD)
        sed -i.bak "s|^${varname}=.*|${varname}=${value}|" "$envfile"
        rm -f "${envfile}.bak"
    else
        echo "${varname}=${value}" >> "$envfile"
    fi
}

# ask PROMPT ENV_VALUE [DEFAULT] [--write /path/.env VAR_NAME]
#
# Prints prompt to stderr (so it doesn't pollute command substitution output).
# Reads answer from stdin.
# If ENV_VALUE is set (non-empty), echoes it and returns without prompting.
# If user presses Enter with no input and DEFAULT is set, uses DEFAULT.
# Output: echoes the answer to stdout.
#
# Example:
#   HANDLE=$(ask "Your handle" "$KOAD_IO_HANDLE" "$(whoami)")
#   HANDLE=$(ask "Your handle" "${KOAD_IO_HANDLE:-}" "" --write ~/.koad-io/me/.env KOAD_IO_HANDLE)
ask() {
    local prompt="$1"
    local env_val="${2:-}"
    local default="${3:-}"
    local write_file=""
    local write_var=""

    # Parse optional --write flag from remaining args
    shift 3 2>/dev/null || shift $# 2>/dev/null || true
    while [ $# -gt 0 ]; do
        case "$1" in
            --write)
                write_file="${2:-}"
                write_var="${3:-}"
                shift 3 2>/dev/null || shift $# 2>/dev/null || true
                ;;
            *) shift ;;
        esac
    done

    # ENV-first: skip prompt entirely, do not write (already persisted)
    if [ -n "$env_val" ]; then
        echo "$env_val"
        return 0
    fi

    if [ -t 0 ]; then
        # Interactive: show prompt with optional default hint
        local display_prompt
        if [ -n "$default" ]; then
            display_prompt="$prompt [$default]: "
        else
            display_prompt="$prompt: "
        fi
        local answer
        read -r -p "$display_prompt" answer </dev/tty
        local result="${answer:-$default}"

        # Persist if --write was specified and we have both file and var name
        if [ -n "$write_file" ] && [ -n "$write_var" ]; then
            _ask_write_env "$write_file" "$write_var" "$result"
        fi

        echo "$result"
    else
        # Non-interactive and no env value — fail clearly
        local var_hint=""
        # Derive a plausible env var name from the prompt for the error message
        var_hint=$(echo "$prompt" | tr '[:lower:] ' '[:upper:]_' | tr -cd 'A-Z0-9_')
        echo "[ask] ERROR: Non-interactive mode — cannot prompt for: $prompt" >&2
        echo "[ask] Set env var (e.g. KOAD_IO_${var_hint}) or run interactively." >&2
        exit 1
    fi
}

# ask_yn PROMPT ENV_VALUE [--write /path/.env VAR_NAME]
#
# Returns 0 for yes, 1 for no.
# ENV_VALUE: pre-answer — accepts y/yes/true/1 (case-insensitive) as yes, anything else as no.
# If ENV_VALUE is empty and non-interactive, exits with error.
# When --write is present and the answer came interactively, writes VAR_NAME=yes or VAR_NAME=no.
#
# Example:
#   if ask_yn "Do you have a Keybase account?" "$HAS_KEYBASE"; then
#   if ask_yn "Do you have a Keybase account?" "${KOAD_IO_HAS_KEYBASE:-}" --write ~/.koad-io/me/.env KOAD_IO_HAS_KEYBASE; then
ask_yn() {
    local prompt="$1"
    local env_val="${2:-}"
    local write_file=""
    local write_var=""

    # Parse optional --write flag from remaining args
    shift 2 2>/dev/null || shift $# 2>/dev/null || true
    while [ $# -gt 0 ]; do
        case "$1" in
            --write)
                write_file="${2:-}"
                write_var="${3:-}"
                shift 3 2>/dev/null || shift $# 2>/dev/null || true
                ;;
            *) shift ;;
        esac
    done

    # ENV-first: parse yes/no from env value, do not write
    if [ -n "$env_val" ]; then
        case "${env_val,,}" in
            y|yes|true|1) return 0 ;;
            *)             return 1 ;;
        esac
    fi

    if [ -t 0 ]; then
        local answer
        read -r -p "$prompt (y/n): " answer </dev/tty
        local yn_result
        case "${answer,,}" in
            y|yes) yn_result="yes" ;;
            *)     yn_result="no" ;;
        esac

        # Persist if --write was specified
        if [ -n "$write_file" ] && [ -n "$write_var" ]; then
            _ask_write_env "$write_file" "$write_var" "$yn_result"
        fi

        [ "$yn_result" = "yes" ] && return 0 || return 1
    else
        local var_hint
        var_hint=$(echo "$prompt" | tr '[:lower:] ' '[:upper:]_' | tr -cd 'A-Z0-9_')
        echo "[ask] ERROR: Non-interactive mode — cannot prompt for: $prompt" >&2
        echo "[ask] Set env var (e.g. KOAD_IO_${var_hint}=y) or run interactively." >&2
        exit 1
    fi
}
