# PRIMER: authenticator/

## What is this directory?

A standalone, portable, self-sovereign identity (SSI) authentication application. It is the client-side UI layer for koad:io's identity and authentication system — distinct from the accounts package (which is server-side). Deployed and running as a Meteor app.

## What does it contain?

- `src/both/router.js` — Shared route definitions
- `src/client/logic.js` — TOTP generation and client auth logic
- `src/client/templates.html` — Blaze UI templates
- `packages/identity-profiles/` — GPG key management, social proofs, signed messages (maps to `koad:io-sovereign-profiles`)
- `packages/soverign-auth-flow/` — Witness-based auth, login UI, DDP client logic (maps to `koad:io-passenger-auth`)
- `features/` — 17 documented feature specs (GPG, TOTP, FIDO/WebAuthn, wallet auth, social OAuth, admin panel, etc.)
- `config/` — Runtime configuration (e.g., `opencode.jsonc`)
- `AGENTS.md` — AI agent context for this app

## Who works here?

Vulcan builds and maintains the authenticator app. Vesta writes specs for new auth flows (the `features/` files). Livy documents the user-facing auth journey.

## What to know before touching anything?

This app communicates with `~/.koad-io/packages/accounts` on the server side via Meteor DDP. Changes to auth flow must be coordinated with the accounts package — the client and server are tightly coupled. The `packages/` subdirectory here contains local Meteor packages specific to this app, not the shared packages in `~/.koad-io/packages/`. The `features/` directory contains spec documents for planned features; not all are implemented — check `package.js` exports before assuming a feature is live.
