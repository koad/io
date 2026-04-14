#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# koad-io install — post-clone setup
# Checks dependencies, adds ~/.koad-io/bin to PATH, prints success signal.
# No external network calls. Everything runs from the cloned repo.
# Usage: ~/.koad-io/bin/koad-io install

set -euo pipefail

KOAD_IO_DIR="$HOME/.koad-io"
KOAD_IO_BIN="$KOAD_IO_DIR/bin"

# ── Detect version ────────────────────────────────────────────────────────────

KOAD_IO_VERSION=$(cd "$KOAD_IO_DIR" && git rev-parse --short HEAD 2>/dev/null || echo "unknown")

# ── Dependency check ──────────────────────────────────────────────────────────

check_dep() {
  local name="$1"
  if command -v "$name" &>/dev/null; then
    echo "  $name ✓"
    return 0
  else
    echo "  $name ✗  (not found — install $name before continuing)"
    return 1
  fi
}

echo
echo "koad:io install"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo
echo "Checking dependencies:"
DEPS_OK=true
check_dep git   || DEPS_OK=false
check_dep gpg   || DEPS_OK=false
check_dep claude || { echo "    → Install Claude Code: https://claude.ai/download"; DEPS_OK=false; }
check_dep gh    || { echo "    → Install GitHub CLI: https://cli.github.com"; DEPS_OK=false; }
echo

# ── PATH setup ────────────────────────────────────────────────────────────────

PROFILE_UPDATED=false
PROFILE_FILE=""

path_line="export PATH=\"\$HOME/.koad-io/bin:\$PATH\""
path_marker="# koad:io"

add_to_profile() {
  local profile="$1"
  if [ -f "$profile" ]; then
    if ! grep -q "\.koad-io/bin" "$profile" 2>/dev/null; then
      echo "" >> "$profile"
      echo "$path_marker" >> "$profile"
      echo "$path_line" >> "$profile"
      PROFILE_UPDATED=true
      PROFILE_FILE="$profile"
    else
      PROFILE_FILE="$profile"
    fi
  fi
}

# Detect shell and update appropriate profile
CURRENT_SHELL=$(basename "${SHELL:-bash}")
case "$CURRENT_SHELL" in
  zsh)
    add_to_profile "$HOME/.zshrc"
    ;;
  bash)
    add_to_profile "$HOME/.bashrc"
    [ -z "$PROFILE_FILE" ] && add_to_profile "$HOME/.bash_profile"
    ;;
  *)
    add_to_profile "$HOME/.profile"
    ;;
esac

if $PROFILE_UPDATED; then
  echo "PATH updated: added ~/.koad-io/bin to $PROFILE_FILE"
elif [ -n "$PROFILE_FILE" ]; then
  echo "PATH: ~/.koad-io/bin already in $PROFILE_FILE"
else
  echo "PATH: could not detect shell profile — add manually:"
  echo "  $path_line"
fi

# ── Success signal ────────────────────────────────────────────────────────────

echo
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo
echo "  koad:io installed ✦"
echo "  version   $KOAD_IO_VERSION"
echo "  location  $KOAD_IO_DIR"
if [ -n "$PROFILE_FILE" ]; then
  echo "  PATH      $PROFILE_FILE"
fi
echo
echo "  dependencies:"
command -v git    &>/dev/null && echo "    git     ✓" || echo "    git     ✗"
command -v gpg    &>/dev/null && echo "    gpg     ✓" || echo "    gpg     ✗"
command -v claude &>/dev/null && echo "    claude  ✓" || echo "    claude  ✗"
command -v gh     &>/dev/null && echo "    gh      ✓" || echo "    gh      ✗"
echo
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo

# ── Next step ─────────────────────────────────────────────────────────────────

if $PROFILE_UPDATED; then
  echo "Reload your shell to activate PATH:"
  echo "  source $PROFILE_FILE"
  echo
fi

echo "Next: create your first entity"
echo "  koad-io gestate <entityname>"
echo

if ! $DEPS_OK; then
  echo "⚠  Some dependencies are missing. Install them and re-run: koad-io install"
  echo
  exit 1
fi
