# `~/.koad-io/packages/` — Structure Guide

This guide is written for agents arriving cold. It explains what the packages directory is, how it is organized, how each package relates to the others, and what to look for when navigating it.

---

## What This Directory Is

`~/.koad-io/packages/` contains the **Meteor package layer** of the koad:io framework. These are local Meteor packages — not published to Atmosphere, not installed via npm — loaded directly by any Meteor application that sets:

```bash
KOAD_IO_PACKAGE_DIRS="$HOME/.koad-io/packages"
METEOR_PACKAGE_DIRS=$KOAD_IO_PACKAGE_DIRS  # DEPRECATED: Meteor compat shim
```

They provide the shared UI toolkit, data layer, and runtime infrastructure that all koad:io Meteor apps use. A developer building a new koad:io app starts with `meteor add koad:io` and gets all of this.

---

## Technology Context

- **Runtime:** Meteor (v3.x), targeting Meteor 3.0+
- **Templating:** Blaze (reactive HTML templates)
- **Database:** MongoDB via Meteor's reactive data system
- **Build system:** Standard Meteor package format (`package.js` defines everything)
- **JavaScript:** ES6+, using `ecmascript` Meteor package

These packages are **not** React, Vue, or Next.js components. They are Meteor-native Blaze templates and isomorphic JavaScript modules.

---

## Directory Layout

Each subdirectory is one package. A typical package looks like:

```
package-name/
├── package.js          ← Required. Meteor package manifest: name, version, deps, files, exports.
├── README.md           ← User-facing documentation.
├── PRIMER.md           ← AI-readable deep orientation (where present).
├── client/             ← Client-only code (browser).
├── server/             ← Server-only code (Node.js).
├── both/               ← Isomorphic code (runs on both sides).
└── lib/                ← Shared library code (loaded first on both sides).
```

The `package.js` file is the single source of truth for:
- The **Meteor package name** (e.g., `koad:io-core`) — use this with `meteor add`
- The **version**
- All **dependencies** (`api.use(...)`)
- Which **files** are loaded and in which environment
- What **symbols** are exported globally

---

## Package Inventory

### Foundation Layer

These packages form the base. Everything else depends on them.

| Directory | Meteor name | Purpose |
|-----------|-------------|---------|
| `core/` | `koad:io-core` | The root package. Sets up the global `koad` object, system utilities, cron, BIP-39, machine ID. All other packages depend on this. |
| `koad-io/` | `koad:io` | The meta-package. Add this one package and you get everything: core, router, session, templating, head-js, accounts-base, minifiers, mobile support. Start here for new apps. |
| `koad-io-core/` | — | Empty placeholder directory. No `package.js`. Not a functional package. |

### Routing

| Directory | Meteor name | Purpose |
|-----------|-------------|---------|
| `router/` | `koad:io-router` | Primary router for koad:io apps (v3.6.9). Based on Iron Router, unified into a single package. Handles client routing, server routes, RESTful endpoints, middleware hooks, template lookup. |
| `io-router/` | `koad:io-router` | Earlier version of the same router (v3.3.0). Two directories, same package name — `router/` is the current one. |
| `io-router-progress/` | `koad:io-router-progress` | Progress bar and spinner UI for route transitions. Pure CSS with JS configuration. Implies `koad:io-router`. |

**Note on `router/` vs `io-router/`:** Both declare `koad:io-router`. Meteor resolves packages in `KOAD_IO_PACKAGE_DIRS` order (set `METEOR_PACKAGE_DIRS=$KOAD_IO_PACKAGE_DIRS` for Meteor compat). `router/` is the maintained version (v3.6.9); `io-router/` is an older fork (v3.3.0). In a single `KOAD_IO_PACKAGE_DIRS`, whichever appears first wins. Verify your setup uses `router/`.

### Session & State

| Directory | Meteor name | Purpose |
|-----------|-------------|---------|
| `session/` | `koad:io-session` | Persistent client-side Session (v3.6.9). Wraps Meteor's `Session` with localStorage persistence via amplifyjs. Provides `Session.setPersistent()`, `Session.setAuth()`, `Session.setTemp()`. |
| `io-session/` | `koad:io-session` | Older version of the same package (v0.5.0). Same situation as `router/` vs `io-router/`. `session/` is the maintained version. |

### Accounts & Authentication

The accounts layer is split across three packages, assembled bottom-up:

| Directory | Meteor name | Purpose |
|-----------|-------------|---------|
| `koad-io-accounts-core/` | `koad:io-accounts-core` | Core account logic. Consumable tokens, session authorization, device enrollment, invitation system, user shaping on registration, role bootstrapping. Exports `Login`, `Logout` (client), `ApplicationInvitations` (server). |
| `koad-io-accounts-ui/` | `koad:io-accounts-ui` | Account UI templates. Authenticator, social logins, token management, session list, account settings, QR code login. Uses `html5-qrcode` and `bip39`. |
| `koad-io-accounts/` | `koad:io-accounts` | Umbrella package. Implies `koad:io-accounts-core` + `koad:io-accounts-ui` + `accounts-base` + `alanning:roles`. Add this one package to get the complete accounts system. |
| `accounts/` | `koad:io-accounts` | Separate accounts package (v3.6.9) with roles, invitations, and subdomain support. Distinct from `koad-io-accounts/` (v0.0.1). The v3.6.9 version is the more mature implementation. |
| `koad-io-login-ui/` | `koad:io-login-ui` | Standalone login UI component. Used when you want just the login screen without the full accounts package. |

**Choosing which accounts package to use:**
- For a full koad:io app: use `accounts/` (v3.6.9) via `meteor add koad:io-accounts`
- For the older split stack: use `koad-io-accounts/` which implies `koad-io-accounts-core` and `koad-io-accounts-ui`
- For login screen only: use `koad-io-login-ui/`

### Templating & UI

| Directory | Meteor name | Purpose |
|-----------|-------------|---------|
| `templating/` | `koad:io-templating` | Blaze helper library + reactive layout engine. Registers ~60 global template helpers (dates, users, roles, numbers, strings, cursors). Provides `ApplicationLayout` for multi-panel window management. |
| `io-template-helpers/` | `koad:io-template-helpers` | Earlier version of Blaze helpers (v0.0.2). `templating/` supersedes this. |
| `head-js/` | `koad:io-plus-head-js` | Integrates Head.js for browser feature detection and resource loading. Client-only. |
| `theme-engine/` | `koad:io-theme-engine` | HSL-based CSS variable theme system. Dark mode toggle. Exposes `koad.theme.set.hue(n)` and `koad.theme.darkmode.toggle()`. |
| `search/` | `koad:io-search` | Search UI with real-time local (Minimongo) and server-side search. `{{> koadSearchBox}}` template, `koad.search.register()` API. |

### Infrastructure

| Directory | Meteor name | Purpose |
|-----------|-------------|---------|
| `logger/` | `koad:io-event-logger` | Client error capture and event logging. Global `window.onerror` handler, `log.info()` method, `ClientErrors` MongoDB collection (stored as `malfunctions`). |
| `workers/` | `koad:io-worker-processes` | Scheduled background worker processes. `koad.workers.start({service, interval, task})`. MongoDB-persisted state, retry with backoff, hot-reload safety. |

---

## Dependency Tree

Reading bottom-up — most apps start at `koad:io` and get everything below it automatically:

```
koad:io                           ← start here for new apps
├── koad:io-core                  ← always required
├── koad:io-router                ← routing
├── koad:io-session               ← persistent session
├── koad:io-templating            ← Blaze helpers + layout
│   └── koad:io-session           ← (implied)
├── koad:io-plus-head-js          ← browser detection
└── accounts-base                 ← Meteor accounts
```

Optional packages added on top:
```
koad:io-accounts                  ← full auth system
├── koad:io-accounts-core
└── koad:io-accounts-ui

koad:io-theme-engine              ← CSS theming
koad:io-search                    ← search UI
koad:io-event-logger              ← error/event logging
koad:io-worker-processes          ← background workers
```

---

## How to Find Things

**Looking for routing logic?**
Read `router/package.js` for the file list, then `router/server/` for server-side route handling and `router/client/` for client-side rendering.

**Looking for authentication?**
- `koad-io-accounts-core/server/methods.js` — all Meteor methods (`revokeLoginToken`, `enroll.device`, `authorize.session`, `invitation.*`)
- `koad-io-accounts-core/client/globals.js` — `Login()`, `Logout()`, session dataport observer
- `koad-io-accounts-ui/client/` — all UI templates

**Looking for template helpers?**
`templating/client/helpers/` — 12 files, each covering a domain (users, roles, dates, numbers, etc.)

**Looking for the global `koad` object?**
Defined in `core/`. Expanded by every other package that uses `api.imply('koad:io-core')`.

**Looking for the layout engine?**
`templating/client/layout/engine.js` — `ApplicationLayout`.

**Looking for session persistence?**
`session/lib/persistent_session.js` — the amplifyjs wrapper.

**Looking for background jobs?**
`workers/server/logic.js` — worker scheduler implementation.

---

## Package Format Quick Reference

Every `package.js` follows this structure:

```javascript
Package.describe({
  name: 'koad:io-example',   // meteor add koad:io-example
  version: '3.6.9',
  summary: 'One-line description',
  documentation: 'README.md'  // or null if no README
});

Npm.depends({ ... });         // npm packages used server-side

Package.onUse(function(api) {
  api.versionsFrom(['3.0']);
  api.use('koad:io-core');    // dependencies
  api.imply('koad:io-core');  // re-export to consumers
  api.addFiles([...], 'client' | 'server' | /* both */);
  api.export('GlobalSymbol');
  api.mainModule('index.js', 'client');
});
```

`api.imply()` means: any app that adds this package also automatically gets the implied package. This is how `koad:io` bundles everything.

---

## Version Conventions

Most maintained packages are at version `3.6.9`. Packages at other versions are either:
- Older forks not yet updated (`io-router` at 3.3.0, `io-session` at 0.5.0)
- Early-stage packages not yet formalized (`koad-io-accounts` at 0.0.1, `workers` at 0.0.1)
- Stable but standalone (`koad-io-accounts-core` at 0.3.3, `logger` at 0.3.0)

The `3.6.9` packages are the active, maintained set.

---

## Notes for Agents

1. **`package.js` is the ground truth.** When in doubt about what a package does, what it imports, or what it exports — read `package.js` first.

2. **Duplicate package names exist.** `router/` and `io-router/` both claim `koad:io-router`. Same for `session/` and `io-session/`. The higher-version one (`router/`, `session/`) is current.

3. **`koad-io-core/` is empty.** The directory exists but has no `package.js` and no files. It is not the same as `core/` (which is `koad:io-core`). Do not confuse them.

4. **The `koad` global object** is set up in `core/` and extended by every package that depends on it. It is the primary namespace for all koad:io runtime APIs.

5. **Meteor context required.** These packages only work inside a Meteor application. They cannot be imported via `require()` or used standalone.

---

*This guide is maintained by Livy (livy@kingofalldata.com). Source: `~/.livy/docs/reference/packages-structure.md`.*
