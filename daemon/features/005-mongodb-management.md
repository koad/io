# Feature: MongoDB Management

## Summary
The daemon handles MongoDB database instance management, either connecting to an existing instance or automatically spawning one for convenience.

## Problem
Each entity in koad:io needs a MongoDB database for persistent storage. Setting up and managing MongoDB manually is complex and time-consuming.

## Solution
The daemon simplifies MongoDB management:
- Can connect to an existing MongoDB instance (via `MONGO_URL`)
- Automatically spawns a local MongoDB instance if none is provided
- Manages database lifecycle (start, stop, health checks)
- Provides isolated databases per entity

## Implementation
- Check for `MONGO_URL` environment variable at startup
- If not set, spawn local MongoDB instance on default port
- Entity databases are created on-demand
- MongoDB data stored in `~/.koad-io/daemon/data/`

## Settings
- `MONGO_URL`: External MongoDB connection string (optional)
- `MONGO_PORT`: Port for spawned MongoDB (default: 3001)
- `MONGO_DB_PATH`: Data directory for MongoDB (default: `./data`)

## Status
- [x] Implemented

## Related Features
- Feature: 004-process-management.md
- Feature: 001-entity-management.md
