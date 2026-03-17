# Feature: Passenger Auth - Sovereign Profile Authentication

## Overview

The `koad:io-passenger-auth` package enables websites and services to authenticate users via their sovereign profiles from the Dark Passenger Chrome extension. It implements a witness-based proof verification system where the server verifies social proofs by fetching external URLs.

## How It Works

1. **User initiates login** on a website supporting passenger auth
2. **Challenge generated** - user gets a unique challenge string
3. **Proofs submitted** - the extension submits proofs (social posts, DNS records, etc.)
4. **Witness verification** - the server fetches and verifies each proof
5. **Login complete** - user is logged in based on verified proofs

## Package Structure

```
src/packages/koad-io-passenger-auth/
├── package.js           # Package definition
├── lib/
│   ├── witness.js       # Proof verification library
│   └── auth-common.js   # Shared auth utilities
├── server/
│   └── auth-server.js   # Server-side methods
└── client/
    ├── templates.html   # Login UI templates
    ├── styles.css       # Login UI styles
    └── logic.js         # Client-side logic
```

## DDP Methods

### `passenger.auth.initiate`
Initiates a login session with a sovereign profile.

**Parameters:**
- `profile` (Object): The user's sovereign profile

**Returns:**
```json
{
  "sessionId": "session_xxx",
  "token": "xxx",
  "challenge": "abc123",
  "expiresAt": 1234567890,
  "requiredProofs": [...]
}
```

### `passenger.auth.witness`
Submits a proof/witness for verification.

**Parameters:**
- `sessionId` (String): The login session ID
- `token` (String): The session token
- `witness` (Object): The proof data
  - `platform` (String): Platform type (twitter, github, keybase, etc.)
  - `handle` (String): User's handle on that platform
  - `proof_url` (String): URL to verify
  - `fingerprint` (String): Key fingerprint

### `passenger.auth.getWitness`
Server verifies a proof (for daemon mode).

**Parameters:**
- `proof` (Object): The proof to verify

**Returns:**
```json
{
  "valid": true,
  "platform": "twitter",
  "handle": "username",
  "content": "..."
}
```

### `passenger.auth.complete`
Completes the login after proofs are verified.

**Parameters:**
- `sessionId` (String): The login session ID
- `token` (String): The session token

**Returns:**
```json
{
  "userId": "xxx",
  "loginId": "login_xxx",
  "witnesses": [...]
}
```

## Witness System

The witness system allows the server to verify that a user actually controls the claimed identities:

1. **Proof Generation** - Profile contains proofs (social posts, DNS TXT records, etc.)
2. **Witness Submission** - Extension submits proof URLs to server
3. **Server Verification** - Server fetches each URL and verifies content
4. **Verification Result** - Server marks proof as verified/invalid

### Supported Proof Types

- `keybase` - Keybase profile/key
- `github` - GitHub profile
- `twitter` / `x` - Twitter/X profile
- `youtube` - YouTube channel
- `twitch` - Twitch channel
- `substack` - Substack newsletter
- `dns-txt` - DNS TXT record
- `url` - Arbitrary URL proof

## Integration with Daemon

The package can be added to the koad:io daemon to provide witness services:

1. Add `koad:io-passenger-auth` to daemon's packages
2. The daemon becomes a witness provider
3. Chrome extension can request daemon to verify proofs
4. Enables cross-device proof verification

## Chrome Extension Integration

The Dark Passenger extension:

1. Has sovereign profiles stored locally
2. User clicks "Login" on a supported website
3. Extension initiates login via DDP
4. Submits all profile proofs as witnesses
5. Server verifies and completes login
6. User is authenticated on the website

## Adding to Your Meteor App

```javascript
# Add to packages
koad:io-passenger-auth
```

The login page will be available at `/passenger/login.html`.

## Security Considerations

- Sessions expire after 60 seconds of inactivity
- Proofs must be verified within 5 minutes
- Multiple witness types increase trust
- Server fetches proofs from external sources

## Related Features

- Feature 022: Sovereign Profiles - Identity system
- Dark Passenger - Chrome extension
- koad:io Daemon - Witness provider
