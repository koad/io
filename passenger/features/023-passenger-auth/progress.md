# Progress: Passenger Auth

## Status: 🔄 In Progress

## Overview

Sovereign profile authentication with witness-based proof verification. Allows websites to authenticate users via their Dark Passenger Chrome extension profiles.

## To Do

### Phase 1: Package Structure
- [x] Create Meteor package `koad:io-passenger-auth`
- [x] Set up package.js with dependencies
- [x] Create server-side auth methods
- [x] Create client-side login UI

### Phase 2: Authentication Flow
- [x] Implement login initiation with challenge
- [x] Implement witness submission
- [x] Implement login completion

### Phase 3: Witness System
- [x] Server verifies proofs by fetching URLs
- [x] Support multiple proof types (keybase, github, twitter, etc.)
- [x] DNS TXT record verification

### Phase 4: Integration
- [x] Add routes for login pages
- [ ] Integrate with Chrome extension
- [ ] Add QR code generation for external login
- [ ] Test with daemon witness service

### Phase 5: Production
- [ ] Add session persistence (Redis/Mongo)
- [ ] Add rate limiting
- [ ] Add detailed audit logging

## Dependencies

- Feature: 001-ddp-connection
- Feature: 022-sovereign-profiles

## Completed

- [x] Created package structure
- [x] Implemented server-side auth methods:
  - `passenger.auth.initiate` - Start login session
  - `passenger.auth.witness` - Submit proof
  - `passenger.auth.getWitness` - Server verifies proof
  - `passenger.auth.complete` - Finish login
- [x] Created witness verification system
- [x] Created login UI templates
- [x] Added routes for login pages
- [x] Added package to .meteor/packages

## Notes

- Sessions expire after 60 seconds
- Proofs verified in real-time by server
- Supports any Meteor app as authentication provider
- Can be added to daemon for cross-device verification
