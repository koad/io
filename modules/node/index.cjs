// index.cjs — CJS entry for @koad-io/node
//
// Builds the koad object synchronously so Meteor's Reify-based require()
// gets a real object at import time (not a promise).
//
// The crypto/IPFS deps (dag-json, multiformats, ed25519) are ESM-only and
// loaded lazily — they're not needed at koad object construction time.
// Meteor's client/deps.js (a mainModule in ESM context) imports them directly.

const { createIdentityShape } = require('./identity.cjs');

const koad = {
  maintenance: true,
  lighthouse: null,
  extension: null,
  instance: null,
  gateway: null,
  session: null,
  internals: 'unset',
  identity: createIdentityShape(),
  storage: {},
  library: {},
  format: {
    timestamp: function(d, s) {
      if (!d) d = new Date();
      if (!s) s = ':';
      const date = new Date(d);
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      const seconds = String(date.getSeconds()).padStart(2, '0');
      return `${year}${s}${month}${s}${day}${s}${hours}${s}${minutes}${s}${seconds}`;
    },
  },
  seeders: [],
  emitters: [],
  trackers: [],
  deps: {},
};

// Lazy-load ESM deps into koad.deps when requested
let _depsLoaded = false;
const _loadDeps = import('./deps.js').then(function(m) {
  Object.assign(koad.deps, {
    dagJsonEncode: m.dagJsonEncode,
    dagJsonDecode: m.dagJsonDecode,
    CID: m.CID,
    sha256: m.sha256,
    base64: m.base64,
    ed: m.ed,
    pgp: m.pgp,
  });
  _depsLoaded = true;
});

module.exports = { koad, createIdentityShape, depsReady: _loadDeps };
