#!/usr/bin/env bash
# Regression: the kingdom-safe grep wrapper must speak ERE, and must never
# answer "no matches" for a pattern the engine cannot express.
#
# THE DEFECT (filed by juno 2026-10-18, found while reviewing a flight):
#   grep pattern="runtime|dispatches"   -> "No matches"      (exit 1)
#   grep pattern="runtime\|dispatches"  -> 5 hits
#   grep pattern="runtime"              -> 5 hits
# `|` was a LITERAL. The tool advertised "Regex pattern", answered cleanly,
# and was unable to answer. In the same session that near-missed making the
# orchestrator tell koad a correct engineer was wrong.
#
# TWO DEFECTS ON THIS PATH, and they need separate tests:
#   1. no ERE by default  -> T1, T2
#   2. an inexpressible pattern reported as emptiness -> T3
#   A third, subtler one: in the recursive path (the harness default) the
#   pattern reaches grep through `find -exec grep ... {} +`, and find collapses
#   the child's exit 2 into exit 1. So "propagate grep's exit 2" is not enough
#   on its own — the wrapper compiles the pattern before it walks a single file.
#   T3 exercises that path specifically (it passes a directory, not a file).
#
# MIGRATION (why the default could flip at all):
#   Under ERE, \| \( \) \{ \} \+ \? change meaning. T11 is a call-site lint
#   over the audited kingdom scripts: no remaining call site may rely on BRE
#   escapes inside a grep invocation. T5/T6 pin the semantics at the wrapper.
#
# Run:
#   bash ~/.koad-io/test/grep-wrapper.test.sh
#
# Fault injection (measured against the pre-fix wrapper, mtime 2026-07-17):
#   KOAD_IO_BIN=<a dir containing the old bin/grep> bash ~/.koad-io/test/grep-wrapper.test.sh
#   -> T1a, T1b, T2a, T2b, T3a, T7, T9a, T9b fail against the old wrapper.

set -uo pipefail

KOAD_IO_DIR="${KOAD_IO_DIR:-$HOME/.koad-io}"
GREP_BIN="${KOAD_IO_BIN:-$KOAD_IO_DIR/bin}/grep"
TARGET="$KOAD_IO_DIR/helpers/kingdom-safe-search.sh"

pass=0
fail=0

check() {
  local name="$1" expected="$2" actual="$3"
  if [[ "$expected" == "$actual" ]]; then
    pass=$((pass + 1))
    printf 'ok   %s\n' "$name"
  else
    fail=$((fail + 1))
    printf 'FAIL %s\n       expected: %q\n       actual:   %q\n' "$name" "$expected" "$actual"
  fi
}

check_contains() {
  local name="$1" needle="$2" haystack="$3"
  if [[ "$haystack" == *"$needle"* ]]; then
    pass=$((pass + 1))
    printf 'ok   %s\n' "$name"
  else
    fail=$((fail + 1))
    printf 'FAIL %s\n       expected to contain: %s\n       actual: %s\n' "$name" "$needle" "$haystack"
  fi
}

check_not_contains() {
  local name="$1" needle="$2" haystack="$3"
  if [[ "$haystack" != *"$needle"* ]]; then
    pass=$((pass + 1))
    printf 'ok   %s\n' "$name"
  else
    fail=$((fail + 1))
    printf 'FAIL %s\n       expected NOT to contain: %s\n       actual: %s\n' "$name" "$needle" "$haystack"
  fi
}

if [[ ! -x "$GREP_BIN" ]]; then
  echo "FATAL: wrapper not executable: $GREP_BIN" >&2
  exit 2
fi
if [[ ! -f "$TARGET" ]]; then
  echo "FATAL: fixture missing: $TARGET" >&2
  exit 2
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# A fixture with a FIXED hit count. The suite originally counted hits in
# helpers/kingdom-safe-search.sh — a live file this same working tree edits —
# so every time that file grew, five assertions went red for a reason that had
# nothing to do with the wrapper. Pin the content, not the corpus.
#
#   'runtime|dispatches'  -> lines 1,2,3,5,7 = 5
#   'runtime'             -> lines 1,3,5     = 3
FIXTURE="$WORK/fixture.txt"
cat > "$FIXTURE" <<'EOF'
runtime dispatches alpha
dispatches alone
runtime alone
alpha only
dispatches and runtime
plain text
dispatches final
EOF

# The harness tool's invocation shape: recursive, line-numbered, filename.
run_recursive() { "$GREP_BIN" -r -n -H -I "$@" 2>"$WORK/err"; }

# ── T1: alternation — the exact repro from the brief ─────────────────────────
out="$(run_recursive -e 'runtime|dispatches' -- "$FIXTURE")"; rc=$?
check "T1a alternation exit code" "0" "$rc"
check "T1b alternation hit count" "5" "$(printf '%s\n' "$out" | /usr/bin/grep -c .)"

# ── T2: a group ──────────────────────────────────────────────────────────────
out="$(run_recursive -e '(runtime|dispatches)' -- "$FIXTURE")"; rc=$?
check "T2a group exit code" "0" "$rc"
check "T2b group hit count" "5" "$(printf '%s\n' "$out" | /usr/bin/grep -c .)"

# ── T3: an unclosed group is an ERROR, never an emptiness ────────────────────
# Directory target on purpose: this is the find -exec path that used to
# collapse exit 2 into exit 1.
out="$(run_recursive -e 'foo(' -- "$KOAD_IO_DIR/helpers")"; rc=$?
err="$(cat "$WORK/err")"
check "T3a invalid pattern exit code is 2" "2" "$rc"
check "T3b invalid pattern prints nothing on stdout" "" "$out"
check_contains "T3c error names the pattern" "foo(" "$err"
check_contains "T3d error names the reason" "Unmatched" "$err"
check_contains "T3e error says it is not a miss" "not a clean miss" "$err"
check_not_contains "T3f error never says 'No matches'" "No matches" "$err"

# ── T3g: a pattern the engine can only REINTERPRET is also not a miss ───────
# GNU grep does not exit 2 on ERE lookahead. It prints "warning: ? at start of
# expression", treats '?' as a literal, and answers "no matches" with rc 1.
# The warning IS the engine saying it could not read the pattern as written —
# so the wrapper must fail loudly here too, not report emptiness.
out="$(run_recursive -e 'a(?=b)' -- "$KOAD_IO_DIR/helpers")"; rc=$?
err="$(cat "$WORK/err")"
check "T3g reinterpreted pattern exit code is 2" "2" "$rc"
check_contains "T3g error calls it inexpressible" "inexpressible" "$err"
check_not_contains "T3g error never says 'No matches'" "No matches" "$err"

# ── T4: plain text still plain ──────────────────────────────────────────────
out="$(run_recursive -e 'runtime' -- "$FIXTURE")"; rc=$?
check "T4a plain text exit code" "0" "$rc"
check "T4b plain text hit count" "3" "$(printf '%s\n' "$out" | /usr/bin/grep -c .)"

# ── T5: the migrated semantics — BRE-escaped pipe is now a literal ───────────
# This is the behaviour change the migration note documents. A pattern the
# wrapper can express, that simply does not occur — a clean miss, exit 1.
out="$(run_recursive -e 'runtime\|dispatches' -- "$FIXTURE")"; rc=$?
check "T5a BRE-escaped pipe is literal under ERE (clean miss)" "1" "$rc"
check "T5b BRE-escaped pipe returns no hits" "" "$out"

# ── T6: the explicit dialect switch restores BRE for that caller ────────────
out="$(KOAD_IO_QUIET=1 "$GREP_BIN" --kingdom-dialect=bre -r -n -H -I -e 'runtime\|dispatches' -- "$FIXTURE" 2>"$WORK/err")"; rc=$?
check "T6a explicit BRE dialect exit code" "0" "$rc"
check "T6b explicit BRE dialect hit count" "5" "$(printf '%s\n' "$out" | /usr/bin/grep -c .)"

# ── T7: fixed-string dialect ─────────────────────────────────────────────────
"$GREP_BIN" --kingdom-dialect=fixed -r -n -H -I -e 'runtime|dispatches' -- "$FIXTURE" >/dev/null 2>"$WORK/err"; rc=$?
check "T7 fixed dialect treats the pipe literally" "1" "$rc"

# ── T8: a caller that declares its own dialect keeps control ────────────────
"$GREP_BIN" -F -r -n -H -I -e 'runtime|dispatches' -- "$FIXTURE" >/dev/null 2>"$WORK/err"; rc=$?
check "T8a caller -F is not overridden by the wrapper default" "1" "$rc"
"$GREP_BIN" -oP 'run\w+' "$FIXTURE" >/dev/null 2>"$WORK/err"; rc=$?
check "T8b caller -P still works" "0" "$rc"

# ── T9: --raw bypasses excludes, not the dialect ────────────────────────────
out="$("$GREP_BIN" --raw -r -n -e 'runtime|dispatches' -- "$FIXTURE" 2>"$WORK/err")"; rc=$?
check "T9a raw mode keeps ERE (exit code)" "0" "$rc"
check "T9b raw mode keeps ERE (hit count)" "5" "$(printf '%s\n' "$out" | /usr/bin/grep -c .)"

# ── T10: the dialect is discoverable ────────────────────────────────────────
help_out="$("$GREP_BIN" --kingdom-help 2>&1)"
check_contains "T10a help names ERE as the default" "default: ERE" "$help_out"
check_contains "T10b help documents the override flag" "--kingdom-dialect=ere|bre|fixed|perl" "$help_out"
check_contains "T10c help documents the migration escapes" '\|' "$help_out"

# ── T11: call-site lint — no live caller may rely on BRE alternation ────────
# Audited 2026-10-18: every .sh under the framework bin/helpers/commands and
# the forge commands tree. Lines that are awk/sed, that already pass -E, or
# that pass -P (PCRE, where \| is deliberately literal) are out of scope.
LINT_DIRS=(
  "$KOAD_IO_DIR/bin"
  "$KOAD_IO_DIR/helpers"
  "$KOAD_IO_DIR/commands"
  "$HOME/.forge/commands"
)
offenders=""
for _d in "${LINT_DIRS[@]}"; do
  [[ -d "$_d" ]] || continue
  hits="$(
    /usr/bin/grep -rn --include='*.sh' -e 'grep' "$_d" 2>/dev/null \
      | /usr/bin/grep -v '/\.archive/' \
      | /usr/bin/grep -F -e '\|' \
      | /usr/bin/grep -vE 'grep +-([A-Za-z]*P)' \
      | /usr/bin/grep -vE 'grep +-([A-Za-z]*E)' \
      | /usr/bin/grep -vE 'awk |sed '
  )"
  [[ -n "$hits" ]] && offenders+="$hits"$'\n'
done
check "T11 no call site depends on BRE alternation" "" "$(printf '%s' "$offenders")"

# ── T12: stdin, non-recursive path still speaks ERE ─────────────────────────
out="$(printf 'alpha\nbeta\n' | "$GREP_BIN" -e 'alpha|beta' 2>"$WORK/err")"; rc=$?
check "T12a stdin ERE exit code" "0" "$rc"
check "T12b stdin ERE output" "alpha
beta" "$out"

echo
echo "── ${pass} passed, ${fail} failed ──"
[[ $fail -eq 0 ]]
