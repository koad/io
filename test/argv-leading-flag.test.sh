#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Regression contract: a leading unknown (or boolean) flag must never consume a
# positional command word.
#
# THE DEFECT (filed by juno 2026-11-03, reproduced by an external install on
# valhala.is at ca6ceee):
#   bin/koad-io treated every `--token` as value-taking and absorbed the next
#   non-flag token. A boolean or unknown flag therefore ate the command word:
#
#     koad-io --debug kingdom whoami    -> --debug=kingdom, ran framework whoami
#     koad-io --dry-run kingdom project list -> command became `project` (exit 66)
#     koad-io --debug kingdom           -> no positional left, printed the banner
#
#   `--debug` is not even a flag — debug is the DEBUG env var. The class is any
#   unknown leading flag silently re-routing the command.
#
# THE CONTRACT
#   A flag consumes the next token only if it is a known value-taking flag
#   (helpers/argv.sh KOAD_IO_VALUE_FLAGS). Everything else is boolean and never
#   eats a positional. This test sources the SAME helper the launcher uses, so a
#   change to the classifier is exercised here, not just asserted in prose.
#
# THE LINT (T20–T23) — the env-value.test.sh T23 model
#   Pins the call site: the launcher must keep sourcing helpers/argv.sh and must
#   NOT regrow the ungated `[[ -n "$_next" && "$_next" != --* ]]` absorb idiom.
#   If the fix is reverted inline, the behavioural cases go red AND the lint
#   names the launcher as the offender.
#
# Run:
#   bash ~/.koad-io/test/argv-leading-flag.test.sh

set -uo pipefail

KOAD_IO_DIR="${KOAD_IO_DIR:-$HOME/.koad-io}"
ARGV_HELPER="$KOAD_IO_DIR/helpers/argv.sh"
LAUNCHER="$KOAD_IO_DIR/bin/koad-io"

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

if [[ ! -f "$ARGV_HELPER" ]]; then
  echo "FATAL: argv helper missing: $ARGV_HELPER" >&2
  exit 2
fi
if [[ ! -f "$LAUNCHER" ]]; then
  echo "FATAL: launcher missing: $LAUNCHER" >&2
  exit 2
fi

# shellcheck source=../helpers/argv.sh
source "$ARGV_HELPER"

# Join argv tokens with US (0x1f) so spaces inside a token stay unambiguous.
join() {
  local _out="" _a
  for _a in "$@"; do _out+="$_a"$'\x1f'; done
  printf '%s' "$_out"
}

# assert_split NAME EXPECTED_POS EXPECTED_FLAGS -- ARGS...
assert_split() {
  local name="$1" exp_pos="$2" exp_flags="$3"
  shift 3
  [[ "${1:-}" == "--" ]] && shift
  koad_io_split_argv "$@"
  local pos flags
  pos="$(join ${_koad_io_positional_args[@]+"${_koad_io_positional_args[@]}"})"
  flags="$(join ${_koad_io_flag_args[@]+"${_koad_io_flag_args[@]}"})"
  check "$name · positionals" "$exp_pos" "$pos"
  check "$name · flags" "$exp_flags" "$flags"
}

# ── T1–T3: the three reproduced failures. The verb must survive. ────────────
assert_split "T1  unknown --debug does not eat the command" \
  "$(join kingdom whoami)" "$(join --debug)" -- --debug kingdom whoami

assert_split "T2  unknown --dry-run does not eat the command" \
  "$(join kingdom project list)" "$(join --dry-run)" -- --dry-run kingdom project list

assert_split "T3  unknown --debug before a lone verb" \
  "$(join kingdom)" "$(join --debug)" -- --debug kingdom

# ── T4–T6: value-taking, boolean, and a '-'-leading value ───────────────────
assert_split "T4  known value flag pairs with its value" \
  "$(join status flights)" "$(join --entity juno)" -- --entity juno status flights

assert_split "T5  known boolean flag never eats a positional" \
  "$(join upstart)" "$(join --local)" -- --local upstart

assert_split "T6  value may begin with a single '-' (not '--')" \
  "$(join message)" "$(join --note -5)" -- --note -5 message

# ── T7–T9: form and precedence edge cases ───────────────────────────────────
assert_split "T7  self-contained --key=value needs no lookahead" \
  "$(join status)" "$(join --entity=juno)" -- --entity=juno status

assert_split "T8  value flag followed by another flag stays boolean" \
  "$(join status)" "$(join --entity --json)" -- --entity --json status

assert_split "T9  whitespace inside a flag value is preserved" \
  "$(join done)" "$(join --note "two words")" -- --note "two words" done

# ── T10: a boolean flag AFTER the verb is still a flag, not an operand ──────
assert_split "T10 unknown flag after the verb does not eat the next verb" \
  "$(join kingdom whoami)" "$(join --debug)" -- kingdom --debug whoami

# ── T11: --key=value survives even when key is unknown ──────────────────────
assert_split "T11 unknown --key=value pass-through" \
  "$(join kingdom)" "$(join --whatever=1)" -- --whatever=1 kingdom

# ── T12: backwards compat — KOAD_IO_FLAGS is still a word-split string ──────
# start/stop/restart read it for boolean flags (--local, --attach). Emulate the
# launcher's export from the same _flag_args array the splitter produced.
koad_io_split_argv --local --attach upstart
export KOAD_IO_FLAGS="${_koad_io_flag_args[*]}"
check "T12a KOAD_IO_FLAGS word-split carries booleans" "--local --attach" "$KOAD_IO_FLAGS"
check "T12b positional split preserves the verb" "$(join upstart)" "$(join ${_koad_io_positional_args[@]})"
unset KOAD_IO_FLAGS

# ── T20: --into pairs with its path (VESTA-SPEC-243 §2.6) ───────────────────
# `spawn <skeleton> --into <path>` is the spec's canonical spelling. The launcher
# reorders argv (positionals first, then flags), so a value flag that is NOT in
# the table arrives as a bare `--into` with its path left among the positionals —
# the command then sees `--into` with no value and refuses. Pinned here so the
# pairing cannot silently regress.
assert_split "T20 --into pairs with its path" \
  "$(join spawn spawnprobe)" "$(join --into /tmp/new-proj)" -- spawn spawnprobe --into /tmp/new-proj

# ── T21: --month pairs with its period (the 2026-11-06 repro) ───────────────
# `koad-io ledger --month 2026-06 balance` used to reach the command as
# `2026-06 balance --month`: the flag was hoisted past its value, and the value
# was left among the positionals. Same class as --into (T20) and --debug (T1) —
# one missing table entry, one silently re-routed argument.
assert_split "T21a --month pairs when it leads (value must not eat the verb)" \
  "$(join ledger balance)" "$(join --month 2026-06)" -- --month 2026-06 ledger balance

assert_split "T21b --month pairs after the verb (the reported repro)" \
  "$(join ledger balance)" "$(join --month 2026-06)" -- ledger --month 2026-06 balance

assert_split "T21c --month=value needs no lookahead" \
  "$(join ledger balance)" "$(join --month=2026-06)" -- ledger balance --month=2026-06

# ── T13–T15: the value table itself ─────────────────────────────────────────
# The set must be non-empty and cover representative value flags from each layer
# (framework + forge) — and must NOT contain flags that are booleans everywhere.
check "T13a value table is non-empty" "yes" "$([[ ${#KOAD_IO_VALUE_FLAGS[@]} -gt 0 ]] && echo yes || echo no)"
for _vf in --entity --note --to --timeout --limit; do
  if koad_io_flag_takes_value "$_vf"; then
    check "T13b value table includes $_vf" "yes" "yes"
  else
    check "T13b value table includes $_vf" "yes" "no"
  fi
done
for _bf in --local --attach --dry-run --debug --json --quiet; do
  if koad_io_flag_takes_value "$_bf"; then
    check "T14 value table excludes boolean $_bf" "no" "yes"
  else
    check "T14 value table excludes boolean $_bf" "no" "no"
  fi
done
check "T15 predicate rejects an unknown flag" "rejected" \
  "$(koad_io_flag_takes_value --not-a-real-flag && echo accepted || echo rejected)"

# ── T22: the 2026-11-06 audit's additions are present ────────────────────────
# Every entry here is a value flag a USER types on the koad-io command line and
# that the launcher was silently mis-splitting. They are pinned individually so
# a future edit to the table cannot quietly drop one and resurrect its bug.
# (Call-site-only flags — --handle, --userid, --leaf-fingerprint, … — are
# deliberately absent: the launcher never sees them.)
for _af in --arms --category --format --max-lines --month --parser --schema --verbosity; do
  if koad_io_flag_takes_value "$_af"; then
    check "T22 audit addition present: $_af" "yes" "yes"
  else
    check "T22 audit addition present: $_af" "yes" "no"
  fi
done

# ── T16–T19: call-site lint — the defect must not return inline ─────────────
# The absorbing branch must be GATED by the predicate in the helper …
if /usr/bin/grep -q 'koad_io_flag_takes_value "\$_arg"' "$ARGV_HELPER"; then
  check "T16 absorb branch is gated in helper" "gated" "gated"
else
  check "T16 absorb branch is gated in helper" "gated" "ungated"
fi

# … and the ungated idiom must be gone from the launcher …
ungated="$(
  /usr/bin/grep -nE '\[\[ -n "\$_next" && "\$_next" != --\* \]\]' "$LAUNCHER" 2>/dev/null
)"
check "T17 launcher carries no ungated absorb idiom" "" "$ungated"

# … and the launcher must still route through the shared helper (call-site pin).
sources_helper="$(
  /usr/bin/grep -cE 'helpers/argv\.sh|koad_io_split_argv' "$LAUNCHER" 2>/dev/null
)"
check "T18 launcher sources the shared helper (>=2 refs)" "yes" \
  "$([[ "${sources_helper:-0}" -ge 2 ]] && echo yes || echo no)"

# ── T19: the splitter is pure — repeated calls do not accumulate state ──────
koad_io_split_argv --debug kingdom whoami
koad_io_split_argv --debug kingdom whoami
check "T19 repeat calls do not accumulate positionals" "$(join kingdom whoami)" \
  "$(join ${_koad_io_positional_args[@]+"${_koad_io_positional_args[@]}"})"
check "T19 repeat calls do not accumulate flags" "$(join --debug)" \
  "$(join ${_koad_io_flag_args[@]+"${_koad_io_flag_args[@]}"})"

echo
echo "── ${pass} passed, ${fail} failed ──"
[[ $fail -eq 0 ]]
