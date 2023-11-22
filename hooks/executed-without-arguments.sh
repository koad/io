#!/usr/bin/env bash
echo && echo 

# Check if dotenv-cli is installed
if ! command -v dotenv &>/dev/null; then
    echo "dotenv-cli is not installed. Please install it using npm:" >&2
    echo "npm install -g dotenv-cli" >&2
    exit 1
fi

# Drop into a new bash prompt with the entity called forth.
dotenv -e ~/.koad-io/.env -e ~/.$ENTITY/.env bash

# When the user exists the previously launched terminal, reset the terminal window title.
echo -ne "\033]0;${USER} on ${HOSTNAME}\007" && echo
