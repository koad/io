#!/bin/bash
#
# configure-service.sh
#
# Summary: Takes a selected service name, presents a whiptail checklist for
# enabling/disabling components, saves state, and optionally triggers install.
#

error_exit() {
    echo -e "\e[31m$1\e[0m" >&2
    exit 64
}

if [ "$#" -ne 1 ]; then
    echo "Usage: $0 <service_name>"
    exit 1
fi

SERVICE_NAME="$1"
SERVICE_DIR="$SERVICES_DIR/$SERVICE_NAME"
SERVICE_JSON="$SERVICE_DIR/service.json"
STATE_FILE="$DAEMON_STATE_DIR/$SERVICE_NAME.state"
ENABLED_FLAG="$DAEMON_STATE_DIR/$SERVICE_NAME.enabled"

if [[ ! -d "$SERVICE_DIR" ]]; then
    error_exit "Service directory not found: $SERVICE_DIR"
fi

if [[ ! -f "$SERVICE_JSON" ]]; then
    error_exit "service.json not found: $SERVICE_JSON"
fi

MENU_HEIGHT=24
MENU_WIDTH=104
MENU_LIST_HEIGHT=16

SERVICE_DISPLAY_NAME=$(jq -r '.name // "'"$SERVICE_NAME"'"' "$SERVICE_JSON")
SERVICE_VERSION=$(jq -r '.version // "unknown"' "$SERVICE_JSON")

echo "Configuring: $SERVICE_DISPLAY_NAME ($SERVICE_VERSION)"
echo "State file: $STATE_FILE"

# Source existing state if present
[[ -f "$STATE_FILE" ]] && source "$STATE_FILE"

# Service-specific component options — extensible per service
# Each service can provide a components.json to override; fall back to defaults
if [[ -f "$SERVICE_DIR/components.json" ]]; then
    # Build OPTIONS from components.json: array of {id, description, default}
    mapfile -t component_ids < <(jq -r '.[].id' "$SERVICE_DIR/components.json")
    mapfile -t component_descs < <(jq -r '.[].description' "$SERVICE_DIR/components.json")
    mapfile -t component_defaults < <(jq -r '.[].default' "$SERVICE_DIR/components.json")

    OPTIONS=()
    for i in "${!component_ids[@]}"; do
        OPTIONS+=("${component_ids[$i]}" "${component_descs[$i]}" "${component_defaults[$i]}")
    done
else
    # Fallback: generic enable/disable for the whole service
    OPTIONS=(
        "enabled" "Enable this service on startup" "ON"
    )
fi

# Load saved state — override defaults with saved values
load_state_for_item() {
    local item="$1"
    local default="$2"
    local varname="COMPONENT_$(echo "$item" | tr '[:lower:]-' '[:upper:]_')"
    if [[ -n "${!varname}" ]]; then
        echo "${!varname}"
    else
        echo "$default"
    fi
}

MENU_ARGS=()
for ((i = 0; i < ${#OPTIONS[@]}; i+=3)); do
    item="${OPTIONS[$i]}"
    desc="${OPTIONS[$i+1]}"
    default="${OPTIONS[$i+2]}"
    state=$(load_state_for_item "$item" "$default")
    printf -v padded_desc "%-70s" "$desc"
    MENU_ARGS+=("$item" "$padded_desc" "$state")
done

WHIPTAIL_CMD="whiptail --title \"koad:io — Configure: $SERVICE_DISPLAY_NAME\" \
    --checklist \"Select components to enable for $SERVICE_DISPLAY_NAME $SERVICE_VERSION:\" \
    $MENU_HEIGHT $MENU_WIDTH $MENU_LIST_HEIGHT \
    $(printf '"%s" "%s" "%s" ' "${MENU_ARGS[@]}") \
    3>&1 1>&2 2>&3"

SELECTED=$(eval "$WHIPTAIL_CMD")

if [ $? -ne 0 ]; then
    echo "Cancelled."
    exit 0
fi

# Save state
mkdir -p "$DAEMON_STATE_DIR"
> "$STATE_FILE"

for item in "${!OPTIONS[@]}"; do
    :
done

# Write selected components to state
declare -A selected_map=()
for item in $SELECTED; do
    item=$(echo "$item" | tr -d '"')
    selected_map["$item"]=1
done

for ((i = 0; i < ${#OPTIONS[@]}; i+=3)); do
    item="${OPTIONS[$i]}"
    varname="COMPONENT_$(echo "$item" | tr '[:lower:]-' '[:upper:]_')"
    if [[ -n "${selected_map[$item]}" ]]; then
        echo "${varname}=ON" >> "$STATE_FILE"
    else
        echo "${varname}=OFF" >> "$STATE_FILE"
    fi
done

echo "State saved to $STATE_FILE"

# Enable/disable service marker
if [[ -n "${selected_map[enabled]}" ]] || [[ ${#selected_map[@]} -gt 0 ]]; then
    touch "$ENABLED_FLAG"
    echo "Service $SERVICE_NAME marked as enabled."
else
    rm -f "$ENABLED_FLAG"
    echo "Service $SERVICE_NAME disabled."
fi

# Prompt to install if install.sh is available
if [[ -f "$SERVICE_DIR/install.sh" ]]; then
    if whiptail --title "Install $SERVICE_DISPLAY_NAME?" \
        --yesno "Run install.sh for $SERVICE_DISPLAY_NAME now?\n(Pulls images, generates secrets, writes config)" \
        10 60 3>&1 1>&2 2>&3; then
        echo "Running install.sh for $SERVICE_NAME..."
        bash "$SERVICE_DIR/install.sh"
    fi
fi
