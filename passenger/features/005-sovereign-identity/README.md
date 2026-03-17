# Feature: Sovereign Identity

## Summary
Users can use their entity's cryptographic keys to sign or verify data from websites, enabling authentication, protocol assertions, and cryptographic workflows directly from the browser.

## Problem
Traditional web authentication relies on passwords or external identity providers. Users want to use their own cryptographic identities for authentication and data signing, maintaining full control over their digital identity.

## Solution
Sovereign identity provides:
- Entity keypair available for cryptographic operations
- Sign data using entity's private key
- Verify signatures from other entities
- Passwordless authentication to websites
- Protocol assertions and cryptographic proofs

## Implementation
- Entity keyring accessed through daemon
- Signing methods exposed via DDP
- Public key can be shared with websites
- Supports common signature algorithms
- Integration with entity's key management

## Settings
- Entity must have generated keypair
- Public key export available for sharing
- Signing algorithms supported: Ed25519, X25519

## Status
- [x] Implemented

## Related Features
- Feature: 001-ddp-connection.md
