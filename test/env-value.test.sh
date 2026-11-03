#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Parity contract: helpers/env.sh `env_value FILE KEY` must return exactly what
# `set -a; source FILE; set +a` yields for the same key.
#
# THE DEFECT (filed by juno 2026-11-03, found on a real external install):
#   The framework WRITES every .env value double-quoted and escaped
#   (helpers/ask.sh:33, commands/init/sovereign:47-60) and READ it in two
#   vocabularies. Readers that stripped quotes agreed; readers that did not
#   (`grep KEY= | cut -d= -f2-`) fed literal quotes into ENTITY_USERID, which
#   was signed into a sovereign sigchain entity-genesis entry and a trust bond.
#   A live install's signed UID read: alice @ "valhala.is".
#
#   koad's ruling: one reader, one meaning. This test is the contract. If a
#   future reader regresses to quote-stripping without unescaping — or to no
#   stripping at all — one side of each assertion goes red.
#
# WHAT IS ASSERTED
#   Every form the writer produces (plain, double-quoted, empty, escaped quote,
#   escaped backslash, both escapes) plus hand-edits it must tolerate
#   (single-quoted, `= in value`, unquoted escaped space, export prefix,
#   duplicate key, trailing comment, concatenated segments, #-leading value),
#   the absent-key contract, and a targeted lint that the audited `.env` reader
#   idiom did not come back.
#
# Run:
#   bash ~/.koad-io/test/env-value.test.sh
#
# Fault injection (against a helper that merely strips quotes):
#   cp ~/.koad-io/helpers/env.sh /tmp/env.sh.bak
#   # replace the parser body with quote-stripping, then rerun -> escape tests fail

set -uo pipefail

KOAD_IO_DIR="${KOAD_IO_DIR:-$HOME/.koad-io}"
ENV_HELPER="$KOAD_IO_DIR/helpers/env.sh"

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

if [[ ! -f "$ENV_HELPER" ]]; then
  echo "FATAL: helper missing: $ENV_HELPER" >&2
  exit 2
fi

# shellcheck disable=SC1090
source "$ENV_HELPER"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

FIXTURE="$WORK/fixture.env"
cat > "$FIXTURE" <<'EOF'
# fixture: every form the writer can produce, plus hand-edits it must tolerate
KEY_PLAIN=plain
KEY_TWO_WORDS="two words"
KEY_EMPTY=""
KEY_EMPTY_UNQUOTED=
KEY_ESC_QUOTE="a\"b"
KEY_SINGLE='single quoted'
KEY_EQ="a=b=c"
KEY_ESC_BACKSLASH="C:\\Users\\koad"
KEY_ESC_DOLLAR="costs \$5"
KEY_BOTH="he said \"hi\" \\ bye"
KEY_UNQUOTED_ESCAPED_SPACE=one\ two
export KEY_EXPORTED="exported value"
KEY_DUP="first"
KEY_DUP="second"
KEY_TRAILING="value" # a comment after a quoted value
KEY_CONCAT="a"'b'c
KEY_HASH=#hashtag
KEY_STAR="*"
KEY_PREFIX=not-a-prefix
KEY_PREFIX_EXTRA=longer
EOF

# The reference semantics. A subshell so nothing the fixture defines leaks out.
source_value() {
  local file="$1" key="$2"
  (
    set -a
    # shellcheck disable=SC1090
    source "$file" >/dev/null 2>&1
    set +a
    printf '%s' "${!key-}"
  )
}

# check_parity NAME KEY — env_value must equal source for KEY.
check_parity() {
  local name="$1" key="$2"
  local expected actual rc
  expected="$(source_value "$FIXTURE" "$key")"
  actual="$(env_value "$FIXTURE" "$key" 2>"$WORK/err")"
  rc=$?
  if [[ $rc -ne 0 ]]; then
    fail=$((fail + 1))
    printf 'FAIL %s\n       expected exit 0, got %s (%s)\n' "$name" "$rc" "$(cat "$WORK/err")"
    return
  fi
  check "$name" "$expected" "$actual"
}

# ── T1–T5: the writer's own forms ───────────────────────────────────────────
check_parity "T1  unquoted plain value"                 KEY_PLAIN
check_parity "T2  double-quoted value with spaces"      KEY_TWO_WORDS
check_parity "T3  empty double-quoted value"            KEY_EMPTY
check_parity "T4  escaped double quote"                 KEY_ESC_QUOTE
check_parity "T5  escaped backslash"                    KEY_ESC_BACKSLASH

# ── T6–T7: the two escapes together — the exact reverse of the writer ───────
check_parity "T6  escaped backslash + escaped quote"    KEY_BOTH
check_parity "T7  escaped dollar inside double quotes"  KEY_ESC_DOLLAR

# ── T8–T13: hand-edits the reader must tolerate ─────────────────────────────
check_parity "T8  single-quoted value"                  KEY_SINGLE
check_parity "T9  = inside the value"                   KEY_EQ
check_parity "T10 unquoted escaped space"               KEY_UNQUOTED_ESCAPED_SPACE
check_parity "T11 export prefix"                        KEY_EXPORTED
check_parity "T12 duplicate key — last wins"            KEY_DUP
check_parity "T13 trailing comment after quoted value"  KEY_TRAILING
check_parity "T14 concatenated segments"                KEY_CONCAT
check_parity "T15 value beginning with #"               KEY_HASH
check_parity "T16 empty unquoted value"                 KEY_EMPTY_UNQUOTED

# ── T17: absent key — exit 1, NO output, and source agrees it is empty ──────
actual="$(env_value "$FIXTURE" KEY_ABSENT 2>"$WORK/err")"; rc=$?
check "T17a absent key exit code" "1" "$rc"
check "T17b absent key prints nothing" "" "$actual"
check "T17c absent key matches source (empty)" "" "$(source_value "$FIXTURE" KEY_ABSENT)"

# ── T18: a key that is a strict prefix of another key is still absent ───────
actual="$(env_value "$FIXTURE" KEY_PREFIX_THIS_IS_NOT_THERE 2>/dev/null)"; rc=$?
check "T18a prefix key exit code" "1" "$rc"
check "T18b prefix key prints nothing" "" "$actual"

# …and reading KEY_PREFIX does not pick up KEY_PREFIX_EXTRA.
check_parity "T18c exact key, not prefix match"          KEY_PREFIX

# ── T19: missing file — exit 1, no output (callers guard with `|| true`) ────
actual="$(env_value "$WORK/does-not-exist.env" KEY_PLAIN 2>"$WORK/err")"; rc=$?
check "T19a missing file exit code" "1" "$rc"
check "T19b missing file prints nothing" "" "$actual"

# ── T20: usage errors are loud, exit 2, stdout stays clean ──────────────────
actual="$(env_value "$FIXTURE" 2>"$WORK/err")"; rc=$?
check "T20a missing KEY argument exit code" "2" "$rc"
check "T20b missing KEY argument stdout" "" "$actual"
actual="$(env_value "$FIXTURE" 'BAD-KEY' 2>"$WORK/err")"; rc=$?
check "T20c malformed key exit code" "2" "$rc"
check "T20d malformed key stdout" "" "$actual"

# ── T21: exec mode (the helper is also runnable directly) ───────────────────
actual="$(bash "$ENV_HELPER" "$FIXTURE" KEY_BOTH 2>"$WORK/err")"; rc=$?
check "T21a exec mode exit code" "0" "$rc"
check "T21b exec mode output" "$(source_value "$FIXTURE" KEY_BOTH)" "$actual"

# ── T22: sourcing the helper is silent (no stray output in every caller) ────
actual="$(bash -c 'source "$1" ; :' _ "$ENV_HELPER" 2>&1)"
check "T22 sourcing the helper prints nothing" "" "$actual"

# ── T23: call-site lint — the quote-blind .env reader idiom has not returned
# The audit (2026-11-03) converted every `.env` value read to env_value.
# Whole-file `source` loads and existence checks (`grep -q "^KEY="`) are fine.
# This pins the specific defect class: grep of a KEY from a .env piped to
# `cut -d= -f2` with no unescape.
LINT_DIRS=(
  "$KOAD_IO_DIR/bin"
  "$KOAD_IO_DIR/helpers"
  "$KOAD_IO_DIR/commands"
  "$KOAD_IO_DIR/hooks"
)
offenders=""
for _d in "${LINT_DIRS[@]}"; do
  [[ -d "$_d" ]] || continue
  hits="$(
    /usr/bin/grep -rn --include='*.sh' -E '\.env[^|]*\|[^|]*cut[[:space:]]+-d=' "$_d" 2>/dev/null \
      | /usr/bin/grep -v '\.archive' \
      | /usr/bin/grep -v 'env_value'
  )"
  [[ -n "$hits" ]] && offenders+="$hits"$'\n'
done
check "T23 no quote-blind .env reader remains" "" "$(printf '%s' "$offenders")"

echo
echo "── ${pass} passed, ${fail} failed ──"
[[ $fail -eq 0 ]]
