# Feature: Entity Management

## Summary
The daemon provides comprehensive entity management, allowing users to create, oversee, and govern entities within their koad:io kingdom.

## Problem
In a personal digital kingdom, you need to manage multiple distinct entities with different responsibilities and access privileges. Each entity needs its own security infrastructure (keyring) and data structure (Merkle tree).

## Solution
The koad:io Daemon provides a centralized management system for entities:
- Discovers entities by scanning for folders with `KOAD_IO_` variables in `.env`
- Maintains entity registry with metadata
- Supports entity keyring management
- Manages Merkle tree structures for data integrity

## Implementation
- Entities are detected as folders in the home directory starting with `.` that contain `KOAD_IO_` variables in their `.env` file
- Each entity has its own MongoDB collection and cryptographic keyring
- Entity configuration is stored in `passenger.json` files within entity folders

## Settings
- Entity folders must contain `.env` with `KOAD_IO_*` variables
- Optional `passenger.json` for passenger configuration
- Optional `avatar.png` for entity visual representation

## Status
- [x] Implemented

## Related Features
- Feature: 002-distributed-network.md
- Feature: 007-passenger-registry.md
