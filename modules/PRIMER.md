---
type: primer
folder: ~/.koad-io/modules/
parents:
  - ~/.koad-io/
children:
  - path: node/
    blurb: "@koad-io/node — the shared Node.js identity and crypto package; dual CJS+ESM exports; SPEC-149/150/111/148 implementations"
    status: documented
features:
  - name: koad-io-node-package
    blurb: Shared Node.js package (@koad-io/node) exposing identity, crypto, sigchain, and auth primitives to any Node consumer
    location: ~/.koad-io/modules/node/package.json
relates-to:
  - ~/.koad-io/KOAD_IO.md
  - ~/.koad-io/packages/core/PRIMER.md
  - ~/.livy/features/koad-io-node-package.md
entities:
  - vulcan
  - juno
  - livy
last-walked: 2026-05-10
as-of: a176654204bedb918d3342206b9ae5e226687616
---

# ~/.koad-io/modules/ — Shared Node.js Modules

> Not Meteor packages. Not bash commands. Pure Node — importable from any Node context that can reach the filesystem.

`~/.koad-io/modules/` holds framework-level Node.js packages that span the stack: Meteor packages, CLI tools, standalone daemons, and test harnesses can all import from here. The only tenant today is `node/` (`@koad-io/node`).

## Why modules/ exists

The Meteor package build system is isolated from npm. For a long time, crypto and identity primitives had to be duplicated: one copy hacked into the Meteor package via patch-npm-exports, another living somewhere in the CLI. `modules/node` ended that — one canonical source, imported wherever Node can reach it.

## Contents

| Path | Package name | Purpose |
|------|-------------|---------|
| `node/` | `@koad-io/node` | Identity, crypto, sigchain, and auth — the substrate layer |

## Relationship to Meteor packages

`~/.koad-io/packages/` contains Meteor packages. `~/.koad-io/modules/` contains plain npm packages. They are siblings, not nested. The Meteor package `koad:io-core` maintains a parallel implementation (`both/identity-factory.js`) that mirrors `@koad-io/node/identity` for the `api.addFiles()` context — a planned migration will replace the copy with a direct Npm.require import.

---

*Livy walked this folder 2026-05-10. One child folder: node/ — documented.*
