#!/bin/bash
#
# command.sh — daemon/configure
#
# Summary: Main menu orchestrator for managing daemon services via docker-compose.
# Invoked as: koad-io configure daemon [flags]
#
# Non-interactive usage:
#   configure daemon --service ipfs --action install
#   configure daemon --service netbird --action start
#   configure daemon --service ipfs --action stop
#   configure daemon --service netbird --action status
#   CONFIGURE_SERVICE=ipfs CONFIGURE_ACTION=install configure daemon
#

# Parse non-interactive flags
NON_INTERACTIVE=0
SERVICE_FLAG="${CONFIGURE_SERVICE:-}"
ACTION_FLAG="${CONFIGURE_ACTION:-}"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --service)
            SERVICE_FLAG="$2"
            shift 2
            ;;
        --service=*)
            SERVICE_FLAG="${1#*=}"
            shift
            ;;
        --action)
            ACTION_FLAG="$2"
            shift 2
            ;;
        --action=*)
            ACTION_FLAG="${1#*=}"
            shift
            ;;
        --non-interactive)
            NON_INTERACTIVE=1
            shift
            ;;
        *)
            shift
            ;;
    esac
done

# If service+action given (or NON_INTERACTIVE set), skip TUI.
if [[ -n "$SERVICE_FLAG" && -n "$ACTION_FLAG" ]] || [[ "$NON_INTERACTIVE" -eq 1 && -n "$SERVICE_FLAG" && -n "$ACTION_FLAG" ]]; then
    NON_INTERACTIVE=1
fi

# Function to check if a command exists
check_command() {
  command -v "$1" >/dev/null 2>&1
}

# Check required dependencies (whiptail only required for interactive mode)
check_dependencies() {
  local missing_deps=()

  if [[ "$NON_INTERACTIVE" -eq 0 ]] && ! check_command whiptail; then
    missing_deps+=("whiptail")
  fi

  if ! check_command jq; then
    missing_deps+=("jq")
  fi

  if ! check_command docker; then
    missing_deps+=("docker")
  fi

  if ! check_command docker-compose; then
    missing_deps+=("docker-compose")
  fi

  if [ ${#missing_deps[@]} -gt 0 ]; then
    echo -e "\e[31mError: The following required dependencies are missing:\e[0m"
    for dep in "${missing_deps[@]}"; do
      echo "  - $dep"
    done
    echo -e "\nInstallation instructions:"
    echo -e "  For Ubuntu/Debian:"
    if [[ " ${missing_deps[*]} " == *" whiptail "* ]]; then
      echo "    sudo apt-get install -y whiptail"
    fi
    if [[ " ${missing_deps[*]} " == *" jq "* ]]; then
      echo "    sudo apt-get install -y jq"
    fi
    if [[ " ${missing_deps[*]} " == *" docker "* ]]; then
      echo "    curl -fsSL https://get.docker.com -o get-docker.sh && sudo sh get-docker.sh"
    fi
    if [[ " ${missing_deps[*]} " == *" docker-compose "* ]]; then
      echo "    sudo apt-get install -y docker-compose"
    fi
    echo -e "\n  For macOS (using Homebrew):"
    echo "    brew install jq ncurses docker docker-compose"
    exit 1
  fi
}

check_dependencies

export SCRIPT_DIR="${SCRIPT_DIR:-$HOME/.koad-io/commands/configure/daemon}"
export TOOLING_LOCATION="${TOOLING_LOCATION:-$SCRIPT_DIR/tooling}"
export SERVICES_DIR="${SERVICES_DIR:-$SCRIPT_DIR/services}"
export DAEMON_STATE_DIR="${DAEMON_STATE_DIR:-$HOME/.local/share/koad-io/daemon}"

# Ensure state directory exists
mkdir -p "$DAEMON_STATE_DIR"

state_file="$DAEMON_STATE_DIR/.env"
[[ -f "$state_file" ]] && source "$state_file" || true

# Non-interactive dispatch: --service <name> --action <verb>
if [[ "$NON_INTERACTIVE" -eq 1 ]]; then
    SVC_DIR="$SERVICES_DIR/$SERVICE_FLAG"
    if [[ ! -d "$SVC_DIR" ]]; then
        echo "Unknown service: $SERVICE_FLAG" >&2
        echo "Available: $(ls "$SERVICES_DIR" | tr '\n' ' ')" >&2
        exit 1
    fi
    case "$ACTION_FLAG" in
        install)
            exec bash "$SVC_DIR/install.sh"
            ;;
        start)
            exec bash "$SVC_DIR/start.sh"
            ;;
        stop)
            exec bash "$SVC_DIR/stop.sh"
            ;;
        status)
            exec bash "$SVC_DIR/status.sh"
            ;;
        *)
            echo "Unknown action: $ACTION_FLAG" >&2
            echo "Available: install, start, stop, status" >&2
            exit 1
            ;;
    esac
fi

declare -A options=(
    ["1"]="Configure Services - Enable or disable daemon services."
    ["2"]="Start Services    - Bring up enabled daemon services."
    ["3"]="Stop Services     - Bring down running daemon services."
    ["4"]="Service Status    - Check health of running daemon services."
    ["5"]="Exit              - Exit without making changes."
)

show_menu() {
    CHOICE=$(whiptail --title "koad:io Daemon Configuration Menu" --menu "Choose an option:" 15 80 6 \
        "1" "${options["1"]}" \
        "2" "${options["2"]}" \
        "3" "${options["3"]}" \
        "4" "${options["4"]}" \
        "5" "${options["5"]}" \
        3>&1 1>&2 2>&3)

    case $CHOICE in
        1)
            echo "Launching service configurator..."
            eval "$TOOLING_LOCATION/select-service.sh"
            show_menu
            ;;
        2)
            echo "Starting daemon services..."
            for svc_dir in "$SERVICES_DIR"/*/; do
                svc=$(basename "$svc_dir")
                state_svc="$DAEMON_STATE_DIR/$svc.enabled"
                if [[ -f "$state_svc" ]]; then
                    echo "Starting $svc..."
                    bash "$svc_dir/start.sh"
                fi
            done
            read -n 1 -s -r -p "Press any key to return to menu..."
            show_menu
            ;;
        3)
            echo "Stopping daemon services..."
            for svc_dir in "$SERVICES_DIR"/*/; do
                svc=$(basename "$svc_dir")
                state_svc="$DAEMON_STATE_DIR/$svc.enabled"
                if [[ -f "$state_svc" ]]; then
                    echo "Stopping $svc..."
                    bash "$svc_dir/stop.sh"
                fi
            done
            read -n 1 -s -r -p "Press any key to return to menu..."
            show_menu
            ;;
        4)
            echo "Checking service status..."
            for svc_dir in "$SERVICES_DIR"/*/; do
                svc=$(basename "$svc_dir")
                bash "$svc_dir/status.sh" 2>/dev/null || echo "$svc: status script not found"
            done
            read -n 1 -s -r -p "Press any key to return to menu..."
            show_menu
            ;;
        5)
            echo "Exiting."
            ;;
        *)
            echo "No valid option selected or dialog cancelled."
            ;;
    esac
}

cd "$SCRIPT_DIR"
show_menu
