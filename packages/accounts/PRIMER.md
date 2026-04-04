# PRIMER: koad:io-accounts

**Meteor package name:** `koad:io-accounts`  
**Version:** 3.6.9  
**State:** Built, active — full auth management layer

---

## What It Does

Complete account management for koad:io Meteor apps. Adds on top of `accounts-password` and `alanning:roles` to provide:

- Password authentication (via implied `accounts-password`)
- Role-based access control (RBAC) with `alanning:roles`
- Multi-device session management with QR code cross-device auth flow
- Token-based invitation system with quotas
- Rate limiting on auth endpoints
- Server-side user shaping on creation

## Dependencies

**Meteor (used/implied):** `koad:io-core`, `koad:io-router`, `templating` (client), `accounts-base`, `accounts-password` (implied), `roles` / `alanning:roles` (implied)

**npm:** `node-fetch@2.6.7`, `body-parser@1.20.2`

## Key Exports

| Export | Scope | Description |
|--------|-------|-------------|
| `UserStatus` | both | User online/offline status |
| `Login` | client | Login with token function |
| `Logout` | client | Logout function |
| `ApplicationInvitations` | server | Invitations collection |
| `ApplicationSponsors` | server | Sponsors collection |

## Server Methods

### Authentication
| Method | Description |
|--------|-------------|
| `gather.consumable(consumableId)` | Consume a one-time login token (used by pending QR sessions) |
| `revokeLoginToken(resumeTokenId)` | Revoke a specific session's token |
| `enroll.device()` | Generate a login token for adding a new device |
| `authorize.session(sessionId)` | Authorize a pending session (QR code flow) |
| `update.token.memo(tokenId, memo)` | Label a device/session token |

### Invitations
| Method | Description |
|--------|-------------|
| `invitation.create({recipientName, recipientEmail, memo})` | Create invitation → returns `{invitationId, invitationUrl, token}` |
| `invitation.update({id, memo})` | Update memo |
| `invitation.revoke(id)` | Revoke invitation |
| `invitation.reclaim(id)` | Reclaim revoked invitation (restores quota) |
| `invitation.validate(id)` | Check if invitation is valid |
| `invitation.preflight(id, username)` | Check username availability for invitation |

## Collections

### ApplicationInvitations
```javascript
{
  _id, creator, creatorUsername,
  status: 'pending' | 'redeeemed' | 'revoked',
  loginToken, recipientName, recipientEmail, memo,
  created, redeemedAt, redeemedBy, redeemedByUsername
}
```

## Publications

- **Roles** (auto, no name): Admins see all roles; users see own roles only; anonymous see nothing
- **ApplicationInvitations**: User's own invitations

## Cross-Device Auth Flow (QR Code)

1. New device visits `/authenticate` → pending session created in `ApplicationSessions`
2. Logged-in device scans QR code → calls `authorize.session(sessionId)` → creates consumable token (3-minute TTL)
3. Pending device polls → calls `gather.consumable(sessionId)` → gets login token → logs in automatically

## Invitation Quotas

Default: 9 per user. Override per user:
```javascript
Meteor.users.update(userId, { $set: { 'invitations.quota': 20 } });
```

## File Map

```
client/
  globals.js        ← Login/Logout helpers
  subdomains.js     ← subdomain routing logic
server/
  roles.js          ← role publications and setup
  methods.js        ← session/device/token methods
  new-user-shaper.js ← shapes new user documents on creation
  on-user-login.js  ← Accounts.onLogin hook (redeems invitation tokens)
  invitations.js    ← invitation methods
  rate-limiting.js  ← DDPRateLimiter setup
```

## Known Issues / Notes

- `matb33:collection-hooks` is commented out in package.js (was previously used)
- `ApplicationSponsors` is exported but implementation may be incomplete — check `server/` for current state
- Rate limit configuration is in `server/rate-limiting.js` but defaults aren't documented inline
- QR/session flow depends on `ApplicationConsumables` and `ApplicationSessions` from `koad:io-core`
