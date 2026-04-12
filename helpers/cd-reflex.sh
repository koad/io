# cd reflex — context injection in-flow
#
# Owns the cd() wrap for koad:io. Other helpers register functions here
# instead of wrapping cd themselves, so multiple context injectors can
# coexist cleanly under one intercept.
#
# The pattern: when you arrive somewhere (via cd, or future shell-start
# triggers), relevant context is pulled in and surfaced without you having
# to ask. nvm_use_project (node-tools.sh) is the first example — it reads
# the current dir's package.json engines and tells you whether your
# runtime satisfies them. The tickler space-dimension reflex
# (tickler-reflex.sh) is the second — it surfaces path-addressed next
# actions filed for any enabled entity.
#
# Config (all env-driven, cascaded from ~/.koad-io/.env):
#   KOAD_IO_CD_REFLEX        1 (default) to enable, 0 to disable entirely
#   KOAD_IO_QUIET            1 to suppress registration banners
#
# Other helpers gate themselves on their own env vars
# (KOAD_IO_NVM_REFLEX, KOAD_IO_TICKLER_REFLEX, ...) so you can toggle
# each context injector independently.

# Master switch
if [ "${KOAD_IO_CD_REFLEX:-1}" = "0" ]; then
  return 0 2>/dev/null || true
fi

# Registry — declared fresh on each source so re-sourcing bashrc doesn't
# accumulate duplicate hooks
KOAD_IO_CD_HOOKS=()

koad_io_cd_register() {
  local fn="$1"
  if [ -z "$fn" ]; then
    echo "koad_io_cd_register: missing function name" >&2
    return 1
  fi
  KOAD_IO_CD_HOOKS+=("$fn")
  if [ "${KOAD_IO_QUIET:-0}" != "1" ]; then
    echo "koad:io cd-reflex: registered $fn"
  fi
}

koad_io_cd_reflex() {
  local hook
  for hook in "${KOAD_IO_CD_HOOKS[@]}"; do
    "$hook"
  done
}

# The one wrap. Every cd call fires the registered hooks in order.
cd() {
  builtin cd "$@" || return $?
  koad_io_cd_reflex
}
