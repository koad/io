#!/bin/bash

set -e

SCRIPT_DIR="${SCRIPT_DIR:-$HOME/.koad-io/commands/configure}"

# Sub-command dispatch: if an argument is given, route directly without whiptail.
# Usage: configure kingdom seed [flags...]
#        configure kingdom node [flags...]
#        configure daemon [flags...]
if [[ $# -gt 0 ]]; then
    SUBCMD="$1"
    shift
    case "$SUBCMD" in
        kingdom)
            SUBCMD2="${1:-}"
            shift 2>/dev/null || true
            case "$SUBCMD2" in
                seed)
                    exec bash "$SCRIPT_DIR/kingdom/seed/command.sh" "$@"
                    ;;
                node)
                    exec bash "$SCRIPT_DIR/kingdom/node/command.sh" "$@"
                    ;;
                *)
                    echo "Unknown sub-command: configure kingdom $SUBCMD2"
                    echo "Available: seed, node"
                    exit 1
                    ;;
            esac
            ;;
        daemon)
            exec bash "$SCRIPT_DIR/daemon/command.sh" "$@"
            ;;
        *)
            echo "Unknown sub-command: configure $SUBCMD"
            echo "Available: kingdom seed, kingdom node, daemon"
            exit 1
            ;;
    esac
fi

# Interactive mode — whiptail required.
if ! command -v whiptail >/dev/null 2>&1; then
    echo "Interactive menu requires whiptail. Install: sudo apt-get install whiptail"
    echo ""
    echo "Or invoke directly:"
    echo "  configure kingdom seed [--stdout | --output <path>] [--domain <domain>]"
    echo "  configure kingdom node [--stdout | --output <path>]"
    echo "  configure daemon [--service <name>] [--action install|start|stop|status]"
    exit 1
fi

show_menu() {
    CHOICE=$(whiptail --title "koad:io Configure" --menu "What would you like to configure?" 16 70 4 \
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
