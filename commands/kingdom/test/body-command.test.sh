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
#   3. The guard for (1) tested ONE shape of frontmatter and pronounced on the
#      CLASS. It required every line inside the block to match `^key:`, so two
#      shapes that exist in canon were judged not-frontmatter and the whole file
#      was still spliced in — rc=0, two `slug:` lines, tick printed:
#        - a BLOCK LIST under a key (contributors:/parents:/success: + `  - item`)
#          — 76 of canon's containers carry one, including BOTH of the containers
#          the original question names (kingdom-fs/tooling, kingofalldata-pwa);
#        - an INDENTED CONTINUATION (a wrapped value or a `>` / `|` block scalar)
#          — the rest of the gap. Between the two, ALL 374 of canon's containers
#          are covered by the guard.
#      T8/T9 cover the block-list shape; T11 covers the indented continuation.
#      All three fail against the pre-fix code.
#
# Run:
#   bash commands/kingdom/test/body-command.test.sh
#
# Fault injection (measured: T1, T5, T6, T8, T9, T11 and T12 fail — 22 of 42
# assertions — which is the suite proving it fires on the pre-fix code):
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

# A whole file whose frontmatter carries a BLOCK LIST — the shape 48 of canon's
# containers have. The first guard required every line to be a `key:` line, so
# this shape was judged not-frontmatter and the whole file was still spliced in.
whole_file_blocklist() {
    cat > "${WORK}/whole-blocklist.md" <<'WHOLE'
---
slug: other-container
kind: project
title: Piped Whole File With Block List
status: draft
contributors:
  - aegis
  - vulcan
parents:
  - /kingdom/projects/kingdom-fs
success:
  - one
  - two
created: 2026-10-11
updated: 2026-10-11
---

# Piped

Whole file, block-list frontmatter and all.
WHOLE
}

# A whole file whose frontmatter carries an INDENTED CONTINUATION — a `>` block
# scalar whose body lines are neither `key:` nor `- item`. The first guard judged
# this shape not-frontmatter too.
whole_file_scalar() {
    cat > "${WORK}/whole-scalar.md" <<'WHOLE'
---
slug: other-container
kind: project
title: Piped Whole File With Block Scalar
status: superseded
superseded-by: /kingdom/projects/other
superseded-note: >
  Moved into canon 2026-10-11 (koad decision A). The operator
  registry is retired; the kingdom holds the registry now.
created: 2026-10-11
updated: 2026-10-11
---

# Piped

Whole file, folded block scalar and all.
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

# ---------------------------------------------------------------------------
echo "T8  a whole file with BLOCK-LIST frontmatter is REFUSED"
# ---------------------------------------------------------------------------
seed; whole_file_blocklist
RC="$(run_cli "${WORK}/whole-blocklist.md")"
check "T8a exit is non-zero" "$([ "$RC" -ne 0 ] && echo yes || echo no)" "yes"
check "T8b no success line printed" "$(grep -c 'body replaced' "${WORK}/out")" "0"
check "T8c file byte-identical to before" "$(cmp -s "$CONTAINER" "${WORK}/pristine.md" && echo same || echo changed)" "same"
check "T8d exactly one frontmatter block" "$(fm_block_count "$CONTAINER")" "1"
check "T8e the block-list shape is named in the refusal" "$(grep -ci 'frontmatter' "${WORK}/err")" "1"

# ---------------------------------------------------------------------------
echo "T9  fm.py body, called directly, refuses the block-list shape too"
# ---------------------------------------------------------------------------
seed; whole_file_blocklist
python3 "$FM_PY" body "$CONTAINER" < "${WORK}/whole-blocklist.md" > "${WORK}/out" 2> "${WORK}/err"
RC=$?
check "T9a exit is non-zero" "$([ "$RC" -ne 0 ] && echo yes || echo no)" "yes"
check "T9b file byte-identical to before" "$(cmp -s "$CONTAINER" "${WORK}/pristine.md" && echo same || echo changed)" "same"
check "T9c refusal names the reason" "$(grep -ci 'frontmatter' "${WORK}/err")" "1"

# ---------------------------------------------------------------------------
echo "T10 a body-only write still lands when the block-list GUARD passes"
# ---------------------------------------------------------------------------
seed
printf '# Still fine\n\nPlain body, no frontmatter.\n' > "${WORK}/plain.md"
RC="$(run_cli "${WORK}/plain.md")"
check "T10a exit is zero" "$RC" "0"
check "T10b exactly one frontmatter block" "$(fm_block_count "$CONTAINER")" "1"
check "T10c body replaced" "$(grep -c 'Plain body, no frontmatter.' "$CONTAINER")" "1"

# ---------------------------------------------------------------------------
echo "T11 a whole file with an INDENTED CONTINUATION (block scalar) is REFUSED"
# ---------------------------------------------------------------------------
seed; whole_file_scalar
RC="$(run_cli "${WORK}/whole-scalar.md")"
check "T11a exit is non-zero" "$([ "$RC" -ne 0 ] && echo yes || echo no)" "yes"
check "T11b no success line printed" "$(grep -c 'body replaced' "${WORK}/out")" "0"
check "T11c file byte-identical to before" "$(cmp -s "$CONTAINER" "${WORK}/pristine.md" && echo same || echo changed)" "same"
check "T11d exactly one frontmatter block" "$(fm_block_count "$CONTAINER")" "1"

# ---------------------------------------------------------------------------
echo "T12 every canon container shape is refused (census over the real tree)"
# ---------------------------------------------------------------------------
# Feed each real canon container to the guard directly. Every one must be judged
# frontmatter — i.e. refusing a whole container is total, not shape-specific.
CANON_ROOT="${KOAD_IO_KINGDOM_ROOT:-/kingdom}"
if [ -d "$CANON_ROOT" ]; then
    CENSUS=$(python3 - "$FM_PY" "$CANON_ROOT" <<'PY'
import importlib.util, os, sys
spec = importlib.util.spec_from_file_location('fm', sys.argv[1])
fm = importlib.util.module_from_spec(spec); spec.loader.exec_module(fm)
tot = miss = 0
for r, d, fs in os.walk(sys.argv[2]):
    if '/.git' in r: continue
    for f in fs:
        if not f.endswith('.md'): continue
        p = os.path.join(r, f)
        try: c = open(p, errors='replace').read()
        except Exception: continue
        if not c.lstrip().startswith('---'): continue
        if len(c.lstrip().split('---', 2)) < 3: continue
        tot += 1
        if not fm.looks_like_frontmatter_block(c): miss += 1
print(f'{tot} {miss}')
PY
)
    case "$CENSUS" in
        '') TOT=0; MISS=none ;;
        *)  TOT="${CENSUS% *}"; MISS="${CENSUS#* }" ;;
    esac
    check "T12a the census found canon containers" "$([ "$TOT" -gt 0 ] && echo yes || echo no)" "yes"
    check "T12b every container shape is judged frontmatter" "$MISS" "0"
else
    echo "  (skipped — no canon root at $CANON_ROOT)"
fi

echo
echo "== ${PASS} passed, ${FAIL} failed =="
[ "$FAIL" -eq 0 ] || exit 1
