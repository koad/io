// sigchain.cjs — CJS mirror of sigchain.js
//
// Re-exports all named exports from sigchain.js for CommonJS consumers.
// Meteor's server-side require() and older Node tooling can consume this.
//
// All actual logic lives in sigchain.js (ESM). This file is a thin wrapper
// using dynamic import() to bridge the ESM↔CJS boundary.
//
// Usage (CommonJS):
//   const { buildSpiritGenesis, signEntry, verifyEntry } = require('@koad-io/node/sigchain');
//
// Note: because sigchain.js is ESM and uses top-level async (sha256.digest),
// all exports from this CJS wrapper are async-resolved via the module promise.
// Consumers that need synchronous access should use the ESM form.

'use strict';

// Lazy-load the ESM module once and cache the promise.
let _mod = null;

function _load() {
  if (!_mod) {
    _mod = import('./sigchain.js');
  }
  return _mod;
}

// ---------------------------------------------------------------------------
// Synchronous re-export shims — each returns a Promise that resolves to the
// actual function's return value. This matches how Node handles CJS↔ESM.
// ---------------------------------------------------------------------------

async function buildSpiritGenesis(opts) {
  const m = await _load();
  return m.buildSpiritGenesis(opts);
}

async function buildLeafAuthorize(opts) {
  const m = await _load();
  return m.buildLeafAuthorize(opts);
}

async function buildLeafRevoke(opts) {
  const m = await _load();
  return m.buildLeafRevoke(opts);
}

async function buildPruneAll(opts) {
  const m = await _load();
  return m.buildPruneAll(opts);
}

async function buildKeySuccession(opts) {
  const m = await _load();
  return m.buildKeySuccession(opts);
}

async function wrapEntry(opts) {
  const m = await _load();
  return m.wrapEntry(opts);
}

async function canonicalDagJson(entry) {
  const m = await _load();
  return m.canonicalDagJson(entry);
}

async function preImageBytes(entry) {
  const m = await _load();
  return m.preImageBytes(entry);
}

async function computeCID(entry) {
  const m = await _load();
  return m.computeCID(entry);
}

async function signEntry(unsignedEntry, identity, opts) {
  const m = await _load();
  return m.signEntry(unsignedEntry, identity, opts);
}

async function verifyEntry(entry, expectedCID, signerPublicKey) {
  const m = await _load();
  return m.verifyEntry(entry, expectedCID, signerPublicKey);
}

module.exports = {
  buildSpiritGenesis,
  buildLeafAuthorize,
  buildLeafRevoke,
  buildPruneAll,
  buildKeySuccession,
  wrapEntry,
  canonicalDagJson,
  preImageBytes,
  computeCID,
  signEntry,
  verifyEntry,
};
