#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Conformance contract: every `;;`-terminated CONSUMING case arm in a command
# tree must name a flag present in the launcher's value-taking table
# (helpers/argv.sh KOAD_IO_VALUE_FLAGS).
#
# WHY THIS EXISTS (2026-11-06)
# ----------------------------
# Three incidents in a week were three missing table rows: --into, --month, and
# --parser/--format/--arms. Each shipped a command line that silently re-routed
# an argument, and none was noticed until a user reported a mangled command.
# The defect is not the rows — it is that nothing checks them. This test turns a
# missing row from a field report into a red build at merge time.
#
# THE TRAP THIS TEST ENCODES (the reason it is not a one-line grep)
# ----------------------------------------------------------------
# A naive sweep for `--flag)` matches ~667 lines across the framework, forge
# and skeleton trees. Only ~144 are case arms. The rest are CALL SITES: a line
# inside a command.sh that hands a flag to another program, e.g.
#
#     json=$(node "$CEREMONY_SCRIPT" resolve-entity --handle "$ENTITY_NAME" \
#       --leaf-fingerprint "$X")
#
# The continuation line `    --leaf-fingerprint "$X")` ends in `)` exactly like
# an arm does, so --leaf-fingerprint, --handle, --userid, --mnemonic, --asc,
# --md, --expect-from and friends all LOOK like missing table entries. The
# launcher never sees them; adding them would bloat a global table with
# vocabulary no user can type.
#
# The filter that makes it real: a genuine case arm's body REACHES `;;` and
# READS THE NEXT TOKEN (`$2`, `${2…}`, `shift 2`). A call site does neither.
# Requiring both — and reading the pattern from the label, not the body — is
# what separates ~128 consuming arms from ~500 false positives.
#
# WHAT IS ASSERTED
#   Sweep (must be in table, or FAIL):
#     ~/.koad-io/commands
#     ~/.forge/commands
#     ~/.koad-io/skeletons/*/skeleton/commands
#   Report-only (WARN, never fail):
#     ~/.*/commands   — another entity's vocabulary is not the framework's to
#                       enforce; report file:line so the owner can act.
#
# SCOPE NOTE — JS command surfaces
#   `;;` is a shell construct. The `.mjs`/`.js` command surfaces that receive
#   "$@" (session/list/report.mjs, summary/parsers/host.mjs, dispatch/score/
#   bandit.js) advertise --format/--parser/--schema/--verbosity/--category/
#   --arms through JS switch/case (`:`/`break`), not `;;`, so this sweep cannot
#   see them. Those flags are pinned by argv-leading-flag.test.sh T22 instead.
#   A separate JS-aware check would be a follow-on, not a redefinition of this
#   contract.
#
# Run:
#   bash ~/.koad-io/test/argv-value-conformance.test.sh
#
# Fault injection (proves the test bites):
#   cp ~/.koad-io/helpers/argv.sh /tmp/argv.sh.bak
#   sed 's/ --month / /' /tmp/argv.sh.bak > /tmp/argv-faulted.sh   # drop --month
#   KOAD_IO_ARGV_HELPER=/tmp/argv-faulted.sh \
#     bash ~/.koad-io/test/argv-value-conformance.test.sh
#   # -> FAIL --month .../ledger/command.sh:123  [forge:ledger], exit 1
#   rm -f /tmp/argv-faulted.sh /tmp/argv.sh.bak

set -uo pipefail

KOAD_IO_DIR="${KOAD_IO_DIR:-$HOME/.koad-io}"
# Test-only fault-injection hook: point the table at a scratch helper without
# moving the sweep roots. Nothing in the launcher reads this variable.
ARGV_HELPER="${KOAD_IO_ARGV_HELPER:-$KOAD_IO_DIR/helpers/argv.sh}"

if [[ ! -f "$ARGV_HELPER" ]]; then
  echo "FATAL: argv helper missing: $ARGV_HELPER" >&2
  exit 2
fi

# shellcheck source=../helpers/argv.sh
source "$ARGV_HELPER"

if [[ ${#KOAD_IO_VALUE_FLAGS[@]} -eq 0 ]]; then
  echo "FATAL: KOAD_IO_VALUE_FLAGS is empty after sourcing $ARGV_HELPER" >&2
  exit 2
fi

# Associative set for O(1) membership.
declare -A _TABLE=()
for _v in "${KOAD_IO_VALUE_FLAGS[@]}"; do _TABLE["$_v"]=1; done

pass=0          # conforming consuming arms in the fail-set trees
fail=0          # consuming arms missing from the table (framework defect)
warn=0          # consuming arms missing in entity trees (report-only)
arms=0          # total consuming arms scanned in fail-set trees
entity_arms=0   # total consuming arms scanned in entity trees
found_canary=0  # parser self-check: did the sweep see --into?

# ── the arm scanner ─────────────────────────────────────────────────────────
# Emits one TAB-separated line per consuming case arm:
#   FILE <TAB> LINE <TAB> FLAG <TAB> PATTERN
# Local declarations are the awk idiom (extra params), not shell state.
AWK_PROG="${TMPDIR:-/tmp}/argv-value-conformance.$$.awk"
cleanup() { rm -f "$AWK_PROG"; }
trap cleanup EXIT

cat > "$AWK_PROG" <<'AWK'
function trim(s,   t) { t = s; sub(/^[ \t]+/, "", t); return t }

# A case-arm label line: first non-blank char is not ( ) or #, and a ')' occurs
# before any '(' — so `--flag)`, `--a|--b)`, `*)` match but `foo()` and
# `json=$(node ...)` do not.
function is_label(s,   t, c, p, q) {
  t = trim(s)
  if (t == "") return 0
  c = substr(t, 1, 1)
  if (c == "(" || c == ")" || c == "#") return 0
  p = index(t, ")"); q = index(t, "(")
  if (p == 0) return 0
  if (q != 0 && q < p) return 0
  return 1
}

function reset() { cand_line = 0; body = ""; pattern = "" }

function flush(   consume, n, arr, i) {
  if (cand_line == 0) return
  # Reject non-case-pattern shapes (a call site's continuation has spaces /
  # quotes; a real pattern is only flag/glob characters).
  if (pattern == "" || pattern ~ /[ \t"'\`$]/) { reset(); return }
  # The filter: a real arm's body reaches `;;`. A call site does not.
  if (body !~ /;;/) { reset(); return }
  # Consuming: the body reads the next token as this flag's value.
  consume = (body ~ /\$2/ || body ~ /\$\{2/ || body ~ /shift[ \t]+2/)
  if (!consume) { reset(); return }
  if (pattern !~ /--/) { reset(); return }
  n = split(pattern, arr, /[^A-Za-z0-9_-]+/)
  for (i = 1; i <= n; i++)
    if (arr[i] ~ /^--[A-Za-z0-9_-]+$/)
      print FILENAME "\t" cand_line "\t" arr[i] "\t" pattern
  reset()
}

{
  if (is_label($0)) {
    flush()                       # new label = boundary; discard an unfinished candidate
    t = trim($0)
    p = index(t, ")")
    pattern = substr(t, 1, p - 1)
    body = substr(t, p + 1)
    cand_line = NR
    if (body ~ /;;/) flush()      # single-line arm
  } else if (cand_line > 0) {
    body = body "\n" $0
    if (body ~ /;;/) flush()
    else if ($0 ~ /^[ \t]*esac/) flush()
  }
}
END { flush() }
AWK

tree_label() {
  case "$1" in
    "$KOAD_IO_DIR/commands")          echo "framework" ;;
    "$HOME/.forge/commands")          echo "forge" ;;
    */skeletons/*/skeleton/commands)
      local _rest="${1#"$KOAD_IO_DIR"/skeletons/}"
      echo "skeleton:${_rest%%/*}" ;;
    "$HOME"/.*/commands)              echo "entity:$(basename "$(dirname "$1")")" ;;
    *)                                echo "${1##*/}" ;;
  esac
}

# sweep_tree ROOT MODE(fail|warn)
sweep_tree() {
  local root="$1" mode="$2" label
  label="$(tree_label "$root")"

  if [[ ! -d "$root" ]]; then
    printf 'skip  %-22s %s (absent)\n' "$label" "$root"
    return 0
  fi

  local tfiles=0 tarms=0 tmiss=0 _f _out _file line flag _pat rel cmd
  while IFS= read -r _f; do
    tfiles=$((tfiles + 1))
    # Scan one file to a buffer first: a process substitution on the inner loop
    # would be expanded once, before the loop variable exists.
    _out="$(/usr/bin/awk -f "$AWK_PROG" "$_f" 2>/dev/null)"
    while IFS=$'\t' read -r _file line flag _pat; do
      [[ -n "${flag:-}" ]] || continue
      tarms=$((tarms + 1))
      [[ "$flag" == "--into" ]] && found_canary=1

      rel="${_file#"$root"/}"
      if [[ "$rel" == */command.sh ]]; then cmd="${rel%/command.sh}"; else cmd="${rel%.sh}"; fi
      cmd="${cmd//\// }"

      if [[ -n "${_TABLE[$flag]:-}" ]]; then
        [[ "$mode" == "fail" ]] && pass=$((pass + 1))
      else
        tmiss=$((tmiss + 1))
        if [[ "$mode" == "fail" ]]; then
          fail=$((fail + 1))
          printf '  FAIL  %-24s %s:%s  [%s:%s]\n' "$flag" "$_file" "$line" "$label" "$cmd"
        else
          warn=$((warn + 1))
          printf '  WARN  %-24s %s:%s  [%s:%s]\n' "$flag" "$_file" "$line" "$label" "$cmd"
        fi
      fi
    done <<< "$_out"
  done < <(/usr/bin/find "$root" -type f -name '*.sh' \
             ! -path '*/node_modules/*' ! -path '*/.git/*' 2>/dev/null | LC_ALL=C sort)

  if [[ "$mode" == "fail" ]]; then
    arms=$((arms + tarms))
    printf '%-24s %d files, %d consuming arms, %d missing\n' "$label" "$tfiles" "$tarms" "$tmiss"
  else
    entity_arms=$((entity_arms + tarms))
    # Report-only: stay quiet for entity trees with nothing to say.
    if [[ $tarms -gt 0 || $tmiss -gt 0 ]]; then
      printf '%-24s %d files, %d consuming arms, %d missing (report-only)\n' \
        "$label" "$tfiles" "$tarms" "$tmiss"
    fi
  fi
}

# ── fail-set: the framework's own trees ─────────────────────────────────────
FAIL_ROOTS=("$KOAD_IO_DIR/commands" "$HOME/.forge/commands")
shopt -s nullglob
for _sk in "$KOAD_IO_DIR"/skeletons/*/skeleton/commands; do
  [[ -d "$_sk" ]] && FAIL_ROOTS+=("$_sk")
done
shopt -u nullglob

echo "value-flag table: ${#KOAD_IO_VALUE_FLAGS[@]} entries"
echo
for _root in "${FAIL_ROOTS[@]}"; do
  sweep_tree "$_root" fail
done

# Parser self-check: a sweep that cannot see a known framework arm is broken,
# and a green result would be asserting nothing.
if [[ $arms -eq 0 || $found_canary -eq 0 ]]; then
  echo >&2
  echo "FATAL: sweep did not see --into (framework spawn arm) — parser or roots are wrong" >&2
  echo "       consuming arms scanned: $arms" >&2
  exit 2
fi

# ── report-only: every entity command tree ─────────────────────────────────
echo
echo "── entity trees (report-only; never fails this test) ──"
for _d in "$HOME"/.[a-z]*/commands; do
  [[ -d "$_d" ]] || continue
  case "$_d" in
    "$KOAD_IO_DIR/commands"|"$HOME/.forge/commands") continue ;;
  esac
  sweep_tree "$_d" warn
done

echo
echo "── ${pass} passed, ${fail} failed ──"
[[ $warn -gt 0 ]] && echo "   (${warn} entity-tree miss(es) across ${entity_arms} arms — report-only)"
echo "   (${arms} framework/forge/skeleton consuming arms scanned)"
[[ $fail -eq 0 ]]
