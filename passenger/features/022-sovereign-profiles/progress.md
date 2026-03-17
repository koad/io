# Progress: Sovereign Profiles

## Status: 🔄 In Progress

## Overview

Implement a self-sovereign identity system with GPG keys, social proofs, and signed messages. Profile exists locally in Chrome extension but can authenticate onto websites.

## To Do

### Phase 1: Core Infrastructure
- [x] Create Meteor package `koad:io-sovereign-profiles`
- [x] Set up package.js with dependencies
- [x] Bundle kbpgp-js library (uses window.KBPGP)

### Phase 2: Key Generation
- [x] Implement GPG key generation using kbpgp
- [x] Add key storage to localStorage (for this extension)
- [x] Implement key import/export (basic)

### Phase 3: Profile UI
- [x] Create profile management templates
- [x] Add profile CRUD operations
- [x] Full-page routes (no modals)
- [x] Integrate with navigation bar

### Phase 4: Social Proofs
- [x] Implement DNS TXT proof creation
- [x] Implement URL proof creation
- [x] Add social platform proofs (keybase, github, x, youtube, twitch, substack, myspace)

### Phase 5: Key Management
- [x] Key deletion with proof dependency check
- [x] Prevent deleting keys that have associated proofs
- [x] Email-less key generation using @unaddressable domain

### Notes

- Uses kbpgp-js (Keybase's PGP library) for key generation
- Keys use `@unaddressable` as placeholder email - not tied to any email provider
- This makes the sovereign identity truly independent of any centralized service

### Phase 5: Signed Messages
- [x] Implement message signing structure
- [x] Implement signature verification
- [x] Create message history UI (basic)

### Phase 6: Authentication (NEW - Passenger Auth Package)
- [x] Create `koad:io-passenger-auth` package
- [x] Implement server-side authentication methods
- [x] Implement witness system for proof verification
- [x] Add client-side login UI templates
- [x] Add routes for login flow
- [ ] Integrate with Chrome extension

## Dependencies

- Feature: 001-ddp-connection (for DDP methods)
- Feature: 005-sovereign-identity (base identity system)

## Completed

- [x] Created feature folder and specs
- [x] Created Meteor package structure
- [x] Implemented crypto.js with kbpgp key generation
- [x] Implemented proofs.js with social/domain proof creation
- [x] Implemented messages.js with signed message handling
- [x] Created full-page templates with routes
- [x] Updated navigation to show sovereign profile
- [x] Added package to .meteor/packages
- [x] Created koad:io-passenger-auth package with:
  - Server-side auth methods (initiate, witness, complete)
  - Witness system for proof verification
  - Client login UI
  - Login success/failed pages

## Notes

- Uses kbpgp-js (Keybase's PGP library) for key generation
- Profile stored in localStorage
- Settings in chrome.storage.sync
- Uses full-page routes instead of modals
- Profile structure matches koads-profile-as-an-example.json
- Passenger auth package can be added to any Meteor app
- Witness: server verifies proofs by fetching external URLs
