# `~/.koad-io/packages` — Meteor Packages for koad:io

The `packages` folder contains prebuilt UI components and logic modules for use with Meteor-based applications. These are tailored to work with Blaze, but play nicely with other JS frontends.

This system allows small, single-use apps (focused and simple) to collectively form a larger GTD-style system when they share an `entity`.

---

## 🔧 Purpose

* Serve as a shared UI toolkit for `koad:io` entities.
* Provide modular components: forms, menus, modals, auth systems, etc.
* Encourage building focused, minimal Meteor apps that collaborate via shared entity-based MongoDBs.

---

## 🌐 Integration with Meteor

To use these packages:

1. Point `KOAD_IO_PACKAGE_DIRS` to include this directory (set in `~/.koad-io/.env`):

   ```bash
   KOAD_IO_PACKAGE_DIRS="$HOME/.koad-io/packages"
   METEOR_PACKAGE_DIRS=$KOAD_IO_PACKAGE_DIRS  # DEPRECATED: Meteor compat shim
   ```

   Or, combine it with entity-specific packages:

   ```bash
   KOAD_IO_PACKAGE_DIRS="$HOME/.alice/packages:$HOME/.ecoincore/packages:$HOME/.koad-io/packages"
   METEOR_PACKAGE_DIRS=$KOAD_IO_PACKAGE_DIRS  # DEPRECATED: Meteor compat shim
   ```

2. Add the package(s) to your app:

   ```bash
   meteor add koad:io
   ```

Packages are resolved in order, so your own custom packages can override defaults.

---

## 🤖 Entity-Integrated Apps

Each app can be paired with a specific entity (e.g., `~/.alice`) and its MongoDB instance. Auth and state are synced automatically, allowing apps to "see each other" and collaborate without centralization.

* Useful for **building small apps** that still behave as **a unified system**.

---

## ✍️ Customization & Contribution

* Build your own packages and drop them into this folder.
* Fork and modify the UI packages to fit your stack.
* Submit improvements or new packages via PR to [github.com/koad/io](https://github.com/koad/io).

---

## 📜 Licensing

Each package may carry its own license. Check each package's `README.md` and `LICENSE` file before reuse or redistribution.

---

> Pro Tip: Use these packages to keep your apps minimal and decoupled, while still composing a full-featured entity-driven interface.

