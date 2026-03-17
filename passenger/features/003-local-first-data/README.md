# Feature: Local-first Data

## Summary
All data captured by the passenger extension flows locally between the browser and the daemon - no cloud services, no data leaks to third parties.

## Problem
Most browser extensions send data to external servers for processing. Users concerned with privacy and data sovereignty need their browsing data to stay within their own infrastructure.

## Solution
Local-first architecture ensures:
- All communication stays between browser and local daemon
- Data is stored in entity's local MongoDB instance
- No external API calls (except to the target websites being browsed)
- Complete user control over their data
- Offline-capable operation

## Implementation
- Extension connects directly to local daemon
- Data is sent via DDP methods to entity's MongoDB
- No external analytics or tracking services
- User can inspect all data stored in their kingdom
- Export/backup capabilities via entity MongoDB

## Settings
- All data stays local by design (no configuration needed)
- Optional: Configure which MongoDB instance to use

## Status
- [x] Implemented

## Related Features
- Feature: 001-ddp-connection.md
