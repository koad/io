# PRIMER: packages/

## What is this directory?

The shared Meteor package layer for koad:io. These are local Meteor packages — not published to Atmosphere, not installed via npm — loaded directly by any Meteor application that points `KOAD_IO_PACKAGE_DIRS` at this directory.

## What does it contain?

19 packages providing UI components, data infrastructure, and runtime services for Blaze-based Meteor apps:

`accounts`, `accounts-ui`, `activity-stream`, `awesome-qr`, `core`, `harness`, `head-js`, `ipfs-client`, `koad-io`, `koad-io-core`, `logger`, `navigation`, `router`, `search`, `session`, `sovereign-profiles`, `templating`, `theme-engine`, `workers`

Each package follows the standard Meteor package layout: `package.js` (manifest), `client/`, `server/`, `both/`, `README.md`, and sometimes a `PRIMER.md` for AI orientation.

## Who works here?

Vulcan builds and maintains these packages. A developer building a koad:io Meteor app consumes them. Livy documents individual packages when they have user-facing APIs.

## What to know before touching anything?

**Quarantine model:** Several packages have a `.gitignore` that blocks their contents from being committed. This is intentional — it marks work-in-progress packages that are on disk but not yet validated for the repository. Quarantined packages are not broken; they are incomplete. Do not force-add past a quarantine gitignore. Check the `STRUCTURE.md` file in this directory for the full package dependency map before editing.

To use these packages in a Meteor app:

```bash
KOAD_IO_PACKAGE_DIRS="$HOME/.koad-io/packages"
METEOR_PACKAGE_DIRS=$KOAD_IO_PACKAGE_DIRS  # DEPRECATED: Meteor compat shim
```

Packages are resolved in order; entity-specific packages override framework packages when their paths are prepended.
