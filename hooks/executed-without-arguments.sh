#!/usr/bin/env bash

# echo "koad:io entity ran without arguments, so,.. not gonna do anything."
# echo
# echo "but! You can change this behaviour by updating ~/.koad-io/hooks/executed-without-arguments.sh"
# echo "have fun!"

# Drop into a new bash prompt with the entity called forth.
echo && echo && bash

# When the user exists the previously launched terminal, reset the terminal window title.
echo -ne "\033]0;${USER} on ${HOSTNAME}\007" && echo
