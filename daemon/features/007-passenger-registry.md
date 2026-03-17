# Feature: Passenger Registry

## Summary
The daemon automatically detects and registers passengers from koad:io entities that have `passenger.json` configuration files, making them available for selection and interaction.

## Problem
Users need an easy way to see which entities are available as "passengers" (entities that can accompany them in the browser) without manually configuring each one.

## Solution
The passenger registry provides automatic discovery:
- Scans home directory for koad:io entities (folders with `KOAD_IO_*` in `.env`)
- Looks for `passenger.json` files in each entity folder
- Extracts configuration including name, avatar, and custom buttons
- Embeds avatars as base64 for easy transport
- Exposes registered passengers via DDP subscription

## Implementation
- At startup, daemon scans `~/*` folders for `.env` files containing `KOAD_IO_`
- Loads `passenger.json` from each qualifying entity
- Generates default "outfit" (color) based on entity name hash
- Stores passengers in MongoDB collection
- Exposes `passenger.check.in` and `passenger.reload` methods

## Settings
- Entity must have `passenger.json` to be registered
- Optional `avatar.png` for passenger avatar
- Custom buttons defined in `passenger.json.buttons` array

## Status
- [x] Implemented

## Related Features
- Feature: 001-entity-management.md
- Feature: 006-ui-serving.md
