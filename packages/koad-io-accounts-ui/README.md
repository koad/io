# koad:io-accounts-ui

**Meteor package name:** `koad:io-accounts-ui`  
**Version:** 0.3.31

The Blaze UI layer for the koad:io accounts system. Provides templates for authentication, QR code login, session management, token management, and user account settings.

## Installation

```bash
meteor add koad:io-accounts-ui
```

Or include it via the umbrella package:

```bash
meteor add koad:io-accounts
```

## Dependencies

- `koad:io-core`
- `koad:io-router`
- `koad:io-accounts-core`
- `koad:io-template-helpers`
- `templating`
- `tracker`
- `koad:meteor-awesome-qr` (implied — for QR code generation)

**npm packages:**
- `html5-qrcode` — QR code scanning (camera-based login)
- `bip39` — BIP-39 mnemonic phrase generation
- `@fortawesome/fontawesome` + `fontawesome-free-*` — icons

## Routes

The package registers client and server routes in `both/routes.js`. These include:
- `/authenticate` — landing page for new devices seeking authorization

## Template Modules

### Authenticator (`client/authenticator/`)
The main authentication interface. Handles the cross-device QR auth flow — displays a QR code for the current session, polls for authorization status, and logs in automatically when authorized.

### Social Logins (`client/social-logins/`)
UI for OAuth-based login providers (if configured in the app).

### Tokens (`client/tokens/`)
Interface for managing login tokens: view active tokens, add memos for identification, revoke individual tokens.

### Sessions (`client/sessions/`)
Interface for viewing active sessions across all devices. Rendered via the `MySessions` publication from `koad-io-accounts-core`.

### Account Settings (`client/user-account-settings.html/.js`)
User account settings panel. Profile management, password changes, and account preferences.

### Token Login (`client/login-with-token.js`)
Handles the URL-based token login flow — reads a token from the URL and calls `Login(token)`.

## File Structure

```
koad-io-accounts-ui/
├── package.js
├── both/
│   └── routes.js                          ← route definitions
├── client/
│   ├── authenticator/
│   │   ├── templates.html
│   │   └── logic.js
│   ├── social-logins/
│   │   ├── templates.html
│   │   └── logic.js
│   ├── tokens/
│   │   ├── templates.html
│   │   └── logic.js
│   ├── sessions/
│   │   ├── templates.html
│   │   └── logic.js
│   ├── user-account-settings.html
│   ├── user-account-settings.js
│   ├── login-with-token.js
│   └── styles.css
└── server/
    └── publications.js    ← MySessions publication
```

## Publications

### `MySessions`
Publishes `ApplicationSessions` for the currently logged-in user, sorted by `established` descending.

```javascript
Meteor.subscribe('MySessions');
```

## See Also

- `koad-io-accounts-core/README.md` — the server methods and logic this UI calls
- `accounts/README.md` — the mature v3.6.9 accounts implementation
