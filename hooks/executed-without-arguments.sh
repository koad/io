#!/usr/bin/env bash
echo && echo 

if [ -z "$ENTITY" ]; then
  echo "no arguments given, no obvious directive.  exiting..."
  exit 
fi

set -a

source $HOME/.koad-io/.env 
source $HOME/.$ENTITY/.env 

opencode --agent "$ENTITY" --model "$OPENCODE_MODEL" ./
