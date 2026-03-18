# koad:io-accounts

A comprehensive account management package for [Meteor](https://github.com/meteor/meteor), built specifically for the koad:io framework. This package provides user authentication, role-based access control, session management, and an invitation system.

## Installation

```shell
meteor add koad:io-accounts
```

## Dependencies

This package automatically includes and implies:
- `koad:io-core` - Core koad:io functionality
- `koad:io-router` - Routing system
- `accounts-base` - Meteor's account system
- `accounts-password` - Password authentication
- `roles` - Role-based access control (alanning:roles)

## Features

### User Authentication
- Password-based authentication via `accounts-password`
- Token-based login for cross-device authentication
- Session-based login with QR code support

### Role-Based Access Control
- Integration with `alanning:roles` package for RBAC
- Hierarchical roles: `super-admin`, `admin`, `sysop`
- Granular permission management

### Session Management
- Track user sessions across devices
- Cross-device authentication via QR codes
- Session authorization flow

### Invitation System
- Token-based user invitations
- Configurable invitation quotas per user
- Invitation tracking and management

### Rate Limiting
- Built-in rate limiting for authentication attempts
- Protects against brute-force attacks

## Server API

### Methods

#### `gather.consumable(consumableId)`
Retrieves and consumes a one-time use login token. Used by pending sessions after being authorized by a logged-in user.

```javascript
const token = Meteor.call('gather.consumable', sessionId);
```

**Parameters:**
- `consumableId` (String): Consumable token ID (typically session ID)

**Returns:** Login token payload

**Errors:**
- `invalid-consumable`: Token not found or already used
- `expired-consumable`: Token TTL exceeded

---

#### `revokeLoginToken(resumeTokenId)`
Removes a specific login token from the user's account, logging out that session.

```javascript
Meteor.call('revokeLoginToken', tokenId);
```

---

#### `enroll.device()`
Generates a new login token for adding a new device. The token can be shared via QR code or manually to log in on another device.

```javascript
const loginToken = Meteor.call('enroll.device');
```

---

#### `authorize.session(sessionId)`
Creates a one-time login token for a pending session. Used for cross-device authentication where a logged-in user authorizes a new device by scanning a QR code.

```javascript
Meteor.call('authorize.session', sessionId);
```

**Flow:**
1. New device visits `/authenticate` (creates pending session)
2. Logged-in user scans the session QR code
3. This method creates a consumable token for that session
4. Pending session auto-consumes the token and logs in

---

#### `update.token.memo(tokenId, memo)`
Sets a memo/note on a login token for identification purposes.

```javascript
Meteor.call('update.token.memo', tokenId, 'My Laptop');
```

---

### Invitation Methods

#### `invitation.create({ recipientName, recipientEmail, memo })`
Creates an invitation with a login token that can be shared with new users.

```javascript
const result = Meteor.call('invitation.create', {
  recipientName: 'John Doe',
  recipientEmail: 'john@example.com',
  memo: 'Friend from work'
});
// Returns: { invitationId, invitationUrl, token }
```

---

#### `invitation.update({ id, memo })`
Updates the memo for an invitation.

```javascript
Meteor.call('invitation.update', { id: 'invitationId', memo: 'Updated note' });
```

---

#### `invitation.revoke(id)`
Revokes an invitation, preventing it from being used.

```javascript
Meteor.call('invitation.revoke', 'invitationId');
```

---

#### `invitation.reclaim(id)`
Reclaims a revoked invitation, removing it and restoring the invitation quota.

```javascript
Meteor.call('invitation.reclaim', 'invitationId');
```

---

#### `invitation.validate(id)`
Validates if an invitation is still valid.

```javascript
const result = Meteor.call('invitation.validate', 'invitationId');
// Returns: { success: true } or throws error
```

---

#### `invitation.preflight(id, username)`
Checks if a username is available for a given invitation.

```javascript
const result = Meteor.call('invitation.preflight', 'invitationId', 'newusername');
// Returns: { available: true | false }
```

---

## Collections

### ApplicationInvitations
Stores invitation records.

```javascript
{
  _id: String,
  creator: String (userId),
  creatorUsername: String,
  status: 'pending' | 'redeeemed' | 'revoked',
  loginToken: String,
  recipientName: String,
  recipientEmail: String,
  memo: String,
  created: Date,
  redeemedAt: Date,
  redeemedBy: String,
  redeemedByUsername: String
}
```

## Publications

### Roles Publication
Automatically publishes role data to clients:
- Administrators (`sysop`, `admin`, `super-admin`) see all roles and assignments
- Regular users see only their own role assignments
- Unauthenticated users get no role data

```javascript
Meteor.subscribe(null); // Auto-publishes roles
```

### ApplicationInvitations
Publishes the authenticated user's own invitations.

```javascript
Meteor.subscribe('ApplicationInvitations');
```

## Configuration

### Invitation Quotas
Users can have a custom invitation quota set in their profile:

```javascript
Meteor.users.update(userId, {
  $set: { 'invitations.quota': 20 }
});
```

Default quota is 9 invitations per user.

### Rate Limiting
Configure rate limiting in your server settings. The package includes built-in protection against brute-force login attempts.

## Usage Examples

### Creating Invitations

```javascript
// Create an invitation
Meteor.call('invitation.create', {
  recipientName: 'Alice',
  recipientEmail: 'alice@example.com',
  memo: 'Team member'
}, (err, result) => {
  if (!err) {
    console.log('Invitation URL:', result.invitationUrl);
  }
});
```

### Managing Sessions

```javascript
// Authorize a pending session (from authenticated device)
Meteor.call('authorize.session', pendingSessionId);

// Revoke a specific login token
Meteor.call('revokeLoginToken', tokenId);

// Update token memo for identification
Meteor.call('update.token.memo', tokenId, 'Work Laptop');
```

### Checking Permissions

```javascript
// Check if user has specific role
const isAdmin = Roles.userIsInRole(userId, ['admin', 'super-admin']);

// Get user's roles
const userRoles = Roles.getRolesForUser(userId);
```

## Events

### onLogin Hook
The package automatically hooks into login events to:
- Redeem invitation tokens when users log in via invitation
- Track session connections

```javascript
Accounts.onLogin((loginInfo) => {
  console.log('User logged in:', loginInfo.user.username);
});
```

## Security Features

- **Single-use tokens**: Consumable tokens are removed after use
- **Time-limited tokens**: Authorization tokens expire (default 3 minutes)
- **Session binding**: Tokens are bound to specific sessions
- **Rate limiting**: Protection against brute-force attacks
- **Role-based access**: Granular permission system
