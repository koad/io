#!/bin/bash

set -e

if ! command -v whiptail >/dev/null 2>&1; then
    echo "whiptail is required. Install: sudo apt-get install whiptail"
    exit 1
fi

SCRIPT_DIR="${SCRIPT_DIR:-$HOME/.koad-io/commands/configure}"

show_menu() {
    CHOICE=$(whiptail --title "koad:io Configure" --menu "What would you like to configure?" 16 70 5 \
        "kingdom-seed" "Stand up a new kingdom controller (first VPS)" \
        "kingdom-node" "Generate cloud-init for a node joining the kingdom" \
        "daemon"       "Manage daemon services (IPFS, Netbird, etc.)" \
        "exit"         "Exit" \
        3>&1 1>&2 2>&3)

    case $CHOICE in
        kingdom-seed)
            bash "$SCRIPT_DIR/kingdom/seed/command.sh"
            show_menu
            ;;
        kingdom-node)
            bash "$SCRIPT_DIR/kingdom/node/command.sh"
            show_menu
            ;;
        daemon)
            bash "$SCRIPT_DIR/daemon/command.sh"
            show_menu
            ;;
        exit|*)
            echo "Exiting."
            ;;
    esac
}

show_menu
