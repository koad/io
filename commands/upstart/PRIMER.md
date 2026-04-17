<!-- SPDX-License-Identifier: CC0-1.0 -->

# PRIMER — `~/.koad-io/commands/upstart/`

> Desktop session startup — run all entity upstart hooks and launch daemon/desktop services.

## What this does

`upstart` is the kingdom's boot sequence for a graphical desktop session. It runs each entity's `hooks/upstart.sh` (if present), starts the koad:io daemon and desktop UI in screen sessions, and sends a desktop notification when complete. Uses a lock directory to ensure it only runs once per session.

## Invocation

```bash
koad-io upstart              # Run at login — typically called from a session manager or `.bashrc`
```

## What it does, in order

1. Sets the terminal title to `koad:io-upstart`
2. Checks the lock directory (`/dev/shm/.koad-io/locks/upstart`) — exits if already run this session
3. Lowers audio volume to 20%
4. Scans `~/.*` for `hooks/upstart.sh` and runs each one
5. Starts `~/.koad-io/daemon/` in a screen session if present
6. Starts `~/.koad-io/desktop/` in a screen session if a display is available
7. Sends a desktop notification: "Welcome $USER! Upstart complete."

## What it expects

- `wmctrl`, `xdotool` — for workspace switching (desktop session only)
- `amixer` — for volume control
- `gnome-terminal` or another terminal emulator (for window management)
- `screen` — for daemon/desktop sessions
- `DISPLAY` set — desktop UI is skipped in headless environments

## Notes

- The lock prevents double-execution; the lock directory is in RAM (`/dev/shm`) and clears on reboot.
- Entity upstart hooks are at `~/.<entity>/hooks/upstart.sh` — add per-entity startup logic there.
- `screen` sessions created: `koad:io-daemon` and `koad:io-desktop-ui`.
