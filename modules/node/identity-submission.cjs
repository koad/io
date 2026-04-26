// identity-submission.cjs — CJS mirror of identity-submission.js
//
// Re-exports named exports from identity-submission.js for CommonJS consumers.
// Meteor's server-side require() and older Node tooling can consume this.
// All actual logic lives in identity-submission.js (ESM).

'use strict';

let _mod = null;

function _load() {
  if (!_mod) {
    _mod = import('./identity-submission.js');
  }
  return _mod;
}

async function buildHeadSubmission(opts) {
  const m = await _load();
  return m.buildHeadSubmission(opts);
}

async function verifyHeadSubmission(submission, opts) {
  const m = await _load();
  return m.verifyHeadSubmission(submission, opts);
}

module.exports = {
  buildHeadSubmission,
  verifyHeadSubmission,
};
