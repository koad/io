Certainly! Here's a README for your "bare" skeleton:

---

# Bare Skeleton

The **Bare Skeleton** is a minimal starting point for your projects using koad:io. It provides you with the essential structure to kickstart your development. This skeleton is ideal for those who want a clean slate to build their projects from the ground up.

## Getting Started

To use this skeleton, make sure you have [koad:io](https://github.com/koad/io) installed and an entity to use it with (ie: `alice`:

Once you have koad:io installed, you can create a new project folder to use the Skeleton within:
```
mkdir ~/Workbench/a-new-super-dope-project
cd ~/Workbench/a-new-super-dope-project
```

Then can use alice to spawn the skeleton within
```bash
alice spawn bare
```

This command will deploy the Bare Skeleton into your current working directory. You can then start building your project on top of this minimal foundation.

## What's Included

The Bare Skeleton includes the following:

- A basic Meteor app structure in the `src` directory.
- A simple routing configuration in `src/both/router.js`.
- An empty template file in `src/client/templates.html`.
- An empty CSS file in `src/client/styles.css`.
- An empty application logic file in `src/client/application-logic.js`.
- An empty `head` tag in `src/client/head.html`.
- `.env` file with default configuration settings.
- Config files for device-specific settings in the `config` directory.
- A `README.md` file to help you get started.

## npm dependencies are APP-OWNED (read this before adding a package)

koad:io packages **do not declare `Npm.depends()`**. Ever. Neither does this
skeleton's src — it declares what it needs in `src/package.json`, and
`control/post-install` installs that set.

**Why.** `Npm.depends()` makes Meteor write `.npm/package/node_modules` *inside
the package's own source tree*. That directory is one slot shared by every app
on the machine, keyed by the Node version of the Meteor release each app runs.
Two apps on different releases (daemon on `METEOR@3.4.2`/Node 22, a fresh
skeleton on `METEOR@3.6`/Node 26) flip `.node_version` back and forth, each
reinstalling while the other is bundling. The loser dies in
`copyNodeModulesDirectory` with
`ENOENT: no such file or directory, lstat '.../.npm/package'` — and because the
directory sits inside a *watched* tree, each install also triggers
`=> Server modified -- restarting...` in every app that shares the package.

**Measured, not theorised.** `koad:io-core`'s `Npm.depends()` block (added
2026-08-25) killed the daemon, control-tower and desktop-interface at
`2026-11-12T18:51:41Z`, at the instant a freshly spawned skeleton printed
`koad:io-core: updating npm dependencies`. The same signature is in the logs on
2026-11-11 (daemon + desktop-interface), 2026-11-10 (`ELOOP @noble/ed25519`),
2026-10-28 (`.node_version`) and 2026-08-24 (`.meteor-portable-2.json`).

**The contract, three layers, three homes:**

| layer | where the module lives | examples |
|---|---|---|
| server, `require()`d bare by packages | the app's `src/package.json` | `signale`, `ssh2`, `systeminformation`, `body-parser` |
| client crypto, imported at top level by `koad:io-core` | the app's `src/package.json` | `@noble/ed25519`, `@scure/bip39` |
| ESM-only, bundleable from nowhere | pre-built bundle in app `public/` | `@ipld/dag-json`, `multiformats` |

`control/post-install` installs layer 1 and 2 into every spawned app. The
canonical list and pins live in `~/.forge/packages/core/server/app-deps.js`,
which also verifies them at boot and prints the exact
`meteor npm install --save ...` command when something is missing. **If you add
a module to the contract, add it in all three places** — that file, this
skeleton's post-install, and the package that needs it.

If you are tempted to add `Npm.depends()` to a package because the app "shouldn't
need to know", that is exactly the trade that cost a kingdom its nervous system.
Put it in the app.

## Next Steps

Once you've created your project using the Bare Skeleton, you can start adding your code, templates, and assets to build your custom application. You have the flexibility to shape your project according to your specific needs.

Refer to the [koad:io documentation](https://github.com/koad/io) for more details on using koad:io to manage your project.

Happy coding!

