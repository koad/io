# Feature: Desktop Widget

## Summary
A transparent always-on Meteor window docked bottom-left of the main monitor. Shows entity avatar circles with accent-color status lights, expands to a button menu on right-click, launches entity PWAs on click. Toast notifications slide in from the right edge of the widget.

## Layout
- Transparent window, physically larger than visible — expand animation reveals already-rendered content
- Sits in the reserved space cairodock doesn't use (bottom-left)
- 300-400px to the right of the widget serves as toast notification zone
- Right side of cairodock reserved for future use

## Interaction
- **Click avatar circle** — opens entity's PWA
- **Right-click** — expands to button grid (buttons from `passenger.json`)
- **Click a button** — executes action, widget minimizes back to avatar circle
- **Accent color** — status light (entity outfit color). Can indicate running/idle/attention
- **Toast zone** — notifications from entity daemon methods slide in, fade out

## Workspace Binding
- Each X11 workspace can be claimed by an entity
- Opening an entity terminal (e.g., `iris`) on a workspace claims it — widget switches to that entity's avatar/accent/buttons
- Switching workspaces switches the active entity in the widget
- Tray icon dropdown allows manual entity selection
- Future: remember entity-workspace bindings across sessions
- Right-side widget slot reserved for secondary entity (entity at hand, pinned collaborator)

## Technical
- X11 only — requires `wmctrl`, `xdotool`, transparent window positioning, workspace detection. Wayland incompatible by design.
- Served by `~/.koad-io/desktop/` which wraps the daemon UI
- PWA launcher via `clicker.js` methods (already implemented)
- Passenger data from daemon's passenger registry (feature 007)
- Driven by `~/.koad-io/daemon/` via DDP

## Status
- [x] Transparent window — built
- [x] Cairodock integration — built
- [x] Button menu expand/collapse — built
- [x] PWA launch on click — built
- [ ] Accent-as-status-light — not started
- [ ] Toast notifications — not started
- [ ] Workspace-entity binding — not started
- [ ] Tray icon entity selector — not started
- [ ] Right-side widget (secondary entity) — future

## Related Features
- Feature: 007-passenger-registry.md
- Feature: 011-kingdom-dashboard.md
