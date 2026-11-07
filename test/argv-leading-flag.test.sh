#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Contract: what the launcher hands a command, and what a leading flag may not eat.
#
# TWO CONTRACTS, TWO KINDS OF TEST
# --------------------------------
# A. THE RESOLUTION VIEW (unit, helper only) — T1–T11
#    A leading flag must never consume a positional command word. This pins
#    koad_io_split_argv, which produces the tokens the resolver is allowed to
#    consider. It is deliberately NOT a statement about what the command
#    receives: that is contract B, and the two were conflated for months.
#
# B. THE ARGV BOUNDARY (end-to-end, the real launcher) — T20–T26
#    VESTA-SPEC-245 §0/A-3:
#
#      The launcher may remove the command words it resolved. It may not add,
#      drop, or move any other token.
#
#    Each T2x case shells out to bin/koad-io and asserts the argv the command
#    actually received — element identity AND order. A probe command lives in a
#    throwaway CWD/commands/ tree (the highest-priority resolution tier), so no
#    framework tree is touched.
#
# WHY CONTRACT B EXISTS (the defect it would have caught)
# ------------------------------------------------------
# Until 2026-11-07 the launcher did a stable PARTITION: every flag was moved
# behind all the positionals and appended at the exec line. No token was lost
# and the exit code was zero — which is why it looked harmless. But it
# RELOCATES a value instead of mangling it, and a relocation inside an
# order-sensitive command inverts meaning silently:
#
#   profile view --chain a.json b.json   ->  command received  b.json --chain a.json
#   its boolean --chain arm shifted one token
#   -> CHAIN_FILES=(b.json, a.json): a tip-first chain walked genesis-first, exit 0
#
# The old T20/T21 asserted the partition itself (positionals in one array,
# flags in another) as the pass condition. That is correct about the mechanism
# and WRONG about the contract: left in place, it becomes a regression test for
# the bug (SPEC-245 §2.3, m1). They now assert element identity and order.
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

# Join argv tokens with US (0x1f) so spaces inside a token stay unambiguous and
# an EMPTY token is still visible as a position between two separators.
US=$'\x1f'
join() {
  local _out="" _a
  for _a in "$@"; do _out+="$_a$US"; done
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
  check "$name · resolution view" "$exp_pos" "$pos"
  check "$name · flag view" "$exp_flags" "$flags"
}

# ── A. THE RESOLUTION VIEW ──────────────────────────────────────────────────
# These four cases are the 2026-11-03 incident: an unknown or boolean leading
# flag absorbed the command word and a DIFFERENT command ran.
assert_split "T1  unknown --debug does not eat the command" \
  "$(join kingdom whoami)" "$(join --debug)" -- --debug kingdom whoami

assert_split "T2  unknown --dry-run does not eat the command" \
  "$(join kingdom project list)" "$(join --dry-run)" -- --dry-run kingdom project list

assert_split "T3  unknown --debug before a lone verb" \
  "$(join kingdom)" "$(join --debug)" -- --debug kingdom

assert_split "T4  a LEADING value flag pairs with its value" \
  "$(join status flights)" "$(join --entity juno)" -- --entity juno status flights

assert_split "T5  known boolean flag never eats a positional" \
  "$(join upstart)" "$(join --local)" -- --local upstart

assert_split "T6  value may begin with a single '-' (not '--')" \
  "$(join message)" "$(join --note -5)" -- --note -5 message

assert_split "T7  self-contained --key=value needs no lookahead" \
  "$(join status)" "$(join --entity=juno)" -- --entity=juno status

assert_split "T8  value flag followed by another flag stays boolean" \
  "$(join status)" "$(join --entity --json)" -- --entity --json status

assert_split "T9  whitespace inside a flag value is preserved" \
  "$(join done)" "$(join --note "two words")" -- --note "two words" done

assert_split "T10 unknown flag after the verb does not eat the next verb" \
  "$(join kingdom whoami)" "$(join --debug)" -- kingdom --debug whoami

assert_split "T11 unknown --key=value pass-through" \
  "$(join kingdom)" "$(join --whatever=1)" -- --whatever=1 kingdom

# ── T12: KOAD_IO_FLAGS is NOT a command-facing contract (SPEC-245 A-5) ──────
# It was a word-split string; a consumer re-applied the partition after
# splitting on whitespace and lost the caller's quoting a second time. It is
# gone from the launcher, and a command reads its own "$@" instead.
flags_export="$(/usr/bin/grep -nE '^[[:space:]]*(export[[:space:]]+)?KOAD_IO_FLAGS=' "$LAUNCHER" 2>/dev/null)"
check "T12a launcher exports no KOAD_IO_FLAGS" "" "$flags_export"
check "T12b helper defines no KOAD_IO_FLAGS export" "" \
  "$(/usr/bin/grep -nE '^[[:space:]]*(export[[:space:]]+)?KOAD_IO_FLAGS=' "$ARGV_HELPER" 2>/dev/null)"

# ── B. THE ARGV BOUNDARY, END TO END ────────────────────────────────────────
# A probe command that reports exactly the argv it was given.
PROBE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/koad-io-argv-probe-XXXXXX")" || {
  echo "FATAL: cannot create a probe directory" >&2
  exit 2
}
cleanup() { rm -rf "$PROBE_ROOT"; }
trap cleanup EXIT

mkdir -p "$PROBE_ROOT/commands/probe"
cat > "$PROBE_ROOT/commands/probe/command.sh" <<'PROBE'
#!/usr/bin/env bash
# Report the argv the launcher handed us: count, then each element, US-joined.
printf 'argc=%s' "$#"
for _a in "$@"; do printf '\037%s' "$_a"; done
printf '\n'
printf 'flags_env=%s\n' "${KOAD_IO_FLAGS-<unset>}"
PROBE
chmod +x "$PROBE_ROOT/commands/probe/command.sh"

# probe_argc_expect ARGS... -> prints the argc the probe should report
probe_run() {
  ( cd "$PROBE_ROOT" && KOAD_IO_QUIET=1 "$LAUNCHER" probe "$@" 2>/dev/null )
}

# assert_boundary NAME EXPECTED -- ARGS...
#   EXPECTED is `argc=N` followed by US-separated elements, e.g.
#   "argc=3${US}--chain${US}a.json${US}b.json"
assert_boundary() {
  local name="$1" expected="$2"
  shift 2
  [[ "${1:-}" == "--" ]] && shift
  local got
  got="$(probe_run "$@" | head -n1)"
  check "$name · argv intact and ordered" "$expected" "$got"
}

# T20 — the exact repro from SPEC-245 §1.1. Under the partition this arrived as
# `b.json --chain a.json` and walked a tip-first chain genesis-first.
assert_boundary "T20 --chain keeps its value and its place" \
  "argc=3${US}--chain${US}a.json${US}b.json" -- --chain a.json b.json

# T21 — SPEC-245's recipe C-4.
assert_boundary "T21 flag interleaved between positionals stays put" \
  "argc=4${US}alpha${US}--month${US}2026-06${US}beta" -- alpha --month 2026-06 beta

# T22 — a leading value flag is consumed for resolution but the COMMAND still
# sees it, in place. (The launcher removes command words only.)
assert_boundary "T22 leading value flag reaches the command in place" \
  "argc=3${US}--entity${US}juno${US}x" -- --entity juno x

# T23 — spaces and an EMPTY argument survive as single elements.
assert_boundary "T23 spaces and empty argument preserved" \
  "argc=4${US}--note${US}two words${US}${US}tail" -- --note "two words" "" tail

# T24a — C-5: `--` is honoured and preserved in place. Before SPEC-245 the
# terminator matched the `--*` branch and was relocated like any flag.
assert_boundary "T24a -- is preserved in place" \
  "argc=3${US}--${US}--not-a-flag${US}kingdom" -- -- --not-a-flag kingdom

# T24b — C-5's real consequence: what `--` protects is RESOLUTION, not delivery.
# Delivery survives a broken fence (the exec slice preserves order either way),
# so a delivery-only assertion cannot catch the defect. The harm is that a token
# after `--` is mistaken for a command word and resolves one level too deep.
# `probe/sub/` exists, so a broken fence runs a DIFFERENT command.
mkdir -p "$PROBE_ROOT/commands/probe/sub"
cat > "$PROBE_ROOT/commands/probe/sub/command.sh" <<'SUBPROBE'
#!/usr/bin/env bash
printf 'SUB argc=%s' "$#"
for _a in "$@"; do printf '\037%s' "$_a"; done
printf '\n'
SUBPROBE
chmod +x "$PROBE_ROOT/commands/probe/sub/command.sh"

t24b="$(probe_run -- sub | head -n1)"
case "$t24b" in
  SUB*) check "T24b -- keeps a sub-command name out of resolution" \
           "probe subcommand NOT run" "it ran (depth-2 resolved through --)" ;;
  *)    check "T24b -- keeps a sub-command name out of resolution" \
           "argc=2${US}--${US}sub" "$t24b" ;;
esac

# T24c — the resolution-view unit pin for the same rule.
assert_split "T24c nothing after -- is a resolution candidate" \
  "" "" -- -- --not-a-flag kingdom

# T25 — a command word repeated verbatim in the data must survive: only the
# FIRST occurrence is a command word.
assert_boundary "T25 only the command word is removed, not its namesake" \
  "argc=3${US}probe${US}--flag${US}probe" -- probe --flag probe

# T26 — KOAD_IO_FLAGS is not in the child's environment (A-5).
check "T26 KOAD_IO_FLAGS absent from the command's environment" \
  "flags_env=<unset>" "$(probe_run --json | /usr/bin/grep '^flags_env=')"

# ── C. the value table itself ───────────────────────────────────────────────
# Still worth pinning: in the leading region the table is the only thing that
# stops a value being mistaken for a command word (A-3.1), so the rows a user
# can actually type must be there and the booleans must not be.
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

# T27 — the 2026-11-06 audit's additions are present. Pinned individually so a
# future edit cannot quietly drop one and resurrect its leading-region bug.
# (Call-site-only flags — --handle, --userid, --leaf-fingerprint, … — are
# deliberately absent: the launcher never sees them.)
for _af in --arms --category --format --max-lines --month --parser --verbosity; do
  if koad_io_flag_takes_value "$_af"; then
    check "T27 audit addition present: $_af" "yes" "yes"
  else
    check "T27 audit addition present: $_af" "yes" "no"
  fi
done

# ── D. call-site lint — neither defect may return ───────────────────────────
# The absorb branch must be GATED by the predicate in the helper …
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
  /usr/bin/grep -cE 'helpers/argv\.sh|koad_io_split_argv|koad_io_exec_slice' "$LAUNCHER" 2>/dev/null
)"
check "T18 launcher sources the shared helper (>=2 refs)" "yes" \
  "$([[ "${sources_helper:-0}" -ge 2 ]] && echo yes || echo no)"

# T28 — the partition cannot return. The exec line after the command file must
# contain exactly ONE expansion: the exec slice. A second expansion is the
# `"${_flag_args[@]}"` append that moved every flag to the end (m4).
exec_line="$(/usr/bin/grep -nE '^[[:space:]]*exec[[:space:]]+"\$EXEC_FILE"' "$LAUNCHER" 2>/dev/null)"
expansions="$(printf '%s' "$exec_line" | /usr/bin/grep -o '\${_koad_io_exec_args\[@\]}' | wc -l | tr -d ' ')"
check "T28 exec line has exactly one expansion (no flag append)" "1" "$expansions"
check "T29 exec line appends no flag view" "" \
  "$(printf '%s' "$exec_line" | /usr/bin/grep -oE '\$\{_flag_args\[@\]\}|\$\{_REST_ARGS\[@\]\}' || true)"

# ── E. the splitter is pure — repeated calls do not accumulate state ────────
koad_io_split_argv --debug kingdom whoami
koad_io_split_argv --debug kingdom whoami
check "T19 repeat calls do not accumulate positionals" "$(join kingdom whoami)" \
  "$(join ${_koad_io_positional_args[@]+"${_koad_io_positional_args[@]}"})"
check "T19 repeat calls do not accumulate flags" "$(join --debug)" \
  "$(join ${_koad_io_flag_args[@]+"${_koad_io_flag_args[@]}"})"

echo
echo "── ${pass} passed, ${fail} failed ──"
[[ $fail -eq 0 ]]
