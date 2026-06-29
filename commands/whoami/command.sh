#!/usr/bin/env bash
# whoami — report identity (entity or system user)
set -euo pipefail

if [ -n "${ENTITY:-}" ]; then
  ENTITY_DIR="$HOME/.$(echo "$ENTITY" | tr '[:upper:]' '[:lower:]')"

  echo "entity:    $ENTITY"
  echo "host:      ${HOSTNAME:-$(hostname)}"
  echo "user:      ${USER:-$(whoami)}"
  echo "home:      $ENTITY_DIR"
  echo "role:      ${KOAD_IO_ENTITY_ROLE:-none}"
  echo "rooted:    ${KOAD_IO_ROOTED:-false}"

  BONDS_DIR="$ENTITY_DIR/trust/bonds"
  if [ -d "$BONDS_DIR" ]; then
    count=$(ls "$BONDS_DIR"/*.md.asc 2>/dev/null | wc -l)
    echo "bonds:     $count active"
  else
    echo "bonds:     0"
  fi
else
  whoami
fi
