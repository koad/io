# Feature: Sovereign Profiles

## Summary

A self-sovereign identity system that allows users to create cryptographic profiles with GPG keys, build social graphs with proofs (DNS TXT, URL), and sign messages that can be posted anywhere on the internet. The profile exists locally in the Chrome extension but can be used to authenticate onto websites.

## Problem

Traditional identity systems are centralized - users rely on third parties to verify their identity. Users want:
- Full ownership and control of their identity
- No dependency on centralized identity providers
- Ability to prove identity across websites without passwords
- Social graph that can be independently verified
- Messages signed with cryptographic keys that anyone can verify

## Solution

Sovereign Profiles provides:

1. **GPG Key Generation**
   - Generate PGP keypairs using kbpgp (Keybase's cryptographic library)
   - Keys stored locally in Chrome extension storage
   - Multiple profiles supported (one per identity)

2. **Social Graph with Proofs**
   - **DNS TXT Proofs**: Verify ownership of a domain via DNS TXT records
   - **URL Proofs**: Host a verification file on your domain
   - Link profiles to social accounts (Twitter, GitHub, website, etc.)

3. **Signed Messages**
   - Sign any message with your GPG key
   - Generate verification links that others can use to verify your signature
   - Post signed messages anywhere on the internet

4. **Website Authentication**
   - Use your sovereign profile to authenticate onto websites
   - Share public key and proof URLs
   - Passwordless login using cryptographic challenges

## Status

- [ ] Not Started

## Implementation Details

- Meteor package: `koad:io-sovereign-profiles`
- GPG library: kbpgp (bundled)
- Storage: chrome.storage.local for keys, chrome.storage.sync for settings
- UI: Settings page extension with profile management

## Dependencies

- Feature: 001-ddp-connection.md
- Feature: 005-sovereign-identity.md

## Related Features

- Feature: 009-passenger-settings.md (profile settings UI)
- Feature: 010-core-passenger-features.md
