# Feature: Entity Selector

## Summary
Users can select which entity (passenger) accompanies them while browsing. The extension displays available passengers and allows quick switching between them.

## Problem
Users may have multiple entities in their kingdom, each designed for different purposes (research, automation, scheduling). While browsing, they need to choose which entity "rides along."

## Solution
The entity selector provides:
- Dropdown/UI to view all registered passengers
- One-click passenger selection
- Visual indication of currently active passenger
- Passenger avatar and name display
- Quick access from browser toolbar

## Implementation
- Fetches passenger list from daemon via DDP
- Displays passengers with their avatars and names
- On selection, calls `passenger.check.in` method
- Updates extension badge to show current passenger
- Persists selection across browser sessions

## Settings
- Passenger configuration in entity's `passenger.json`
- Avatar image in entity folder (`avatar.png`)
- Custom buttons defined per passenger

## Status
- [x] Implemented

## Related Features
- Feature: 001-ddp-connection.md
- Feature: 007-chrome-extension-ui.md
