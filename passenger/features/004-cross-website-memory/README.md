# Feature: Cross-website Memory

## Summary
The passenger extension enables entities to carry memory and context across browsing sessions, making browser state persistent and actionable.

## Problem
Traditional browsing is stateless - each website is isolated. Users need their entities to remember what they did across different websites and maintain context over time.

## Solution
Cross-website memory provides:
- Persistent storage of browsing activity in entity's database
- Context that carries across different websites
- Ability to query past activity and state
- Shared memory between browser extension and entities
- State restoration on browser restart

## Implementation
- All browsing events are logged to entity's MongoDB
- Entities can define custom data to capture per domain
- Storage persists across browser sessions
- Entities can run logic based on accumulated memory
- Data accessible to both extension and other kingdom components

## Settings
- Custom capture rules defined in `passenger.json`
- Per-domain storage policies
- Data retention settings in entity database

## Status
- [x] Implemented

## Related Features
- Feature: 003-local-first-data.md
- Feature: 006-entity-automations.md
