// Node test shim — re-exports blob-crypto.js content for require() in tests
// The actual module uses browser ES module patterns + conditional module.exports.
// This wrapper loads it cleanly via require().

'use strict';

// Polyfills needed for Node
if (typeof globalThis.btoa === 'undefined') {
  globalThis.btoa = (str) => Buffer.from(str, 'binary').toString('base64');
  globalThis.atob = (str) => Buffer.from(str, 'base64').toString('binary');
}

module.exports = require('../client/crypto/blob-crypto.js');
