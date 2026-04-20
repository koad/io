// both/initial.js — Initialize the koad global object.
//
// Phase 2: koad object base shape sourced from @koad-io/node (the standalone
// Node.js module at ~/.koad-io/modules/node/). The daemon app declares this
// as a file: dep in daemon/src/package.json so Meteor's bundler can resolve it.
//
// This file is loaded first (see package.js api.addFiles order) and establishes
// the globalThis.koad global. Subsequent files in the package decorate it with
// Meteor-specific properties (reactive vars, collections, etc.).

import { koad as _koad } from '@koad-io/node';

console.log('koad:io - loading has begun');

// Assign to globalThis so the Meteor global `koad` is available everywhere.
// We spread to get a plain mutable copy; the module's export is also plain.
globalThis.koad = Object.assign({}, _koad);
