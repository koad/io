#!/bin/bash
#
# select-service.sh
#
# Summary: Scans services/ subdirectories for available daemon services, reads
# description from service.json metadata, builds a dynamic whiptail menu, and
# on selection calls configure-service.sh with the chosen service.
#

MENU_HEIGHT=24
MENU_WIDTH=96
MENU_LIST_HEIGHT=16

cd "$SERVICES_DIR"

options=()
for dir in */; do
    if [[ -d "$dir" ]]; then
        description=$(jq -r '.description // "no description"' "./$dir/service.json" 2>/dev/null || echo "no description")
        options+=("${dir%/}" "$description")
    fi
done

if [ ${#options[@]} -eq 0 ]; then
    whiptail --title "koad:io Daemon Services" --msgbox "No services found in $SERVICES_DIR" 8 60
    exit 1
fi

SELECTED_SERVICE=$(whiptail --title "koad:io Daemon Services" \
    --menu "Select a service to configure:" \
    $MENU_HEIGHT $MENU_WIDTH $MENU_LIST_HEIGHT \
    "${options[@]}" \
    3>&1 1>&2 2>&3)

if [ -n "$SELECTED_SERVICE" ]; then
    echo "Selected: $SELECTED_SERVICE"
    eval "$TOOLING_LOCATION/configure-service.sh" "$SELECTED_SERVICE"

    if [ $? -ne 0 ]; then
        echo "An error occurred. Press any key to continue..."
        read -n 1 -s -r
    fi

    # Return to service selection
    eval "$TOOLING_LOCATION/select-service.sh"
else
    echo "No selection made."
fi
