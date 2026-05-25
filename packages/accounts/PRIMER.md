# PRIMER: koad:io-accounts

**Meteor package name:** `koad:io-accounts`  
**Version:** 3.6.9  
**State:** Built, active — full auth management layer  
**Source:** `~/.koad-io/packages/accounts/` (resolved via `METEOR_PACKAGE_DIRS`)

---

## What It Does

Complete account management for koad:io Meteor apps. Adds on top of `accounts-password` and `alanning:roles` to provide:

- Password authentication (via implied `accounts-password`)
- Role-based access control (RBAC) with `alanning:roles`
- **SovereignAuth** — Ed25519 challenge-response authentication (`server/auth.js`)
- Multi-device session management with QR code cross-device auth flow (VESTA-SPEC-185)
- Token-based invitation system with quotas
- Rate limiting on auth endpoints
- Server-side user shaping on creation

## Dependencies

**Meteor (used/implied):** `koad:io-core`, `koad:io-router`, `templating` (client), `accounts-base`, `accounts-password` (implied), `roles` / `alanning:roles` (implied), `check`, `random`

**npm (Npm.depends):** `kbpgp@2.1.15`

**npm (import — not in Npm.depends):** `@koad-io/node/auth` — imported by `server/auth.js` as an ES module. This is a local kingdom package, not an npm registry package. See [Meteor Consumer Setup](#meteor-consumer-setup) below.

## Key Exports

| Export | Scope | Description |
|--------|-------|-------------|
| `SovereignAuth` | server | Ed25519 challenge-response auth wrapper around `@koad-io/node/auth` |
| `UserStatus` | both | User online/offline status |
| `Login` | client | Login with token function |
| `Logout` | client | Logout function |
| `ApplicationInvitations` | server | Invitations collection |
| `ApplicationSponsors` | server | Sponsors collection |

## SovereignAuth

Exported from `server/auth.js`. Wraps the pure `@koad-io/node/auth` primitives (`challenge`, `respond`, `verify`, `pendingNonceCount`, `sweepExpiredNonces`) into the `SovereignAuth` object surface expected by Meteor consumers.

The core crypto logic lives in `@koad-io/node/auth.js`. This file only adds Meteor-specific glue:
- `Meteor.setInterval` for nonce sweeping (every 60s)
- `globalThis.SovereignAuth` attach for cross-file access
- `api.export('SovereignAuth', 'server')` in `package.js`

**API:**
```js
SovereignAuth.challenge()            // → { nonce, expires }
SovereignAuth.respond(nonce, privKey) // → Promise<{ nonce, signature }>
SovereignAuth.verify(nonce, sig, pubKey) // → Promise<{ valid, error }>
SovereignAuth.pendingNonceCount()    // → number
```

Nonces are single-use, 5-minute TTL, stored in-memory. Challenge message format (wire-protocol): `UTF-8 "koad-io:auth:v1:<nonce>"`.

## Meteor Consumer Setup

Any Meteor project that pulls in `koad:io-accounts` (listed in `.meteor/packages`) MUST have `@koad-io/node` resolvable at runtime. Because `@koad-io/node` is a local kingdom module (not on the npm registry), it cannot be installed via `Npm.depends()` — it must be symlinked into the Meteor project's `node_modules`.

**Two symlinks are needed:**

### 1. Source-level (for tools/tests that run from the project root)

```bash
mkdir -p src/node_modules/@koad-io
ln -s /home/koad/.koad-io/modules/node src/node_modules/@koad-io/node
```

Relative form also works:
```bash
ln -s ../../../../../.koad-io/modules/node src/node_modules/@koad-io/node
```

### 2. Build-level (for the actual Meteor runtime)

The Meteor reify compiler transforms `import ... from '@koad-io/node/auth'` into a `module.link()` call that resolves from the build directory at:
```
src/.meteor/local/build/programs/server/
```

```bash
mkdir -p src/.meteor/local/build/programs/server/node_modules/@koad-io
ln -sf /home/koad/.koad-io/modules/node \
  src/.meteor/local/build/programs/server/node_modules/@koad-io/node
```

Use an **absolute** symlink for the build dir — relative paths depend on build directory depth which can vary.

### Build survival

The build-level symlink is wiped on `meteor reset` and `meteor rebuild`. If you hit `Cannot find module '@koad-io/node/auth'` after a rebuild, re-run the build-level symlink command above. The source-level symlink persists across rebuilds.

### Projects that already use this pattern

| Project | Source symlink | Build symlink |
|---------|---------------|---------------|
| `~/.koad-io/daemon/` | ✓ | ✓ |
| `~/.forge/control-tower/` | ✓ | ✓ |
| `~/.ecoincore/daemon/` | ✓ | ✓ |

## Server Methods

### Authentication
| Method | Description |
|--------|-------------|
| `gather.consumable(consumableId)` | Consume a one-time login token (used by pending QR sessions) — superseded, see below |
| `enroll.device()` | Generate a login token for adding a new device — superseded |
| `authorize.session(sessionId)` | Authorize a pending session — superseded |
| `update.token.memo(tokenId, memo)` | Label a device/session token |
| `identity.createSession(targetSessionId)` | VESTA-SPEC-185: authorize a pending DDP session |
| `identity.listSessions()` | List authorized DDP sessions |

Several older methods are marked superseded by VESTA-SPEC-185 (`gather.consumable`, `enroll.device`, `authorize.session`). The new QR flow uses `identity.authorizeSession` / `identity.createSession`.

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
  status: 'pending' | 'redeemed' | 'revoked',
  loginToken, recipientName, recipientEmail, memo,
  created, redeemedAt, redeemedBy, redeemedByUsername
}
```

## Publications

- **Roles** (auto, no name): Admins see all roles; users see own roles only; anonymous see nothing
- **ApplicationInvitations**: User's own invitations

## Cross-Device Auth Flow (QR Code)

1. New device visits `/authenticate` → pending session created in `ApplicationSessions`
2. Logged-in device scans QR code → calls `identity.authorizeSession(sessionId)` → DDP session tagged
3. Pending device polls → automatically logged in when session is tagged

See VESTA-SPEC-185 for the full ceremony.

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
  auth.js           ← SovereignAuth — Ed25519 challenge-response (imports @koad-io/node/auth)
  roles.js          ← role publications and setup
  methods.js        ← session/device/token methods
  new-user-shaper.js ← shapes new user documents on creation
  on-user-login.js  ← Accounts.onLogin hook (redeems invitation tokens)
  invitations.js    ← invitation methods
  oauth-methods.js  ← OAuth provider methods
  pgp-auth.js       ← PGP-based authentication methods
  sign-required.js  ← Signature-required endpoint middleware
  identity-session-methods.js ← VESTA-SPEC-185 DDP session authorization
  rate-limiting.js  ← DDPRateLimiter setup
```

## Known Issues / Notes

- `matb33:collection-hooks` is commented out in package.js (was previously used)
- `ApplicationSponsors` is exported but implementation may be incomplete — check `server/` for current state
- Rate limit configuration is in `server/rate-limiting.js` but defaults aren't documented inline
- QR/session flow depends on `ApplicationConsumables` and `ApplicationSessions` from `koad:io-core`
- **Critical for consumers:** `@koad-io/node` symlink is required at runtime. See [Meteor Consumer Setup](#meteor-consumer-setup).

---

*Last updated: 2026-05-24 — added SovereignAuth docs and @koad-io/node symlink setup instructions after ecoincore daemon runtime error.*
