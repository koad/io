#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# spinner.sh — shared busy-wait animation primitives
#
# Source this file from any command that needs a visual spinner:
#   source "$HOME/.koad-io/helpers/spinner.sh"
#
# Provides:
#   spinner PID     — animate while PID is alive
#   pause [SECS]    — decorative delay with spinner (skipped in quiet mode)
#   cursorBack N    — move cursor back N columns
#
# Respects:
#   KOAD_IO_QUIET=1        — skip all animation, just wait
#   KOAD_IO_BUSY_CURSOR    — override the braille character sequence
#
# The default sequence builds up braille dots, peaks at full, then fades
# back down — a breathing cycle. Each frame is one 3-byte UTF-8 braille
# character at ~60ms.

if [ -z "${KOAD_IO_BUSY_CURSOR+x}" ]; then
  KOAD_IO_BUSY_CURSOR='⠁⠂⠠⢀⡀⠄⠐⠈⠃⠢⢠⣀⡄⠔⠘⠉⠣⢢⣠⣄⡔⠜⠙⠋⢣⣢⣤⣔⡜⠝⠛⠫⣣⣦⣴⣜⡝⠟⠻⢫⣧⣶⣼⣝⡟⠿⢻⣫⣷⣾⣽⣟⡿⢿⣻⣯⣧⣶⣼⣝⡟⠿⢻⣫⣣⣦⣴⣜⡝⠟⠻⢫⢣⣢⣤⣔⡜⠝⠛⠫⠣⢢⣠⣄⡔⠜⠙⠋⠃⠢⢠⣀⡄⠔⠘⠉'
fi

SPINNER_POS=0

function cursorBack() {
  echo -en "\033[$1D"
}

function spinner() {
  local LC_CTYPE=C
  local pid=$1
  local SLICE_SIZE=3

  if [[ "$KOAD_IO_QUIET" == "1" ]]; then
    wait $pid
    return $?
  fi

  tput civis
  while kill -0 $pid 2>/dev/null; do
    SPINNER_POS=$(((SPINNER_POS + $SLICE_SIZE) % ${#KOAD_IO_BUSY_CURSOR}))
    printf "%s" "${KOAD_IO_BUSY_CURSOR:$SPINNER_POS:$SLICE_SIZE}"
    cursorBack 1
    sleep .06
  done
  tput cnorm
  wait $pid
  return $?
}

function pause() {
  local duration=${1:-1}
  if [[ "$KOAD_IO_QUIET" == "1" ]]; then
    return 0
  fi
  sleep "$duration" & spinner $!
}

function _spinner_shutdown() {
  [[ "$KOAD_IO_QUIET" != "1" ]] && tput cnorm 2>/dev/null
}
