# Feature: ZeroTier Integration

## Summary
koad:io leverages ZeroTier to establish isolated networks for each entity, enhancing security and enabling seamless communication between devices.

## Problem
Devices in a personal kingdom need to communicate securely while remaining isolated from the broader internet. Traditional VPN solutions are complex to configure and don't provide per-entity isolation.

## Solution
ZeroTier integration provides:
- Automatic network virtualization for each entity
- Isolated network segments per entity
- End-to-end encrypted communication
- Easy peer-to-peer connectivity without port forwarding
- Centralized network policy management through ZeroTier Central

## Implementation
- Each entity can belong to one or more ZeroTier networks
- Networks are isolated - entities on different networks cannot communicate
- The daemon manages ZeroTier network membership
- Network IDs are configured per entity

## Settings
- `ZEROTIER_NETWORK_ID`: ZeroTier network ID for entity isolation
- `ZEROTIER_API_TOKEN`: API token for network management (optional)

## Status
- [x] Implemented

## Related Features
- Feature: 002-distributed-network.md
