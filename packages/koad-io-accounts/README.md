# koad:io-accounts (umbrella)

**Meteor package name:** `koad:io-accounts`  
**Version:** 0.0.1 (older umbrella; see also `accounts/` at v3.6.9)

This directory is the early umbrella package that wires together `koad:io-accounts-core` and `koad:io-accounts-ui` into a single `meteor add` target. It implies both packages plus `accounts-base` and `alanning:roles`.

## Installation

```bash
meteor add koad:io-accounts
```

## What You Get

Adding this package implies all of:

- `koad:io-accounts-core` — server methods, invitation system, token auth, user shaping
- `koad:io-accounts-ui` — Blaze UI templates for login, sessions, tokens, QR auth
- `accounts-base` — Meteor's core accounts system
- `accounts-password` — Password authentication (via core)
- `alanning:roles` — Role-based access control

## When to Use This vs `accounts/`

The `accounts/` directory in this packages tree contains a separate, more mature implementation (`koad:io-accounts` at v3.6.9) with subdomain support, a full invitation system, and role publications baked in. For new koad:io apps, prefer `accounts/` (v3.6.9).

This directory (`koad-io-accounts/`) is the earlier split-stack approach: the core logic and UI are separate packages, joined here. It targets Meteor 2.2–2.7 and may not be fully updated for Meteor 3.x.

## File Structure

```
koad-io-accounts/
├── package.js
├── tests.js
├── both/
│   └── (shared isomorphic files)
├── client/
│   └── publications.js    ← (currently empty/commented out)
└── server/
    └── publications.js    ← (currently commented out; role pubs in accounts-core)
```

## Dependencies

Declared in `package.js`:
- `ecmascript`
- `templating`
- `koad:io-accounts-core` (implied)
- `koad:io-accounts-ui` (implied)
- `accounts-base`
- `alanning:roles`

## See Also

- `koad-io-accounts-core/README.md` — core logic: methods, invitations, tokens
- `koad-io-accounts-ui/README.md` — UI templates: login, QR, sessions, tokens
- `accounts/README.md` — the mature v3.6.9 accounts implementation
