#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# koad-io ask helper — interactive question primitives
#
# Usage: source "$HOME/.koad-io/helpers/ask.sh"
#
# Provides:
#   ask "prompt text" "ENV_VALUE_IF_SET" "default_if_empty"
#   ask_yn "prompt text" "ENV_VALUE_IF_SET"
#
# ENV-first: if the env value arg is non-empty, skip the prompt and return it.
# Interactive: if stdin is a terminal, prompt the user.
# Non-interactive: if not a terminal and no env value, exit 1 with a clear message.

# ask PROMPT ENV_VALUE [DEFAULT]
#
# Prints prompt to stderr (so it doesn't pollute command substitution output).
# Reads answer from stdin.
# If ENV_VALUE is set (non-empty), echoes it and returns without prompting.
# If user presses Enter with no input and DEFAULT is set, uses DEFAULT.
# Output: echoes the answer to stdout.
#
# Example:
#   HANDLE=$(ask "Your handle" "$KOAD_IO_HANDLE" "$(whoami)")
ask() {
    local prompt="$1"
    local env_val="${2:-}"
    local default="${3:-}"

    # ENV-first: skip prompt entirely
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
        echo "${answer:-$default}"
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

# ask_yn PROMPT ENV_VALUE
#
# Returns 0 for yes, 1 for no.
# ENV_VALUE: pre-answer — accepts y/yes/true/1 (case-insensitive) as yes, anything else as no.
# If ENV_VALUE is empty and non-interactive, exits with error.
#
# Example:
#   if ask_yn "Do you have a Keybase account?" "$HAS_KEYBASE"; then
ask_yn() {
    local prompt="$1"
    local env_val="${2:-}"

    # ENV-first: parse yes/no from env value
    if [ -n "$env_val" ]; then
        case "${env_val,,}" in
            y|yes|true|1) return 0 ;;
            *)             return 1 ;;
        esac
    fi

    if [ -t 0 ]; then
        local answer
        read -r -p "$prompt (y/n): " answer </dev/tty
        case "${answer,,}" in
            y|yes) return 0 ;;
            *)     return 1 ;;
        esac
    else
        local var_hint
        var_hint=$(echo "$prompt" | tr '[:lower:] ' '[:upper:]_' | tr -cd 'A-Z0-9_')
        echo "[ask] ERROR: Non-interactive mode — cannot prompt for: $prompt" >&2
        echo "[ask] Set env var (e.g. KOAD_IO_${var_hint}=y) or run interactively." >&2
        exit 1
    fi
}
