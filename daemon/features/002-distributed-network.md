# Feature: Distributed Network

## Summary
Each device in the koad:io ecosystem has its own cryptographic identity, creating a secure, decentralized network for inter-device communication and collaboration.

## Problem
In a distributed personal kingdom, devices need to securely communicate and authenticate each other without relying on centralized authorities or cloud services.

## Solution
The daemon implements a distributed network architecture:
- Each device generates and maintains its own cryptographic identity
- Devices use these identities to establish secure, peer-to-peer connections
- Data integrity and confidentiality are maintained through cryptographic protocols
- No central server required - all devices are equals in the network

## Implementation
- Cryptographic identities are generated using public/private key pairs
- Identities are stored in entity keyrings
- Communication uses DDP (Distributed Data Protocol) over encrypted channels
- ZeroTier provides the underlying network virtualization

## Settings
- `KOAD_IO_IDENTITY_KEY`: Private key for device identity
- ZeroTier network membership per entity

## Status
- [x] Implemented

## Related Features
- Feature: 001-entity-management.md
- Feature: 003-zerotier-integration.md
