#!/usr/bin/env bash
# Regression test — ~/.koad-io/harness/startup.sh session-preamble git truth.
#
# Guards commit b7935cd, which fixed two defects in the two preamble git-status
# blocks (entity repo ¶ and working dir ¶):
#
#   (1) LOCK  — every git call runs with GIT_OPTIONAL_LOCKS=0, so an
#               observational read never refreshes the stat cache and never
#               takes .git/index.lock. Unguarded, the preamble collides with a
#               concurrent entity add/commit.
#   (2) TRUTH — the exit status of status / rev-list / log is checked, so a
#               FAILED git renders `unknown` — never a confident `clean`. The
#               inability to answer is not an answer.
#
# Why a committed test: both defects are INVISIBLE when they regress. A reverted
# lock guard silently re-takes the index lock; a re-added unchecked
# `_status="$(git …)"` re-introduces the `set -e` abort that truncates the WHOLE
# preamble — everything after `## Git Status` is lost (branch line, primitives,
# daemon, flights, questions, tickles, inbox, KOAD_IO.md, ENTITY.md, the PRIMER).
# The entity wakes with a half-built prompt. Nothing throws; nothing logs.
#
# Discipline (matches ~/.forge/harness/test/unit/git-poll-index-lock.test.ts):
#   * exercise the REAL startup.sh end-to-end — not a copy of its logic;
#   * assert the POSITIVE observable (`unknown`, index byte-identical);
#   * carry a NEGATIVE CONTROL that BITES — a de-guarded / pre-fix whole file
#     must fail the same assertions, proving each guard is load-bearing.
#
# Run:
#   bash ~/.koad-io/harness/test/startup-git-truth.test.sh
#
# Env:
#   STARTUP_SH        — source under test (default: ~/.koad-io/harness/startup.sh)
#   PREFIX_STARTUP_SH — explicit pre-fix copy (default: a de-guard transform of
#                       STARTUP_SH, falling back to git history b7935cd^)
#
# Self-contained: builds its own scratch $HOME + repos under mktemp; depends on
# no pre-existing /tmp artifact; no interactivity; safe in CI / a detached
# flight. Exits non-zero if any check fails.
#
# Author: vulcan · layer: ~/.koad-io/harness (framework loading layer).

set -u

# --- Resolve the source under test (absolute) --------------------------------
REAL="${STARTUP_SH:-$HOME/.koad-io/harness/startup.sh}"
REAL="$(cd "$(dirname "$REAL")" 2>/dev/null && pwd)/$(basename "$REAL")" || true
REAL_GIT="$(command -v git || true)"

if [ ! -f "$REAL" ]; then
  echo "FATAL: source under test not found: $REAL" >&2
  exit 2
fi
if [ -z "$REAL_GIT" ]; then
  echo "FATAL: git not found on PATH" >&2
  exit 2
fi

PASS=0; FAIL=0
ok(){ printf '  PASS: %s\n' "$1"; PASS=$((PASS+1)); }
no(){ printf '  FAIL: %s\n' "$1"; FAIL=$((FAIL+1)); }
banner(){ printf '\n=== %s ===\n' "$1"; }

SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/startup-git-truth.XXXXXX")"
cleanup(){ rm -rf "$SCRATCH"; }
trap cleanup EXIT

echo "source under test: $REAL"
echo "sha256:            $(sha256sum "$REAL" | cut -d' ' -f1)"

# --- Fixtures ----------------------------------------------------------------
# $1 dir  $2 bare-remote — a repo at the origin with one pushed commit.
make_repo(){
  local d="$1" r="$2"
  mkdir -p "$d"
  "$REAL_GIT" -C "$d" init -q -b main
  echo "line" > "$d/f1.txt"
  "$REAL_GIT" -C "$d" -c user.email=t@t -c user.name=t add -A
  "$REAL_GIT" -C "$d" -c user.email=t@t -c user.name=t commit -qm init
  "$REAL_GIT" init -q --bare "$r"
  "$REAL_GIT" -C "$d" remote add origin "$r"
  "$REAL_GIT" -C "$d" push -q -u origin main
}

# Run a preamble; leaves RP_EC = exit code, RP_OUT = stdout.
# $1 script  $2 entity  $3 scratch-home  $4 work-dir  [$5 path-prefix stub dir]
RP_EC=0; RP_OUT=""
run_preamble(){
  local script="$1" ent="$2" h="$3" wd="$4" pp="${5:-}" path="$PATH"
  [ -n "$pp" ] && path="$pp:$PATH"
  RP_OUT="$(env -i HOME="$h" PATH="$path" ENTITY="$ent" CWD="$wd" \
        KOAD_IO_STARTUP_LIGHT=1 KOAD_IO_DIR="$h/.koad-io-empty" \
        bash "$script" 2>/dev/null)"; RP_EC=$?
  return 0
}

# --- Pre-fix / de-guarded whole file -----------------------------------------
# Prefer a transform of the LIVE file (proves the CURRENT guard is
# load-bearing); fall back to the historical b7935cd^ artifact. The transform
# strips the GIT_OPTIONAL_LOCKS=0 guard and unwraps the two guarded status
# assignments back to the unchecked pre-fix form (`_status="$(git …)"`), which
# is what re-introduces the `set -e` abort under a failing git.
deguard(){ python3 - "$1" <<'PY'
import re, sys
src = open(sys.argv[1]).read()
src = src.replace('GIT_OPTIONAL_LOCKS=0 ', '')          # drop the lock guard
pat = re.compile(
    r'if (_w?status)="\$\((?P<cmd>[^)]*)\)"; then\n'
    r'\s*_w?status_ok=1\n\s*else\n\s*_w?status_ok=0\n\s*fi'
)
src, n = pat.subn(lambda m: '%s="$(%s)"' % (m.group(1), m.group('cmd')), src)
if n != 2:
    sys.stderr.write('deguard: expected 2 status-guard unwraps, got %d\n' % n)
    sys.exit(3)
sys.stdout.write(src)
PY
}

PREFIX_FILE=""; PREFIX_ORIGIN=""
if [ -n "${PREFIX_STARTUP_SH:-}" ] && [ -f "$PREFIX_STARTUP_SH" ]; then
  PREFIX_FILE="$PREFIX_STARTUP_SH"; PREFIX_ORIGIN="env override"
elif deguard "$REAL" > "$SCRATCH/prefix-deguard.sh" 2>"$SCRATCH/deguard.err"; then
  PREFIX_FILE="$SCRATCH/prefix-deguard.sh"; PREFIX_ORIGIN="de-guard transform of the live file"
elif _g="$(git -C "$(dirname "$REAL")" show "b7935cd^:harness/startup.sh" 2>/dev/null)" && [ -n "$_g" ]; then
  printf '%s' "$_g" > "$SCRATCH/prefix-git.sh"
  PREFIX_FILE="$SCRATCH/prefix-git.sh"; PREFIX_ORIGIN="git history b7935cd^"
fi
echo "pre-fix control:   ${PREFIX_FILE:-<unresolved>} (${PREFIX_ORIGIN:-none})"

# --- Structural: the guards are present in the live file ---------------------
# Cheap and bites directly: revert either half and this count changes.
banner "STRUCTURAL: live-file guards present"
G=$(grep -c 'GIT_OPTIONAL_LOCKS=0 git' "$REAL" || true)
[ "$G" = "8" ] && ok "all 8 git calls carry GIT_OPTIONAL_LOCKS=0 (got $G)" \
              || no "expected 8 GIT_OPTIONAL_LOCKS=0 git guards, got $G"
GS=$(grep -cE 'if _w?status="\$\(GIT_OPTIONAL_LOCKS=0 git ' "$REAL" || true)
[ "$GS" = "2" ] && ok "both status blocks check the exit status via 'if _status=\$(…)' (got $GS)" \
               || no "expected 2 guarded status assignments, got $GS"
if grep -qE '^[[:space:]]*_w?status="\$\(git ' "$REAL"; then
  no "unchecked '_status=\$(git …)' assignment present (reverted truth half)"
else
  ok "no unchecked '_status=\$(git …)' assignment (truth half intact)"
fi

# --- T1: failure half — git forced to fail -----------------------------------
banner "T1: FAILURE half — git fails → 'unknown', exit 0, never 'clean'"
STUB="$SCRATCH/stub"; mkdir -p "$STUB"
printf '#!/usr/bin/env bash\nexit 1\n' > "$STUB/git"; chmod +x "$STUB/git"
H1="$SCRATCH/h1"; make_repo "$H1/.vent" "$H1/remote.git"
run_preamble "$REAL" vent "$H1" "$H1/.vent" "$STUB"; ec="$RP_EC"; out="$RP_OUT"
[ "$ec" = "0" ] && ok "guarded preamble exits 0 with git broken" \
               || no "guarded preamble exit=$ec (expected 0)"
echo "$out" | grep -q 'branch: `unknown`' && \
  ok "branch → 'unknown'" || no "branch not 'unknown'"
echo "$out" | grep -q 'working tree: unknown (git status failed)' && \
  ok "working tree → 'unknown (git status failed)'" || no "working tree not 'unknown'"
echo "$out" | grep -q 'commits ahead of origin: unknown (rev-list failed)' && \
  ok "commits ahead → 'unknown (rev-list failed)'" || no "ahead not 'unknown'"
echo "$out" | grep -q 'last commit: `unknown`' && \
  ok "last commit → 'unknown'" || no "last commit not 'unknown'"
echo "$out" | grep -qi 'working tree: clean' && \
  no "guarded preamble printed 'clean' on a failed git read" \
  || ok "guarded preamble did NOT print 'clean'"

# --- T2a: negative control — the de-guarded four lines read CLEAN ------------
banner "T2a: NEGATIVE CONTROL — de-guarded status lines read CLEAN (bites)"
cat > "$SCRATCH/snip-guarded.sh" <<'SH'
set -euo pipefail
if _s="$(false 2>/dev/null)"; then _ok=1; else _ok=0; fi
if [ "$_ok" = "0" ]; then echo UNKNOWN; elif [ -z "$_s" ]; then echo CLEAN; else echo DIRTY; fi
echo REACHED-END
SH
cat > "$SCRATCH/snip-deguarded.sh" <<'SH'
_s="$(false 2>/dev/null)"
if [ -z "$_s" ]; then echo CLEAN; else echo DIRTY; fi
echo REACHED-END
SH
gsnip="$(bash "$SCRATCH/snip-guarded.sh" 2>/dev/null || true)"
dsnip="$(bash "$SCRATCH/snip-deguarded.sh" 2>/dev/null || true)"
echo "$gsnip" | grep -q UNKNOWN && ok "guarded snippet → UNKNOWN" \
                                || no "guarded snippet did not render UNKNOWN"
echo "$gsnip" | grep -q REACHED-END && ok "guarded snippet reaches the end" \
                                    || no "guarded snippet stopped early"
echo "$dsnip" | grep -q CLEAN && ok "de-guarded snippet → CLEAN (the check is load-bearing)" \
                              || no "de-guarded snippet did not flip to CLEAN"

# --- T2b: negative control — the whole pre-fix file ABORTS -------------------
banner "T2b: NEGATIVE CONTROL — pre-fix whole file ABORTS (set -e, zero git lines)"
if [ -z "$PREFIX_FILE" ]; then
  no "pre-fix control unresolved — cannot prove the truncation mode bites"
else
  PG=$(grep -c 'GIT_OPTIONAL_LOCKS' "$PREFIX_FILE" || true)
  [ "$PG" = "0" ] && ok "pre-fix control is genuinely de-guarded (0 lock guards)" \
                  || no "pre-fix control still carries $PG lock guard(s)"
  run_preamble "$PREFIX_FILE" vent "$H1" "$H1/.vent" "$STUB"; pec="$RP_EC"; pout="$RP_OUT"
  [ "$pec" != "0" ] && ok "pre-fix whole file exits non-zero under set -e (got $pec)" \
                    || no "pre-fix whole file exited 0 (expected abort)"
  GLINES="$(echo "$pout" | grep -cE 'branch:|working tree:|last commit:' || true)"
  [ "$GLINES" = "0" ] && ok "pre-fix renders ZERO git lines (preamble truncated)" \
                      || no "pre-fix rendered $GLINES git line(s) (expected 0)"
  echo "$pout" | grep -q '## Git Status' && \
    ok "pre-fix truncates immediately after '## Git Status'" \
    || no "pre-fix output missing the '## Git Status' header"
fi

# --- T3: lock half -----------------------------------------------------------
banner "T3: LOCK half — guarded read does not rewrite .git/index"
# The guarded check and its control run on SEPARATE fresh repos: a guarded run
# that (wrongly) refreshes the index would otherwise leave the control repo's
# stat cache satisfied and mask the control. Isolation keeps each honest.
H2="$SCRATCH/h2"; make_repo "$H2/.vent" "$H2/remote.git"; R="$H2/.vent"
ih(){ sha256sum "$R/.git/index" | cut -d' ' -f1; }
# Make the index stat cache stale so a refresh is genuinely pending.
touch -d "2020-01-01T00:00:00Z" "$R/f1.txt"
b="$(ih)"
run_preamble "$REAL" vent "$H2" "$R"
a="$(ih)"
[ "$b" = "$a" ] && ok "guarded preamble did NOT rewrite .git/index" \
               || no "guarded preamble rewrote .git/index (lock guard missing?)"
[ -e "$R/.git/index.lock" ] && no "guarded preamble left .git/index.lock behind" \
                            || ok "guarded preamble left no .git/index.lock"
# Control (fresh repo): the raw, unguarded read DOES rewrite the index — the
# assertion is sensitive, not a no-op.
H2C="$SCRATCH/h2c"; make_repo "$H2C/.vent" "$H2C/remote.git"; RC="$H2C/.vent"
ihc(){ sha256sum "$RC/.git/index" | cut -d' ' -f1; }
touch -d "2020-01-01T00:00:00Z" "$RC/f1.txt"; cb="$(ihc)"
"$REAL_GIT" -C "$RC" status --porcelain >/dev/null 2>&1; ca="$(ihc)"
[ "$cb" != "$ca" ] && ok "control bites: unguarded \`git status\` rewrote the index" \
                  || no "control did not rewrite the index (assertion is a no-op)"

# --- T4: normal rendering ----------------------------------------------------
banner "T4: NORMAL — clean / dirty / unpushed"
H3="$SCRATCH/h3"; make_repo "$H3/.vent" "$H3/remote.git"; R3="$H3/.vent"
run_preamble "$REAL" vent "$H3" "$R3"; oc="$RP_OUT"
echo "$oc" | grep -q 'working tree: clean' && ok "clean tree → 'clean'" \
                                          || no "clean tree not rendered as 'clean'"
[ -e "$R3/.git/index.lock" ] && no "normal run left .git/index.lock" \
                            || ok "normal run left no .git/index.lock"
echo dirty >> "$R3/f1.txt"
run_preamble "$REAL" vent "$H3" "$R3"; od="$RP_OUT"
echo "$od" | grep -q 'working tree: dirty' && ok "dirty tree → 'dirty'" \
                                          || no "dirty tree not rendered as 'dirty'"
echo "$od" | grep -q 'M f1.txt' && ok "dirty tree → porcelain listing present" \
                               || no "dirty tree missing the porcelain listing"
"$REAL_GIT" -C "$R3" -c user.email=t@t -c user.name=t commit -qam x
run_preamble "$REAL" vent "$H3" "$R3"; oa="$RP_OUT"
echo "$oa" | grep -q '1 commits ahead of origin' && \
  ok "unpushed commit → '**1 commits ahead of origin**'" \
  || no "unpushed commit not rendered as ahead"

# --- Summary -----------------------------------------------------------------
printf '\n=== SUMMARY: %d passed, %d failed ===\n' "$PASS" "$FAIL"
[ "$FAIL" = "0" ]
