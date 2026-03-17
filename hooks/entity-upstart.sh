#!/bin/bash
if [[ -z "$HOME" ]]; then
    echo -e "\e[31mHOME environment variable is not set, exiting.\e[0m"
    exit 1
fi

HOME_DIR="$HOME"
if [[ -z "$LOCKS_FOLDER" ]]; then
    export LOCKS_FOLDER="/dev/shm"
fi
LOCKFILE="$LOCKS_FOLDER/koad-io.upstart.lock"

# Check if the script has already run since upstart
if [[ -f "$LOCKFILE" ]]; then
    echo -e "\e[31mScript already ran since upstart, exiting.\e[0m"
    exit 0
else
    touch "$LOCKFILE"
fi


if [[ -d "$HOME_DIR/.koad-io/daemon" ]]; then
    console_log "starting koad:io daemon"
    if command -v screen &> /dev/null; then
        screen -dmS koad-daemon bash -c "cd $HOME_DIR/.koad-io/daemon/ && $HOME_DIR/.koad-io/bin/koad-io start"
    else
        (cd $HOME_DIR/.koad-io/daemon/ && $HOME_DIR/.koad-io/bin/koad-io start &> /dev/null &)
    fi
    
    sleep 1.420 

    if [[ -d "$HOME_DIR/.koad-io/desktop" ]]; then
        console_log "starting koad:io desktop ui"
        if command -v screen &> /dev/null; then
            screen -dmS koad-desktop bash -c "cd $HOME_DIR/.koad-io/desktop/ && sleep 3 && $HOME_DIR/.koad-io/bin/koad-io start"
        else
            (cd $HOME_DIR/.koad-io/desktop/ && sleep 3 && $HOME_DIR/.koad-io/bin/koad-io start &> /dev/null &)
        fi
    else
        console_log "desktop folder not found, skipping"
    fi

else
    console_log "daemon folder not found, skipping"
fi
