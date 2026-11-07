#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Conformance contract for the launcher's value-flag table
# (helpers/argv.sh KOAD_IO_VALUE_FLAGS), in BOTH directions.
#
# WHY THIS EXISTS (2026-11-06, corrected 2026-11-07)
# -------------------------------------------------
# Three incidents in a week were three missing table rows: --into, --month, and
# --parser/--format/--arms. Each shipped a command line that silently re-routed
# an argument, and none was noticed until a user reported a mangled command.
# So a presence check was written: every consuming `;;` arm must be tabled.
#
# THE GUARD WAS ONE-SIDED (VESTA-SPEC-245 §3.1, F-10)
# --------------------------------------------------
# It asserted PRESENCE and never ABSENCE-OF-BOOLEAN-USE. So it would have caught
# all three missing rows and NONE of the three collisions, and its remedy —
# "add the row" — is the exact edit that breaks the other layer. A test whose
# failure message recommends the harmful fix is not a guard; it is a ratchet.
# That is how --avatar, --schema and --passphrase got admitted: each satisfied
# the presence check while a boolean use of the same flag sat one tree away.
#
# WHAT THIS ASSERTS NOW
#   C-1  PRESENCE. Every consuming `;;` arm in the fail-set trees is tabled.
#   C-2  ABSENCE.  No tabled flag has a non-consuming `;;` arm in ANY swept
#        tree, and no JS command surface treats it as a boolean. A collision is
#        what inverts meaning silently; absence is the axis that matters.
#   C-3  SEVERITY. A collision fails the TABLE's soundness check no matter which
#        tree it came from — the table is the framework's asset and every
#        readable tree is evidence about it. Only a PRESENCE miss in a foreign
#        tree stays a warning: another entity's vocabulary is not the
#        framework's to enforce.
#
# WHY A COLLISION IS NOT AUTOMATICALLY A LIVE DEFECT
# -------------------------------------------------
# Under SPEC-245 A-3.1 the launcher consults arity ONLY for tokens before the
# last resolved command word. Every collision this sweep can find is a flag used
# as a boolean inside a command's own argv parse — i.e. after the command words,
# where the launcher no longer classifies anything. So these collisions are
# UNREACHABLE, not harmless: they cannot bite today, and they would bite again
# the moment the partition came back.
#
# They are therefore recorded in DISPOSITION below, with a reason, and printed
# on every run. An undisposed collision FAILS. The point is admission control:
# adding a row for a flag that is boolean somewhere is how --chain, --tail and
# --paths were nearly admitted, and the next such edit must be argued in front
# of a reviewer rather than silenced by a warning nobody reads.
#
# HONEST LIMITS (named, not hidden)
#   * `;;` is a shell construct. JS command surfaces (session/list/report.mjs,
#     summary/parsers/host.mjs, dispatch/score/bandit.js) are covered by a
#     narrower JS predicate (C-2b) that looks for `has('<flag>')` /
#     `includes('--<flag>')`; anything more exotic escapes both.
#   * A flag with BOTH kinds of arms cannot satisfy C-1 and C-2 simultaneously.
#     SPEC-245 A-2 resolves that in favour of the boolean side (the value side
#     writes --flag=value). This test does not enforce the losing side's refusal
#     obligation; it only makes the collision visible and frozen.
#   * The sweep cannot see a call site (a line that hands a flag to another
#     program). That is deliberate: the launcher never sees those either.
#
# Run:
#   bash ~/.koad-io/test/argv-value-conformance.test.sh             # C-1 + C-2
#   bash ~/.koad-io/test/argv-value-conformance.test.sh --inverse   # C-2 only,
#                                                                   # every tree
#
# Fault injection (proves both directions bite):
#   cp ~/.koad-io/helpers/argv.sh /tmp/argv.sh.bak
#   sed 's/ --month / /' /tmp/argv.sh.bak > /tmp/argv-faulted.sh   # drop a row
#   KOAD_IO_ARGV_HELPER=/tmp/argv-faulted.sh \
#     bash ~/.koad-io/test/argv-value-conformance.test.sh
#   # -> FAIL --month .../ledger/command.sh:123  [forge:ledger], exit 1
#   sed 's/ --passphrase / /' /tmp/argv.sh.bak > /tmp/argv-faulted.sh; echo '  --chain' >> /tmp/argv-faulted.sh
#   KOAD_IO_ARGV_HELPER=/tmp/argv-faulted.sh \
#     bash ~/.koad-io/test/argv-value-conformance.test.sh --inverse
#   # -> COLLISION --chain ...  (and --passphrase's disposition goes stale)

set -uo pipefail

KOAD_IO_DIR="${KOAD_IO_DIR:-$HOME/.koad-io}"
# Test-only fault-injection hook: point the table at a scratch helper without
# moving the sweep roots. Nothing in the launcher reads this variable.
ARGV_HELPER="${KOAD_IO_ARGV_HELPER:-$KOAD_IO_DIR/helpers/argv.sh}"

MODE="both"
case "${1:-}" in
  "")        MODE="both" ;;
  --inverse) MODE="inverse" ;;
  -h|--help)
    /usr/bin/sed -n '2,/^set -uo pipefail$/p' "${BASH_SOURCE[0]}" | /usr/bin/sed 's/^# \{0,1\}//'
    exit 0 ;;
  *) echo "usage: ${0##*/} [--inverse]" >&2; exit 2 ;;
esac

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

# ── dispositions ────────────────────────────────────────────────────────────
# A tabled flag that is a boolean somewhere. Each entry is an ADMISSION that
# must be argued, not a warning that can be ignored. Adding a line here is the
# reviewable act; the reason must name why the collision cannot be reached.
#
# Every entry currently carries the same reason because the reason is
# structural: the arm is a command's own tail parse, and A-3.1 stops the
# launcher from classifying anything after the command words. An entry whose
# arm disappears (the command was fixed) is reported STALE and must be removed —
# a ledger that only grows is how the table got here.
declare -A DISPOSITION=(
  [--avatar]="boolean in io create (tail); value side is profile create/update --avatar CID (tail). Both parse their own argv; A-3.1 never consults the table there."
  [--schema]="boolean in ecoincore inspect chainpack (tail, mode switch); the only value use is summary's self-contained --schema=<x>, which never consults the table at all."
  [--passphrase]="boolean in ~/.dotfiles identity init (tail); value side is ecoincore import/export (tail shift 2). Operator-approved 2026-11-06; unreachable by jurisdiction under A-3.1."
)

pass=0          # conforming consuming arms in the fail-set trees
fail=0          # consuming arms missing from the table (framework defect)
warn=0          # consuming arms missing in entity trees (report-only)
arms=0          # total consuming arms scanned in fail-set trees
entity_arms=0   # total consuming arms scanned in entity trees
collisions=0    # undisposed non-consuming uses of tabled flags (C-2)
disposed=0      # disposed collisions actually observed
refused=0       # A-2 refusal arms observed (positive evidence)
notes=0
found_canary=0  # parser self-check: did the sweep see --into?

# ── the arm scanners ────────────────────────────────────────────────────────
# Same label/body/filter machinery in both directions; only the predicate on
# the body differs (consumes the next token, vs does not).
AWK_DIR="${TMPDIR:-/tmp}/argv-value-conformance.$$"
cleanup() { rm -rf "$AWK_DIR"; }
trap cleanup EXIT
mkdir -p "$AWK_DIR"
AWK_PROG="$AWK_DIR/consuming.awk"
AWK_INV="$AWK_DIR/nonconsuming.awk"

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

# The inverse predicate, with three classifications and one exclusion, each a
# statement about arity rather than a convenience:
#   * EXCLUSION: a pattern containing '=' is the self-contained --flag=value
#     form, which never consults the table — it is value-taking, not boolean
#     (F-5);
#   * REFUSAL: a body that exits non-zero without consuming the next token is
#     the A-2 losing-side obligation being discharged — `--flag) echo "use
#     --flag=value"; exit 2 ;;`. Counting that as a collision would make the
#     guard punish the one correct fix, which is the same one-sidedness this
#     test was written to end;
#   * EMPTY: no statement before ';;' is an IGNORED flag, not a boolean use;
#   * everything else that does not read the next token is a BOOLEAN use.
cat > "$AWK_INV" <<'AWK'
function trim(s,   t) { t = s; sub(/^[ \t]+/, "", t); return t }
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
function stmt() {
  # the arm body with its trailing ';;' and comments removed
  b = body
  sub(/;;.*/, "", b)
  gsub(/#[^\n]*/, "", b)
  return trim(b)
}
function flush(   consume, empty, refuse, kind, n, arr, i) {
  if (cand_line == 0) return
  if (pattern == "" || pattern ~ /[ \t"'\`$]/) { reset(); return }
  if (body !~ /;;/) { reset(); return }
  if (pattern ~ /=/) { reset(); return }            # self-contained value form
  consume = (body ~ /\$2/ || body ~ /\$\{2/ || body ~ /shift[ \t]+2/)
  if (consume) { reset(); return }
  if (pattern !~ /--/) { reset(); return }
  empty = (stmt() == "")
  refuse = (body ~ /exit[ \t]+[1-9]/)
  if (empty)      kind = "empty"
  else if (refuse) kind = "refuse"
  else             kind = "stmts"
  n = split(pattern, arr, /[^A-Za-z0-9_-]+/)
  for (i = 1; i <= n; i++)
    if (arr[i] ~ /^--[A-Za-z0-9_-]+$/)
      print FILENAME "\t" cand_line "\t" arr[i] "\t" pattern "\t" kind
  reset()
}
{
  if (is_label($0)) {
    flush()
    t = trim($0)
    p = index(t, ")")
    pattern = substr(t, 1, p - 1)
    body = substr(t, p + 1)
    cand_line = NR
    if (body ~ /;;/) flush()
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

# short path for messages: strip $HOME
short() { printf '%s' "${1#"$HOME"/}"; }

# ── C-1 presence + C-2 absence, one tree at a time ──────────────────────────
# sweep_tree ROOT PRESENCE_MODE(fail|warn) DO_ABSENCE(1|0)
sweep_tree() {
  local root="$1" mode="$2" do_abs="$3" label
  label="$(tree_label "$root")"

  if [[ ! -d "$root" ]]; then
    [[ "$MODE" == "both" ]] && printf 'skip  %-22s %s (absent)\n' "$label" "$root"
    return 0
  fi

  local tfiles=0 tarms=0 tmiss=0 _f _out _file line flag _pat _kind rel cmd
  while IFS= read -r _f; do
    tfiles=$((tfiles + 1))

    # ── direction 1: presence (C-1) ──
    if [[ "$mode" != "off" ]]; then
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
        elif [[ -n "${DISPOSITION[$flag]:-}" ]]; then
          # A flag with a boolean arm cannot also demand a row: A-2 gives the
          # boolean side the win, and the value side writes --flag=value.
          [[ "$mode" == "fail" ]] && pass=$((pass + 1))
          printf '  NOTE  %-22s %s:%s  [%s:%s]  not tabled — A-2: boolean wins (see DISPOSITION)\n' \
            "$flag" "$(short "$_file")" "$line" "$label" "$cmd"
          notes=$((notes + 1))
        else
          tmiss=$((tmiss + 1))
          if [[ "$mode" == "fail" ]]; then
            fail=$((fail + 1))
            printf '  FAIL  %-22s %s:%s  [%s:%s]\n' "$flag" "$(short "$_file")" "$line" "$label" "$cmd"
          else
            warn=$((warn + 1))
            printf '  WARN  %-22s %s:%s  [%s:%s]\n' "$flag" "$(short "$_file")" "$line" "$label" "$cmd"
          fi
        fi
      done <<< "$_out"
    fi

    # ── direction 2: absence (C-2 / C-3) ──
    if [[ "$do_abs" == "1" ]]; then
      _out="$(/usr/bin/awk -f "$AWK_INV" "$_f" 2>/dev/null)"
      while IFS=$'\t' read -r _file line flag _pat _kind; do
        [[ -n "${flag:-}" ]] || continue
        [[ -n "${_TABLE[$flag]:-}" ]] || continue     # only tabled flags can collide
        if [[ "$_kind" == "refuse" ]]; then
          # A-2's losing side doing the right thing: refuse the space form by
          # name and name --flag=value. Positive evidence, never a failure.
          printf '  refuse %-21s %s:%s  [%s]  refuses the space form (A-2 obligation met)\n' \
            "$flag" "$(short "$_file")" "$line" "$label"
          refused=$((refused + 1))
          continue
        fi
        if [[ "$_kind" == "empty" ]]; then
          # An ignored flag, not a boolean use. Visible, not a failure.
          printf '  EMPTY %-22s %s:%s  [%s]  arm ignores the flag (no statement)\n' \
            "$flag" "$(short "$_file")" "$line" "$label"
          notes=$((notes + 1))
          continue
        fi
        if [[ -n "${DISPOSITION[$flag]:-}" ]]; then
          disposed=$((disposed + 1))
          printf '  dispo %-22s %s:%s  [%s]\n' "$flag" "$(short "$_file")" "$line" "$label"
        else
          collisions=$((collisions + 1))
          # C-3: a collision is a statement about the TABLE, so it fails from
          # any tree — including an entity tree. Only presence stays warn.
          printf '  COLLIDE %-21s %s:%s  [%s]\n' "$flag" "$(short "$_file")" "$line" "$label"
        fi
      done <<< "$_out"
    fi
  done < <(/usr/bin/find "$root" -type f -name '*.sh' \
             ! -path '*/node_modules/*' ! -path '*/.git/*' 2>/dev/null | LC_ALL=C sort)

  if [[ "$mode" == "fail" ]]; then
    arms=$((arms + tarms))
    [[ "$MODE" == "both" ]] && \
      printf '%-24s %d files, %d consuming arms, %d missing\n' "$label" "$tfiles" "$tarms" "$tmiss"
  elif [[ "$mode" == "warn" ]]; then
    entity_arms=$((entity_arms + tarms))
    # Report-only: stay quiet for entity trees with nothing to say.
    if [[ $tarms -gt 0 || $tmiss -gt 0 ]]; then
      [[ "$MODE" == "both" ]] && \
        printf '%-24s %d files, %d consuming arms, %d missing (report-only)\n' \
          "$label" "$tfiles" "$tarms" "$tmiss"
    fi
  fi
}

# ── C-2b: JS command surfaces that would treat a tabled flag as boolean ─────
# `;;` is a shell construct, so the arm sweep cannot see a JS parser. This is
# the narrow predicate the spec permits (F-11): `has('x')` or
# `includes('--x')` on a tabled flag is a boolean use.
js_collisions() {
  local root file flag hit
  local -a roots=("$KOAD_IO_DIR/commands" "$HOME/.forge/commands")
  shopt -s nullglob
  for _s in "$KOAD_IO_DIR"/skeletons/*/skeleton/commands; do roots+=("$_s"); done
  shopt -u nullglob
  for root in "${roots[@]}"; do
    [[ -d "$root" ]] || continue
    while IFS= read -r file; do
      for flag in "${!DISPOSITION[@]}" "${KOAD_IO_VALUE_FLAGS[@]}"; do
        [[ -n "${_TABLE[$flag]:-}" ]] || continue
        local bare="${flag#--}"
        hit="$(/usr/bin/grep -nE "(has|includes)\(['\"]${flag}['\"]\)" "$file" 2>/dev/null | head -1)"
        [[ -n "$hit" ]] || hit="$(/usr/bin/grep -nE "includes\(['\"]--${bare}['\"]\)" "$file" 2>/dev/null | head -1)"
        [[ -n "$hit" ]] || continue
        if [[ -n "${DISPOSITION[$flag]:-}" ]]; then
          disposed=$((disposed + 1))
          printf '  dispo %-22s %s:%s  [js] (boolean use of a tabled flag)\n' "$flag" "$(short "$file")" "${hit%%:*}"
        else
          collisions=$((collisions + 1))
          printf '  COLLIDE %-21s %s:%s  [js]\n' "$flag" "$(short "$file")" "${hit%%:*}"
        fi
      done
    done < <(/usr/bin/find "$root" -type f \( -name '*.mjs' -o -name '*.js' \) \
               ! -path '*/node_modules/*' ! -path '*/.git/*' 2>/dev/null | LC_ALL=C sort)
  done
}

# ── fail-set: the framework's own trees ─────────────────────────────────────
FAIL_ROOTS=("$KOAD_IO_DIR/commands" "$HOME/.forge/commands")
shopt -s nullglob
for _sk in "$KOAD_IO_DIR"/skeletons/*/skeleton/commands; do
  [[ -d "$_sk" ]] && FAIL_ROOTS+=("$_sk")
done
shopt -u nullglob

# ── every entity / dotdir command tree ──────────────────────────────────────
ENTITY_ROOTS=()
for _d in "$HOME"/.[a-z]*/commands; do
  [[ -d "$_d" ]] || continue
  case "$_d" in
    "$KOAD_IO_DIR/commands"|"$HOME/.forge/commands") continue ;;
  esac
  ENTITY_ROOTS+=("$_d")
done

if [[ "$MODE" == "inverse" ]]; then
  printf 'value-flag table: %d entries — ABSENCE sweep (C-2/C-3), every tree\n\n' \
    "${#KOAD_IO_VALUE_FLAGS[@]}"
  for _root in "${FAIL_ROOTS[@]}"; do sweep_tree "$_root" off 1; done
  for _root in "${ENTITY_ROOTS[@]}"; do sweep_tree "$_root" off 1; done
  js_collisions
else
  printf 'value-flag table: %d entries\n\n' "${#KOAD_IO_VALUE_FLAGS[@]}"
  printf '── C-1 presence (missing row) + C-2 absence (collision) ──\n'
  for _root in "${FAIL_ROOTS[@]}"; do sweep_tree "$_root" fail 1; done
  for _root in "${ENTITY_ROOTS[@]}"; do sweep_tree "$_root" warn 1; done
  js_collisions

  # Parser self-check: a sweep that cannot see a known framework arm is broken,
  # and a green result would be asserting nothing.
  if [[ $arms -eq 0 || $found_canary -eq 0 ]]; then
    echo >&2
    echo "FATAL: sweep did not see --into (framework spawn arm) — parser or roots are wrong" >&2
    echo "       consuming arms scanned: $arms" >&2
    exit 2
  fi
fi

# ── dispositions: report the ledger, and catch entries that went stale ──────
echo
if [[ ${#DISPOSITION[@]} -gt 0 ]]; then
  echo "── dispositions (${#DISPOSITION[@]} tabled flag(s) that are boolean somewhere) ──"
  for _f in $(printf '%s\n' "${!DISPOSITION[@]}" | LC_ALL=C sort); do
    printf '   %-14s %s\n' "$_f" "${DISPOSITION[$_f]}"
  done
fi

echo
if [[ "$MODE" == "inverse" ]]; then
  printf '── %d collision(s), %d disposed, %d refusal arm(s) ──\n' "$collisions" "$disposed" "$refused"
else
  printf '── %d passed, %d failed, %d collision(s) (%d disposed, %d refusal arm(s)) ──\n' \
    "$pass" "$fail" "$collisions" "$disposed" "$refused"
  [[ $warn -gt 0 ]] && echo "   (${warn} entity-tree presence miss(es) across ${entity_arms} arms — report-only)"
  echo "   (${arms} framework/forge/skeleton consuming arms scanned)"
  echo "   (${notes} note(s): ignored arms / A-2 exclusions — see above)"
fi

if [[ $collisions -gt 0 ]]; then
  echo
  echo "A tabled flag is a boolean somewhere. Decide, do not ratchet:" >&2
  echo "  * A flag may not be tabled if any governed layer uses it as a boolean." >&2
  echo "    Boolean wins; the value-taking side refuses the space form and names" >&2
  echo "    --flag=value (VESTA-SPEC-245 A-2)." >&2
  echo "  * If the collision is a command bug (an arm that should consume its" >&2
  echo "    value does not), fix the arm — that is what fixed --entity and --type." >&2
  echo "  * Only if the collision is genuinely unreachable may you add a" >&2
  echo "    DISPOSITION entry, and the reason must say why it cannot be reached." >&2
fi
if [[ $fail -gt 0 ]]; then
  echo
  echo "A consuming arm's flag is not tabled. Do NOT simply add the row:" >&2
  echo "  * either the flag is missing from the table," >&2
  echo "  * or it is value-taking in one layer and boolean in another — check the" >&2
  echo "    other layers before adding it; if it collides, the value-taking side" >&2
  echo "    refuses the space form and names --flag=value (VESTA-SPEC-245 A-2)." >&2
fi

[[ $fail -eq 0 && $collisions -eq 0 ]]
