#!/bin/bash
# SPDX-License-Identifier: AGPL-3.0-or-later

echo -ne "\033]0;koad:io-upstart\007"

source "$HOME/.bashrc"

export LOCKS_FOLDER="/dev/shm/.koad-io/locks/upstart"
export SLEEP_DURATION=0.420
export MAIN_WORKSPACE=0

if [[ -d "$LOCKS_FOLDER" ]]; then
    echo -e "\e[31mScript already ran since upstart, exiting.\e[0m"
    exit 0
else
    mkdir -p "$LOCKS_FOLDER"
fi

# Define a custom console_log function
console_log() {
    local message="$*"
    local current_workspace=$(xdotool get_desktop)
    sleep 0.420
    wmctrl -s $MAIN_WORKSPACE         # Switch to workspace 0 (or whichever you prefer)
    wmctrl -a "koad:io-upstart"  # Focus on the window with the specified title
    echo -e "$message"  # Use 'command' to call the original echo
    sleep 0.69
    wmctrl -s $current_workspace         # Switch to workspace 0 (or whichever you prefer)
}

terminal() {
    local cmd="$*"
    gnome-terminal -- bash -c "
        echo -ne '\033]0;terminal - $cmd\007';
        trap 'exec bash' SIGINT;
        $cmd;
        exec bash
    "
}

export -f terminal
export -f console_log

wmctrl -s $MAIN_WORKSPACE
sleep "$SLEEP_DURATION"

echo "turning down the volume a bunch"
amixer -D pulse sset Master 20%
sleep "$SLEEP_DURATION"

for dir in "$HOME"/.*; do
    if [[ -d "$dir" && -f "$dir/hooks/upstart.sh" ]]; then
        echo -e "\e[36mRunning $dir/hooks/upstart.sh...\e[0m"
        export ENTITY_FOLDER=$dir
        bash "$dir/hooks/upstart.sh"
        wmctrl -s $MAIN_WORKSPACE
        wmctrl -a "koad:io-upstart"
        sleep "$SLEEP_DURATION"
    fi
done


if [[ -d "$HOME/.koad-io/daemon" ]]; then
    console_log "starting koad:io daemon"
    # gnome-terminal -- bash -c "cd /home/koad/.koad-io/daemon/ && koad-io start local; exec bash"
    # sleep 0.420 && wmctrl -r :ACTIVE: -e 0,1920,915,2200,423 && sleep 0.69
    screen -dmS koad:io-daemon bash -c 'cd /home/koad/.koad-io/daemon && ~/.koad-io/bin/koad-io start'
    sleep 6
fi

if [[ -d "$HOME/.koad-io/desktop" ]] && [[ -n "$DISPLAY" ]] && [[ -z "$SSH_CONNECTION" ]]; then
    console_log "starting koad:io desktop ui"
    # gnome-terminal -- bash -c "cd /home/koad/.koad-io/desktop/ && sleep 3 && koad-io start; exec bash"
    # sleep 0.420 && wmctrl -r :ACTIVE: -e 0,1920,915,2200,423 && sleep 0.69
    screen -dmS koad:io-desktop-ui bash -c 'cd /home/koad/.koad-io/desktop && ~/.koad-io/bin/koad-io start'
    sleep "$SLEEP_DURATION"
fi


sleep "$SLEEP_DURATION"
screen -ls

sleep "$SLEEP_DURATION"
if command -v notify-send &>/dev/null; then
    notify-send "Welcome $USER!" "Upstart complete, have fun!"
fi
