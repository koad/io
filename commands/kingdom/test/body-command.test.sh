#!/usr/bin/env bash
# Regression: `kingdom <kind> body` must not accept a whole file — and must only
# claim success when it actually replaced the body.
#
# TWO DEFECTS ON ONE PATH:
#
#   1. fm.py `body` spliced whatever arrived on stdin in as the BODY. Fed a whole
#      container — the obvious mistake — it produced a SECOND frontmatter block.
#      Every reader tolerates that, because they all stop at the first block, so
#      nothing saw it. The linter only catches it after the fact. Two canon
#      containers carried one until 2026-10-10 (kingdom-fs/tooling,
#      kingofalldata-pwa).
#   2. cmd_bubble_body printed "body replaced" UNCONDITIONALLY. The success line
#      was the only signal, so it had to be true. In the fm.py-fails case it was
#      masked: command.sh runs under `set -e`, so the script aborted before the
#      echo could lie. The echo was unconditional all the same, and a refusal now
#      exits through an explicit message rather than a silent abort — T5 pins the
#      new behaviour. Same class as the `edit` dollar collapse in the harness: a
#      write whose only signal is a success line.
#
# Run:
#   bash commands/kingdom/test/body-command.test.sh
#
# Fault injection (expect T1, T2, T5 and T7 to fail — the suite proving it fires):
#   KINGDOM_CMD_DIR=<pre-fix checkout>/commands/kingdom bash commands/kingdom/test/body-command.test.sh
#
# Canon is never touched: every run uses a scratch KOAD_IO_KINGDOM_ROOT.

set -uo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CMD_DIR="${KINGDOM_CMD_DIR:-$(cd "${TEST_DIR}/.." && pwd)}"
COMMAND_SH="${CMD_DIR}/command.sh"
FM_PY="${CMD_DIR}/fm.py"

for f in "$COMMAND_SH" "$FM_PY"; do
    [ -f "$f" ] || { echo "missing: $f" >&2; exit 2; }
done

WORK="$(mktemp -d "${TMPDIR:-/tmp}/kingdom-body-test.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

ROOT="${WORK}/kingdom"
mkdir -p "${ROOT}/projects"

PASS=0
FAIL=0

ok()   { PASS=$((PASS + 1)); printf '  \033[0;32mok\033[0m   %s\n' "$1"; }
bad()  { FAIL=$((FAIL + 1)); printf '  \033[0;31mFAIL\033[0m %s\n' "$1"; }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (expected '$3', got '$2')"; fi; }

# Count lines that are exactly `---`. Written as -x (whole line) so the pattern
# never ends in a dollar sign — a dollar adjacent to a quote is a replacement
# pattern in a JS String.replace call, and this file is also maintained with the
# `edit` tool.
count_rules() { grep -cx -- '---' "$1"; }

SLUG="demo-container"
CONTAINER="${ROOT}/projects/${SLUG}/project.md"

seed() {
    mkdir -p "$(dirname "$CONTAINER")"
    cat > "$CONTAINER" <<'SEED'
---
slug: demo-container
kind: project
title: Demo Container
status: active
created: 2026-10-11
updated: 2026-10-11
---

# Demo

Original body line one.

Original body line two.
SEED
    cp "$CONTAINER" "${WORK}/pristine.md"
}

# Run the real CLI. Writes stdout to $WORK/out, stderr to $WORK/err, echoes exit.
run_cli() {  # <stdin-file>
    KOAD_IO_KINGDOM_ROOT="$ROOT" bash "$COMMAND_SH" project body "$SLUG" \
        < "$1" > "${WORK}/out" 2> "${WORK}/err"
    echo $?
}

fm_block_count() { grep -c '^slug:' "$1"; }

# A whole file with its own frontmatter — the obvious mistake.
whole_file() {
    cat > "${WORK}/whole.md" <<'WHOLE'
---
slug: other-container
kind: project
title: Piped Whole File
status: draft
created: 2026-10-11
updated: 2026-10-11
---

# Piped

This is the whole file, frontmatter and all.
WHOLE
}

echo
echo "== kingdom body: defect regression =="
echo "   command dir: ${CMD_DIR}"
echo

# ---------------------------------------------------------------------------
echo "T1  a whole file is REFUSED, and nothing changes"
# ---------------------------------------------------------------------------
seed; whole_file
RC="$(run_cli "${WORK}/whole.md")"
check "T1a exit is non-zero" "$([ "$RC" -ne 0 ] && echo yes || echo no)" "yes"
check "T1b no success line printed" "$(grep -c 'body replaced' "${WORK}/out")" "0"
check "T1c file byte-identical to before" "$(cmp -s "$CONTAINER" "${WORK}/pristine.md" && echo same || echo changed)" "same"
check "T1d exactly one frontmatter block" "$(fm_block_count "$CONTAINER")" "1"

# ---------------------------------------------------------------------------
echo "T2  a body-only write succeeds, and says so ONCE"
# ---------------------------------------------------------------------------
seed
printf '# Replaced\n\nNew body.\n' > "${WORK}/body.md"
RC="$(run_cli "${WORK}/body.md")"
check "T2a exit is zero" "$RC" "0"
check "T2b success line printed exactly once" "$(grep -c 'body replaced' "${WORK}/out")" "1"
check "T2c exactly one frontmatter block" "$(fm_block_count "$CONTAINER")" "1"
check "T2d body actually replaced" "$(grep -c 'New body.' "$CONTAINER")" "1"
check "T2e old body is gone" "$(grep -c 'Original body line one' "$CONTAINER")" "0"
check "T2f frontmatter preserved" "$(grep -c '^title: Demo Container' "$CONTAINER")" "1"

# ---------------------------------------------------------------------------
echo "T3  a markdown horizontal rule in the body is NOT over-refused"
# ---------------------------------------------------------------------------
seed
printf 'Section one.\n\n---\n\nSection two.\n' > "${WORK}/hr.md"
RC="$(run_cli "${WORK}/hr.md")"
check "T3a exit is zero" "$RC" "0"
check "T3b success line printed" "$(grep -c 'body replaced' "${WORK}/out")" "1"
# Three rules: the opening fence, the closing fence, and the rule in the body.
# What matters is that the body's rule SURVIVED and was not eaten as a delimiter.
check "T3c the body rule survived" "$(count_rules "$CONTAINER")" "3"
check "T3d both sections present" "$(grep -c '^Section two.' "$CONTAINER")" "1"

# ---------------------------------------------------------------------------
echo "T4  a body that merely STARTS with --- (prose, not frontmatter) is allowed"
# ---------------------------------------------------------------------------
seed
printf -- '---\n\nJust prose, no key lines here.\n' > "${WORK}/prose.md"
RC="$(run_cli "${WORK}/prose.md")"
check "T4a exit is zero" "$RC" "0"
check "T4b the prose landed in the body" "$(grep -c 'Just prose' "$CONTAINER")" "1"

# ---------------------------------------------------------------------------
echo "T5  when fm.py fails the CLI must NOT claim success"
# ---------------------------------------------------------------------------
seed
printf '# whatever\n' > "${WORK}/body.md"
chmod 000 "$CONTAINER"
RC="$(run_cli "${WORK}/body.md")"
chmod 644 "$CONTAINER"
check "T5a exit is non-zero" "$([ "$RC" -ne 0 ] && echo yes || echo no)" "yes"
check "T5b no success line printed" "$(grep -c 'body replaced' "${WORK}/out")" "0"
check "T5c the failure is stated" "$(grep -ci 'body NOT replaced' "${WORK}/err")" "1"

# ---------------------------------------------------------------------------
echo "T6  fm.py body, called directly, refuses a whole file"
# ---------------------------------------------------------------------------
seed; whole_file
python3 "$FM_PY" body "$CONTAINER" < "${WORK}/whole.md" > "${WORK}/out" 2> "${WORK}/err"
RC=$?
check "T6a exit is non-zero" "$([ "$RC" -ne 0 ] && echo yes || echo no)" "yes"
check "T6b file byte-identical to before" "$(cmp -s "$CONTAINER" "${WORK}/pristine.md" && echo same || echo changed)" "same"
check "T6c refusal names the reason" "$(grep -ci 'frontmatter' "${WORK}/err")" "1"

# ---------------------------------------------------------------------------
echo "T7  fm.py body, called directly, still writes a plain body"
# ---------------------------------------------------------------------------
seed
printf '# Direct\n' > "${WORK}/body.md"
python3 "$FM_PY" body "$CONTAINER" < "${WORK}/body.md" > "${WORK}/out" 2> "${WORK}/err"
RC=$?
check "T7a exit is zero" "$RC" "0"
check "T7b exactly one frontmatter block" "$(fm_block_count "$CONTAINER")" "1"
check "T7c body replaced" "$(grep -c '^# Direct' "$CONTAINER")" "1"

echo
echo "== ${PASS} passed, ${FAIL} failed =="
[ "$FAIL" -eq 0 ] || exit 1
