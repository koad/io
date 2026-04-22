#!/usr/bin/env bash
# SPDX-License-Identifier: 0BSD
# koad-io install opencode — build branded opencode from pinned commit
set -euo pipefail

KOAD_IO_OPENCODE_REPO="${KOAD_IO_OPENCODE_REPO:?KOAD_IO_OPENCODE_REPO not set in .env}"
KOAD_IO_OPENCODE_COMMIT="${KOAD_IO_OPENCODE_COMMIT:?KOAD_IO_OPENCODE_COMMIT not set in .env}"
KOAD_IO_OPENCODE_BIN="$HOME/.koad-io/bin/opencode"
KOAD_IO_OPENCODE_SRC="$HOME/.cache/koad-io/opencode"
KOAD_IO_OPENCODE_PATCH="$HOME/.koad-io/patches/opencode.patch"
KOAD_IO_OPENCODE_STAMP="$HOME/.koad-io/bin/.opencode-commit"

needs_build() {
  [ ! -x "$KOAD_IO_OPENCODE_BIN" ] && return 0
  [ ! -f "$KOAD_IO_OPENCODE_STAMP" ] && return 0
  [ "$(cat "$KOAD_IO_OPENCODE_STAMP" 2>/dev/null)" != "$KOAD_IO_OPENCODE_COMMIT" ] && return 0
  return 1
}

if ! needs_build; then
  echo "[opencode] Already at $KOAD_IO_OPENCODE_COMMIT — nothing to do."
  exit 0
fi

echo "[opencode] Building branded opencode from $KOAD_IO_OPENCODE_COMMIT ..."

if [ ! -d "$KOAD_IO_OPENCODE_SRC/.git" ]; then
  echo "[opencode] Cloning $KOAD_IO_OPENCODE_REPO ..."
  git clone "$KOAD_IO_OPENCODE_REPO" "$KOAD_IO_OPENCODE_SRC"
fi

cd "$KOAD_IO_OPENCODE_SRC"
git fetch origin
git checkout "$KOAD_IO_OPENCODE_COMMIT"
git reset --hard "$KOAD_IO_OPENCODE_COMMIT"

if [ -f "$KOAD_IO_OPENCODE_PATCH" ]; then
  echo "[opencode] Applying branding patch ..."
  git apply --reject --whitespace=fix "$KOAD_IO_OPENCODE_PATCH"
fi

cd packages/opencode
bun install
OPENCODE_CHANNEL=latest bun run build -- --single

ARCH="$(uname -s | tr '[:upper:]' '[:lower:]')-$(uname -m | sed 's/x86_64/x64/' | sed 's/aarch64/arm64/')"
cp "dist/opencode-${ARCH}/bin/opencode" "$KOAD_IO_OPENCODE_BIN"
echo "$KOAD_IO_OPENCODE_COMMIT" > "$KOAD_IO_OPENCODE_STAMP"

echo "[opencode] Installed $(${KOAD_IO_OPENCODE_BIN} --version) from ${KOAD_IO_OPENCODE_COMMIT:0:12}"
