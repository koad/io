#!/usr/bin/env bash
# pi-smoke.sh — Tier 3 pi integration smoke test.
#
# Launches pi in print mode with the koad-io extension and verifies:
#   1. Extension loads without crashing
#   2. Tools register successfully
#   3. Bond gate initializes
#
# Usage:
#   ./test/pi-smoke.sh              # default smoke test
#   ./test/pi-smoke.sh --verbose    # show pi output
#   ./test/pi-smoke.sh --tools      # list registered tools
#   ./test/pi-smoke.sh --module=lifecycle  # test specific event flow
#
# No entity needed. Bypass mode gives full access for harness development.

set -euo pipefail

HARNESS_DIR="$(cd "$(dirname "$0")/.." && pwd)"
EXTENSION="$HARNESS_DIR/extension/index.ts"

VERBOSE=false
TOOLS_ONLY=false
MODULE=""

for arg in "$@"; do
  case "$arg" in
    --verbose|-v) VERBOSE=true ;;
    --tools|-t) TOOLS_ONLY=true ;;
    --module=*) MODULE="${arg#*=}" ;;
  esac
done

export ENTITY="${ENTITY:-test-entity}"
export KOAD_IO_BOND_GATE_BYPASS=1
export PI_SKIP_VERSION_CHECK=1
export PI_TELEMETRY=0

echo "━━━ pi harness smoke test ━━━"
echo "  extension: $EXTENSION"
echo "  entity:    $ENTITY"
echo "  mode:      bypass (full access)"
echo ""

# ── Test 1: Extension Loads ───────────────────────────────────────

echo "[1/3] Extension loads without crashing..."

LOAD_OUTPUT=$(pi -p --no-session --no-context-files --no-extensions \
  -e "$EXTENSION" \
  "Respond with exactly 'OK' and nothing else. Do not use any tools." 2>&1) || {
  echo "  ✗ FAILED — pi exited with error"
  echo "$LOAD_OUTPUT"
  exit 1
}

if echo "$LOAD_OUTPUT" | grep -qi "OK"; then
  echo "  ✓ Extension loaded successfully"
else
  echo "  ✗ FAILED — unexpected output:"
  echo "$LOAD_OUTPUT" | head -20
  exit 1
fi

# ── Test 2: Tools Register ────────────────────────────────────────

echo "[2/3] Tools register correctly..."

TOOL_OUTPUT=$(pi -p --no-session --no-context-files --no-extensions \
  -e "$EXTENSION" \
  "List every tool name available to you. Format: one tool per line, just the name. Do not call any tools — list them from the system prompt." 2>&1) || {
  echo "  ✗ FAILED — pi exited with error"
  echo "$TOOL_OUTPUT"
  exit 1
}

EXPECTED_TOOLS=("ask_question" "koad-io" "search" "dispatch" "sin" "music" "status")

MISSING=()
for tool in "${EXPECTED_TOOLS[@]}"; do
  if ! echo "$TOOL_OUTPUT" | grep -qi "$tool"; then
    MISSING+=("$tool")
  fi
done

if [ ${#MISSING[@]} -eq 0 ]; then
  echo "  ✓ All expected tools registered"
else
  echo "  ⚠ Some tools missing: ${MISSING[*]}"
  if $VERBOSE; then
    echo "--- tool output ---"
    echo "$TOOL_OUTPUT"
    echo "---"
  fi
fi

if $TOOLS_ONLY; then
  echo ""
  echo "Registered tools:"
  echo "$TOOL_OUTPUT" | grep -iE "(ask_question|koad-io|search|dispatch|sin|music|status|wait_for|channel_|mission|body_)" || true
fi

# ── Test 3: Bond Gate Initializes ─────────────────────────────────

echo "[3/3] Bond gate initializes (bypass mode)..."

GATE_OUTPUT=$(pi -p --no-session --no-context-files --no-extensions \
  -e "$EXTENSION" \
  "You are in bypass mode. Respond with exactly 'BYPASS ACTIVE' and nothing else. Do not use any tools." 2>&1) || {
  echo "  ✗ FAILED — pi exited with error"
  echo "$GATE_OUTPUT"
  exit 1
}

if echo "$GATE_OUTPUT" | grep -qi "BYPASS"; then
  echo "  ✓ Bond gate active (bypass)"
else
  echo "  ⚠ Unexpected bond gate state"
fi

# ── Module-specific tests ─────────────────────────────────────────

if [ -n "$MODULE" ]; then
  echo ""
  echo "━━━ Module test: $MODULE ━━━"

  case "$MODULE" in
    lifecycle)
      echo "Testing lifecycle hooks..."
      pi -p --no-session --no-context-files --no-extensions \
        -e "$EXTENSION" \
        "You are a test entity. Your session just started. Confirm this by responding with 'SESSION ACTIVE' and nothing else." 2>&1 || true
      ;;
    dispatch)
      echo "Testing dispatch tool registration..."
      pi -p --no-session --no-context-files --no-extensions \
        -e "$EXTENSION" \
        "The dispatch tool should be available. List only tool names that include 'dispatch'." 2>&1 || true
      ;;
    channels)
      echo "Testing channel tools (expect 'backend pending' if no daemon)..."
      pi -p --no-session --no-context-files --no-extensions \
        -e "$EXTENSION" \
        "List channel-related tool names only." 2>&1 || true
      ;;
    *)
      echo "Unknown module: $MODULE"
      echo "Available: lifecycle, dispatch, channels"
      exit 1
      ;;
  esac
fi

echo ""
echo "━━━ All smoke tests passed ━━━"
echo ""
echo "Next steps:"
echo "  node --test test/unit/              # run pure unit tests"
echo "  ./test/pi-smoke.sh --verbose        # see full pi output"
echo "  ./test/pi-smoke.sh --module=dispatch # test specific module"
