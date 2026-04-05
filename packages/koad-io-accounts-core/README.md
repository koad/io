# koad:io-accounts-core

**Meteor package name:** `koad:io-accounts-core`  
**Version:** 0.3.3

The server-side logic layer for the koad:io accounts system. Handles consumable tokens, session authorization, device enrollment, invitation management, user shaping on registration, and role bootstrapping.

## Installation

```bash
meteor add koad:io-accounts-core
```

Or include it via the umbrella package:

```bash
meteor add koad:io-accounts
```

## Dependencies

- `koad:io-core`
- `koad:io-router`
- `templating` (client)
- `accounts-base`
- `accounts-password` (implied)
- `alanning:roles@3.4.0` (implied)

## Exports

| Symbol | Scope | Description |
|--------|-------|-------------|
| `Login(token)` | client | Log in with a token string |
| `Logout()` | client | Log out current user |
| `UserStatus` | both | User online/offline status |
| `ApplicationInvitations` | server | MongoDB collection for invitations |

## Server Methods

### `gather.consumable(consumableId)`
Retrieves and consumes a one-time use login token. Called by a pending session after it has been authorized by a logged-in user. Throws `invalid-consumable` or `expired-consumable` on failure.

### `revokeLoginToken(resumeTokenId)`
Removes a specific resume token from the user's account, logging out that device/session.

### `enroll.device()`
Generates a new login token for the current user. Used to add a new device — share the token via QR code or manually.

### `authorize.session(sessionId)`
Creates a one-time consumable token for a pending session. Called by a logged-in user to authorize a new device (e.g., by scanning a QR code displayed on the new device).

**Cross-device auth flow:**
1. New device opens `/authenticate` → creates a pending `ApplicationSession`
2. Logged-in device scans the session QR code
3. `authorize.session(sessionId)` is called → creates a consumable token
4. Pending device's session observer fires → calls `gather.consumable` → logs in

### `update.token.memo(tokenId, memo)`
Sets a human-readable label on a login token (e.g., "Work Laptop").

### `invitation.create({ recipientName, recipientEmail, memo })`
Creates an invitation record with a login token. Returns `{ invitationId, invitationUrl, token }`.

### `invitation.update({ id, memo })`, `invitation.revoke(id)`, `invitation.reclaim(id)`, `invitation.validate(id)`, `invitation.preflight(id, username)`
Invitation lifecycle management. `reclaim` removes a revoked invitation and restores the user's quota.

## Client Globals

`Login(token)` and `Logout()` are exported to the client as simple wrappers around `Meteor.loginWithToken()` and `Meteor.logout()`.

The package also installs a session dataport observer on the client (`globals.js`) that watches `ApplicationSessions` for changes and automatically calls `gather.consumable` when a consumable token arrives — enabling the cross-device login flow without any UI interaction on the pending device.

## Server-Side Hooks

- `Accounts.onCreateUser` — shapes the user document on registration (adds profile defaults, invitation tracking)
- `Accounts.onLogin` — redeems invitation token when user logs in via invitation link
- Role bootstrapping — initial admin role setup

## File Structure

```
koad-io-accounts-core/
├── package.js
├── client/
│   ├── consumable.js      ← client-side consumable token handling
│   ├── subdomains.js      ← subdomain detection helpers
│   └── globals.js         ← Login/Logout exports, session dataport observer
└── server/
    ├── roles.js           ← role definitions and bootstrapping
    ├── methods.js         ← all Meteor methods listed above
    ├── new-user-shaper.js ← Accounts.onCreateUser hook
    ├── on-user-login.js   ← Accounts.onLogin hook
    ├── invitations.js     ← ApplicationInvitations collection + invitation logic
    └── publications.js    ← data publications
```

## See Also

- `koad-io-accounts-ui/README.md` — the Blaze UI templates for this logic
- `accounts/README.md` — the mature v3.6.9 accounts implementation with full docs
