// identity-resolver.cjs — CJS mirror of identity-resolver.js
//
// Re-exports resolveIdentity from identity-resolver.js for CommonJS consumers.
// Meteor's server-side require() and older Node tooling can consume this.
//
// All actual logic lives in identity-resolver.js (ESM). This file is a thin
// wrapper using dynamic import() to bridge the ESM↔CJS boundary.
//
// Usage (CommonJS):
//   const { resolveIdentity } = require('@koad-io/node/identity-resolver');

'use strict';

// Lazy-load the ESM module once and cache the promise.
let _mod = null;

function _load() {
  if (!_mod) _mod = import('./identity-resolver.js');
  return _mod;
}

/**
 * Proxy that dynamically imports the ESM module and calls resolveIdentity.
 * @param {string} handle
 * @param {object} [opts]
 * @returns {Promise<object>}
 */
async function resolveIdentity(handle, opts) {
  const mod = await _load();
  return mod.resolveIdentity(handle, opts);
}

module.exports = { resolveIdentity };
