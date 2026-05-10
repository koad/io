// auth.cjs — CJS mirror of auth.js
//
// Re-exports named exports from auth.js for CommonJS consumers.
// Meteor's server-side require() and older Node tooling can consume this.
//
// All actual logic lives in auth.js (ESM). This file is a thin wrapper
// using dynamic import() to bridge the ESM↔CJS boundary.
//
// Usage (CommonJS):
//   const { challenge, respond, verify, pendingNonceCount } = require('@koad-io/node/auth');

'use strict';

let _mod = null;

function _load() {
  if (!_mod) {
    _mod = import('./auth.js');
  }
  return _mod;
}

async function challenge() {
  const m = await _load();
  return m.challenge();
}

async function respond(nonce, privateKey) {
  const m = await _load();
  return m.respond(nonce, privateKey);
}

async function verify(nonce, signatureB64, pubKeyB64) {
  const m = await _load();
  return m.verify(nonce, signatureB64, pubKeyB64);
}

async function pendingNonceCount() {
  const m = await _load();
  return m.pendingNonceCount();
}

async function sweepExpiredNonces() {
  const m = await _load();
  return m.sweepExpiredNonces();
}

module.exports = { challenge, respond, verify, pendingNonceCount, sweepExpiredNonces };
