// identity-writer.cjs — CJS mirror of identity-writer.js
//
// Re-exports writeIdentityRegistry and updateSigchainHead for CommonJS consumers.
// Meteor's server-side require() can consume this via absolute path.
//
// All actual logic lives in identity-writer.js (ESM). This file is a thin
// wrapper using dynamic import() to bridge the ESM↔CJS boundary.

'use strict';

let _mod = null;

function _load() {
  if (!_mod) _mod = import('./identity-writer.js');
  return _mod;
}

async function writeIdentityRegistry(opts) {
  const mod = await _load();
  return mod.writeIdentityRegistry(opts);
}

async function updateSigchainHead(opts) {
  const mod = await _load();
  return mod.updateSigchainHead(opts);
}

module.exports = { writeIdentityRegistry, updateSigchainHead };
