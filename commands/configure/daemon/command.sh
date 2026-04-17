#!/bin/bash
#
# command.sh — daemon/configure
#
# Summary: Main menu orchestrator for managing daemon services via docker-compose.
# Invoked as: koad-io daemon configure  OR  juno daemon configure
#

# Function to check if a command exists
check_command() {
  command -v "$1" >/dev/null 2>&1
}

# Check required dependencies
check_dependencies() {
  local missing_deps=()

  if ! check_command whiptail; then
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
[[ -f "$state_file" ]] && source "$state_file" || echo "Warning: No daemon state file found (.env)"

echo "Script directory:   $SCRIPT_DIR"
echo "Services directory: $SERVICES_DIR"
echo "Tooling location:   $TOOLING_LOCATION"
echo "State directory:    $DAEMON_STATE_DIR"

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
