#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# argv classification for the koad-io launcher.
#
# THE CONTRACT (VESTA-SPEC-245 §0, A-3)
# ------------------------------------
#   The launcher may remove the command words it resolved. It may not add,
#   drop, or move any other token.
#
# Everything else in the invocation belongs to the command, in the order the
# caller wrote it. This file computes two things and nothing more:
#
#   1. a RESOLUTION VIEW — which leading tokens could be command-directory
#      words (koad_io_split_argv), and
#   2. the EXEC SLICE — the caller's original argv with only those resolved
#      command words removed (koad_io_exec_slice).
#
# WHAT THIS FILE USED TO DO, AND WHY IT STOPPED (2026-11-07)
# ---------------------------------------------------------
# Until SPEC-245 the launcher did a stable PARTITION: every flag token was
# moved behind all the positionals and the exec line appended them
# (`exec cmd "${_REST_ARGS[@]}" "${_flag_args[@]}"`). Nothing was lost, every
# token survived, and the exit code was zero — which is why it looked harmless
# for months. It was not harmless: the partition RELOCATES a value, it never
# mangles one. `profile view --chain a.json b.json` reached the command as
# `b.json --chain a.json`; the boolean `--chain` arm shifted one token, so
# `a.json` was read as a chain file by the `*)` arm. CHAIN_FILES became
# (b.json, a.json): genesis-first over a tip-first chain, exit 0, silent.
#
# A missing table row strands a value in plain sight. A spurious row produces
# a confident wrong answer. SPEC-245 calls that the signature of the class.
#
# THE VALUE-TAKING TABLE IS NOW A LEADING-REGION AID (SPEC-245 A-3.1 / A-5)
# ------------------------------------------------------------------------
# Arity knowledge is consulted ONLY for tokens before the last resolved
# command word. A token after it is data and is never classified by the
# launcher — the command's own `case` statement is the authority for its
# vocabulary. So a global row can no longer collide with a command's tail
# flags: it is simply not read there.
#
# In the leading region a value-taking flag should be written `--flag=value`.
# The table reduces the risk for known flags and is deprecated for the purpose.
#
# KOAD_IO_FLAGS is GONE (SPEC-245 A-5). It was a word-split string: a string
# cannot preserve element boundaries, so a consumer re-applied the partition
# after splitting on whitespace — losing the caller's quoting a second time.
# A command needs its flags in `"$@"`, which now carries every token in the
# caller's order. Do not reintroduce it.
#
# A-'--' IS HONOURED (SPEC-245 m2). When the splitter meets `--`, classification
# STOPS. The `--` token and every token after it are never consulted for
# resolution and never tabled; they are preserved in place by the exec slice.
# Before this a caller had no way to protect a literal that begins with `--`.
#
# WHAT BELONGS IN THE TABLE
# -------------------------
# Only flags a USER can type on the koad-io command line. A line inside a
# command.sh that calls another program — `node ceremony.mjs --handle "$X" …`
# — is a CALL SITE, not an argv surface: the launcher never sees it, so listing
# it here buys nothing and bloats a global table.
# The two look alike in a grep sweep — a call site ending in `)` matches a case
# arm's `--flag)` — so check that the line's body reaches `;;` before believing
# it is an arm.
#
# A flag enters the table only if it takes a value everywhere it appears on a
# real command line. A flag that is sometimes boolean MUST NOT be added: a
# boolean entry eats the next positional, which is the original bug wearing the
# opposite mask. A contested flag loses — boolean wins, and the value-taking
# side writes `--flag=value` (SPEC-245 A-2).
#
# test/argv-value-conformance.test.sh sweeps every tree in both directions:
# presence (a consuming arm must be tabled) and ABSENCE (a tabled flag must not
# have a non-consuming arm anywhere, entity trees included).
#
# Derivation sweep (run from $HOME):
#
#   grep -rn --include='*.sh' -E '^\s*[^()#[:space:]][^()]*\)' \
#     ~/.koad-io/commands ~/.forge/commands \
#   # then keep only arms whose body references $2 / shift 2 / ${2:-…}

KOAD_IO_VALUE_FLAGS=(
  --account --action --arms --authorizing-key --avatar --bio --body
  --budget --budget-tokens --by --cache-dir --category --ceiling --chainpack --consumed
  --context --curator --cwd --cwd-filter --cwd_filter --date
  --days --delegate-to --description --device --device-id --domain
  --due --encrypt-with --endpoint --entity --fence-lines --file --files-archived
  --files-merged --files-read --format --fresh-hours --from --git-dir --home
  --id --index --interval --into --kind --leg --limit
  --local-provider --location --log --max-lines --message --model --model-ceiling
  --model-filter --model_filter --month --name --network --new-key-path --note
  --only --out --out-dir --output --override-requires
  --parent-consumed --parent-plan --parser --passphrase --per-leg --plan --priority
  --profile --psbt --pubkey-base64url --pubkey-path --purpose --query --reason --recovery-dir
  --refs --root --schema --service --sign --signal
  --signing-key --since --skip --snooze-until --source --spec --stage
  --subject --system --ticker --timeout --tip --title
  --to --total --type --until --verbosity --visitor
  --wait --work-tree
)

# koad_io_flag_takes_value FLAG -> 0 if the flag may take the next token as value
koad_io_flag_takes_value() {
  local _f="$1" _v
  for _v in "${KOAD_IO_VALUE_FLAGS[@]}"; do
    [[ "$_f" == "$_v" ]] && return 0
  done
  return 1
}

# koad_io_split_argv ARGS...
#   Populates three caller-visible arrays:
#     _koad_io_positional_args  — tokens eligible to be command-directory words
#                                 (everything before `--` that is not a flag)
#     _koad_io_positional_index — the ORIGINAL argv index of each of those, so
#                                 the exec slice can remove exactly those tokens
#     _koad_io_flag_args        — flag tokens before `--`, with a value-taking
#                                 flag's value paired in (diagnostics + DRY_RUN)
#
#   Nothing is reordered and nothing is dropped. `--` and everything after it
#   are deliberately in none of these arrays: they are data, and the exec slice
#   preserves them in place.
koad_io_split_argv() {
  _koad_io_positional_args=()
  _koad_io_positional_index=()
  _koad_io_flag_args=()
  local _i=1 _arg _next_i _next _fenced=0
  while [[ $_i -le $# ]]; do
    _arg="${!_i}"
    if (( _fenced )); then
      # Past `--`: classify nothing. The token stays where the caller put it.
      :
    elif [[ "$_arg" == "--" ]]; then
      _fenced=1
    elif [[ "$_arg" == --*=* ]]; then
      # --key=value form: already self-contained, no lookahead needed
      _koad_io_flag_args+=("$_arg")
    elif [[ "$_arg" == --* ]]; then
      _next_i=$((_i + 1))
      _next="${!_next_i:-}"
      # Absorb the next token as the value ONLY for a known value-taking flag.
      # A boolean or unknown flag never eats a positional (the 2026-11-03 bug).
      # A value may begin with a single '-' (e.g. -5); only '--' is a flag, and
      # `--` itself is the fence, so it is never absorbed.
      if koad_io_flag_takes_value "$_arg" && [[ -n "$_next" && "$_next" != --* ]]; then
        _koad_io_flag_args+=("$_arg" "$_next")
        _i=$((_i + 1))
      else
        _koad_io_flag_args+=("$_arg")
      fi
    else
      _koad_io_positional_args+=("$_arg")
      _koad_io_positional_index+=("$_i")
    fi
    _i=$((_i + 1))
  done
}

# koad_io_exec_slice CONSUMED ARGS...
#   CONSUMED = how many leading POSITIONAL tokens resolution consumed.
#   Populates:
#     _koad_io_exec_args     — the caller's argv, in the caller's order, minus
#                              exactly those consumed command words
#     _koad_io_consumed_args — the command words that were removed
#   Requires _koad_io_positional_index from koad_io_split_argv on the SAME argv.
#
#   This is the only transformation the launcher is allowed to perform
#   (SPEC-245 A-3). It removes; it does not add, drop, or move.
koad_io_exec_slice() {
  local _consumed="${1:-0}"
  (( $# )) && shift
  _koad_io_exec_args=()
  _koad_io_consumed_args=()
  local -a _drop=()
  local _k _i _is_drop _idx

  for ((_k=0; _k<_consumed; _k++)); do
    _idx="${_koad_io_positional_index[$_k]:-}"
    [[ -n "$_idx" ]] || continue
    _drop+=("$_idx")
    _koad_io_consumed_args+=("${!_idx}")
  done

  for ((_i=1; _i<=$#; _i++)); do
    _is_drop=0
    for _k in ${_drop[@]+"${_drop[@]}"}; do
      [[ "$_i" == "$_k" ]] && { _is_drop=1; break; }
    done
    (( _is_drop )) || _koad_io_exec_args+=("${!_i}")
  done
}
