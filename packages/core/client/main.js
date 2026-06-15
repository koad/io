// client/main.js — ESM mainModule entry point for koad:io-core client
//
// Load order: api.addFiles run first (both/initial.js, both/identity-factory.js,
// client/upstart.js, client/ready.js, client/search.js), then this mainModule runs.
//
// 1. Import deps.js to wire koad.deps.{ed,pgp,ceremony} on the koad global
// 2. Wire koad.identity from koad.generate.identity()

import './deps.js';

// Wire identity substrate — same as the former app-level client/identity.js
koad.identity = koad.generate.identity();

console.log('[koad.identity] Client identity substrate loaded. isLoaded:', koad.identity.isLoaded);
