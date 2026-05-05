// identity-receiver.cjs — CJS mirror of identity-receiver.js
//
// Re-exports named exports from identity-receiver.js for CommonJS consumers.
// Meteor's server-side require() and older Node tooling can consume this.
// All actual logic lives in identity-receiver.js (ESM).

'use strict';

let _mod = null;

function _load() {
  if (!_mod) {
    _mod = import('./identity-receiver.js');
  }
  return _mod;
}

async function receiveHeadSubmission(submission, opts) {
  const m = await _load();
  return m.receiveHeadSubmission(submission, opts);
}

async function queryIdentityHeads(params, opts) {
  const m = await _load();
  return m.queryIdentityHeads(params, opts);
}

module.exports = {
  receiveHeadSubmission,
  queryIdentityHeads,
};
