#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# argv classification for the koad-io launcher.
#
# WHY THIS FILE EXISTS (2026-11-03)
# ---------------------------------
# bin/koad-io separates leading flags from positional command words so the
# cascade can resolve a command by directory. The old inline loop treated EVERY
# `--token` as value-taking: it absorbed the next non-flag token as the flag's
# value. A boolean — or entirely unknown — flag therefore ate the command word:
#
#   koad-io --debug kingdom whoami   -> parsed as --debug=kingdom, ran `whoami`
#   koad-io --dry-run kingdom project list -> command became `project`, exit 66
#   koad-io --debug kingdom          -> no positional left, printed the banner
#
# `--debug` is not a flag at all (debug is switched on by the DEBUG env var);
# the class is any unknown leading flag silently re-routing the command.
#
# THE FIX
# -------
# A flag consumes the next token ONLY if it is in the value-taking set below.
# Everything else — known booleans AND unknown flags — is boolean and never
# consumes a positional. Unknown flags pass through as boolean (inert at worst).
#
# THE VALUE-TAKING SET IS DERIVED, NOT GUESSED
# --------------------------------------------
# Every entry below appears in a command's argv parser as a case arm that
# consumes the NEXT token (`"$2"`, `shift 2`, `${2:-…}`) rather than the
# self-contained `--flag=value` form. Derivation sweep (run from $HOME):
#
#   grep -rn --include='*.sh' -E '^\s*[^()#[:space:]][^()]*\)' \
#     ~/.koad-io/commands ~/.forge/commands \
#   # then keep only arms whose body references $2 / shift 2 / ${2:-…}
#
# plus the separate-value flags of the JavaScript command surfaces
# (session/list/report.mjs, status/bonds, chat/bonds-guard-cli, git/scope-gate).
#
# `--flag=value` needs no lookahead (the splitter handles it before consulting
# this table) and is therefore NOT listed. Flags that are booleans everywhere
# (`--local`, `--attach`, `--dry-run`, `--json`, `--force`, `--quiet`, …) are
# NOT listed. When a command grows a new value-taking flag, add it here; a
# missing entry degrades to boolean, which turns its value into a positional.
#
# WHAT BELONGS HERE (learned the hard way, 2026-11-06)
# ---------------------------------------------------
# Only flags a USER can type on the koad-io command line. A line inside a
# command.sh that calls another program — `node ceremony.mjs --handle "$X" ...`
# — is a CALL SITE, not an argv surface: the launcher never sees it, so listing
# it here buys nothing and bloats a global table.
# The two look alike in a grep sweep — a call site ending in `)` matches a case
# arm's `--flag)` — so check that the line's body reaches `;;` before believing
# it is an arm.
#
# A flag is ADDED only when it takes a value everywhere it appears on a real
# command line. A flag that is sometimes boolean (`--skip`, `--plan`) must not be
# added "just in case": a boolean entry eats the next positional, which is the
# original bug wearing the opposite mask.
#
# 2026-11-06 audit (framework + forge + skeletons, shell arms and the JS command
# surfaces that receive "$@") added the user-facing value flags that were
# missing: --arms, --category, --format, --max-lines, --month, --parser,
# --schema, --verbosity. Deliberately NOT added (call sites, not argv surfaces):
# --handle, --host, --leaf-fingerprint, --mnemonic, --sigchain-head,
# --sovereign-device-key-path, --userid, --asc, --md, --expect-from.
#
# 2026-11-07 audit (from rooty's ecoincore conformance sweep): added the 18
# user-facing value flags the ~/.ecoincore command tree consumes and the table
# lacked, which made those commands STRAND their values through the launcher
# (not merely degraded — e.g. `export xprv`, `psbt create|sign|finalize`,
# `import xprv`, `{init,set,inspect} chainpack`, `configure blockchains
# --device`): --account, --by, --chainpack, --curator, --device, --encrypt-with,
# --endpoint, --from, --index, --log, --network, --passphrase, --psbt,
# --purpose, --query, --source, --spec, --ticker. Every one is a `shift 2` arm
# documented in its own usage block; each was grep-verified to have no boolean
# use in ~/.koad-io/commands or ~/.forge/commands. --passphrase has a boolean
# use in ~/.dotfiles/commands/identity/init, but that command takes zero
# positional operands, so the row cannot eat a value there (verified by
# simulating every invocation); operator approved the row.
# Deliberately NOT added (== BOOLEAN in the forge, a row would eat a
# positional): --chain (profile view/verify mode switch), --tail (start),
# --paths (tickler board). Those commands fail loudly on the space form and
# name the working --flag=value form instead.
#
# test/argv-leading-flag.test.sh pins the three reproduced failures plus the
# value-taking / boolean / `-`-leading-value cases.
#
# LONG-RUN SHAPE (NOT THIS CHANGE): resolve the command first, then hand it the
# remainder to parse with its own `--flag value` rules. That removes the need
# for a global table. Not done here — rewriting argv parsing in a working
# launcher is more risk than the bug it fixes.

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

# koad_io_flag_takes_value FLAG -> 0 if the flag expects the next token as value
koad_io_flag_takes_value() {
  local _f="$1" _v
  for _v in "${KOAD_IO_VALUE_FLAGS[@]}"; do
    [[ "$_f" == "$_v" ]] && return 0
  done
  return 1
}

# koad_io_split_argv ARGS...
#   Populates two caller-visible arrays:
#     _koad_io_positional_args — positional tokens (command words + their args)
#     _koad_io_flag_args       — flag tokens; values of value-taking flags are
#                                paired in so whitespace survives to exec
koad_io_split_argv() {
  _koad_io_positional_args=()
  _koad_io_flag_args=()
  local _i=1 _arg _next_i _next
  while [[ $_i -le $# ]]; do
    _arg="${!_i}"
    if [[ "$_arg" == --*=* ]]; then
      # --key=value form: already self-contained, no lookahead needed
      _koad_io_flag_args+=("$_arg")
    elif [[ "$_arg" == --* ]]; then
      _next_i=$((_i + 1))
      _next="${!_next_i:-}"
      # Absorb the next token as the value ONLY for a known value-taking flag.
      # A boolean or unknown flag never eats a positional (the bug this fixes).
      # A value may begin with a single '-' (e.g. -5); only '--' is a flag.
      if koad_io_flag_takes_value "$_arg" && [[ -n "$_next" && "$_next" != --* ]]; then
        _koad_io_flag_args+=("$_arg" "$_next")
        _i=$((_i + 1))
      else
        _koad_io_flag_args+=("$_arg")
      fi
    else
      _koad_io_positional_args+=("$_arg")
    fi
    _i=$((_i + 1))
  done
}
