#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# harness/default — framework kindergarten harness.
#
# Minimal, dependency-light: ensures a branded opencode is installed,
# assembles entity context via startup.sh, and launches opencode.
#
# This is the default a newly-installed koad:io user gets. Richer
# harnesses (claude, pi, multi-provider routing, bolt-ons) live in the
# business layer and are reached via KOAD_IO_HARNESS override.
#
# Invoked by ~/.koad-io/hooks/executed-without-arguments.sh when an
# entity is called with no args.
#
# No args, no flags, no resolution cascade. The entity's .env cascade
# has already run before we get here (ENTITY, ENTITY_DIR, PROMPT, etc.
# are already in scope via set -a).

set -e

# --- Guard rails ----------------------------------------------------------

if [ -z "$ENTITY" ]; then
  echo "Error: \$ENTITY is not set. Invoke via an entity launcher." >&2
  exit 64
fi

if [ -z "$ENTITY_DIR" ] || [ ! -d "$ENTITY_DIR" ]; then
  echo "Error: \$ENTITY_DIR not set or not a directory: '$ENTITY_DIR'" >&2
  exit 64
fi

# --- Ensure opencode is installed -----------------------------------------
#
# The branded opencode is built from a pinned commit + patch set. If the
# binary isn't there (or is stale vs the pinned commit), invoke the install
# command to build it. The install command is idempotent — it no-ops when
# the stamp matches.

OPENCODE_BIN="$HOME/.koad-io/bin/opencode"
INSTALL_CMD="$HOME/.koad-io/commands/install/opencode/command.sh"

if [ ! -x "$OPENCODE_BIN" ]; then
  if [ ! -f "$INSTALL_CMD" ]; then
    echo "Error: opencode not installed and install command missing:" >&2
    echo "  expected binary:  $OPENCODE_BIN" >&2
    echo "  expected install: $INSTALL_CMD" >&2
    exit 69
  fi
  echo "[harness] opencode not found — running: koad-io install opencode"
  "$HOME/.koad-io/bin/koad-io" install opencode
fi

if [ ! -x "$OPENCODE_BIN" ]; then
  echo "Error: install completed but opencode still not executable: $OPENCODE_BIN" >&2
  exit 69
fi

# --- SPEC-072 invariants --------------------------------------------------
#
# Entity config lives at $ENTITY_DIR — opencode reads from there via XDG.

export XDG_CONFIG_HOME="$ENTITY_DIR"

[ -f "$ENTITY_DIR/opencode.json" ]  && export OPENCODE_CONFIG="$ENTITY_DIR/opencode.json"
[ -f "$ENTITY_DIR/opencode.jsonc" ] && export OPENCODE_CONFIG="$ENTITY_DIR/opencode.jsonc"
[ -f "$ENTITY_DIR/tui.json" ]       && export OPENCODE_TUI_CONFIG="$ENTITY_DIR/tui.json"
[ -f "$ENTITY_DIR/tui.jsonc" ]      && export OPENCODE_TUI_CONFIG="$ENTITY_DIR/tui.jsonc"

# --- Rooted vs roaming cwd ------------------------------------------------

if [ "${KOAD_IO_ROOTED:-false}" = "true" ]; then
  WORK_DIR="$ENTITY_DIR"
else
  WORK_DIR="${CWD:-$PWD}"
fi

cd "$WORK_DIR"

# --- Context assembly -----------------------------------------------------
#
# startup.sh walks the identity cascade (KOAD_IO.md → ENTITY.md → primers
# → pre-emptive primitives) and emits the composed SYSTEM_PROMPT. Leaf
# harnesses consume this in their own way; opencode picks it up via
# OPENCODE_CONFIG_CONTENT if we inject it.

if [ -f "$HOME/.koad-io/harness/startup.sh" ]; then
  SYSTEM_PROMPT="$("$HOME/.koad-io/harness/startup.sh" 2>/dev/null)" || true
  export SYSTEM_PROMPT
fi

# Append caller's PRIMER.md as context (not prompt) if set by the hook
if [ -n "${KOAD_IO_CWD_PRIMER:-}" ] && [ -f "${KOAD_IO_CWD_PRIMER}" ]; then
  _cwd_primer_content="$(cat "$KOAD_IO_CWD_PRIMER")"
  SYSTEM_PROMPT="${SYSTEM_PROMPT:+$SYSTEM_PROMPT

}Project context (from $KOAD_IO_CWD_PRIMER):
$_cwd_primer_content"
  export SYSTEM_PROMPT
  unset _cwd_primer_content
fi

# --- Opencode env flags ---------------------------------------------------

export OPENCODE_DISABLE_CLAUDE_CODE=true
export OPENCODE_DISABLE_LSP_DOWNLOAD=true
export OPENCODE_DISABLE_TERMINAL_TITLE=true

# --- Announce + launch ----------------------------------------------------

echo
echo "harness       : default (kindergarten → opencode)"
echo "entity        : $ENTITY"
echo "entity_dir    : $ENTITY_DIR"
echo "work_dir      : $WORK_DIR"
if [ -n "$PROMPT" ]; then
  echo "mode          : one-shot"
else
  echo "mode          : interactive"
fi
echo

if [ -n "$PROMPT" ]; then
  exec "$OPENCODE_BIN" run --dir "$WORK_DIR" "$PROMPT"
else
  exec "$OPENCODE_BIN" "$WORK_DIR"
fi
