// deps.cjs — CJS wrapper for @koad-io/node/deps
//
// ESM-only packages can't be require()'d synchronously.
// Expose a .ready promise; callers that need sync access should use the
// ESM entry (deps.js) via Meteor's mainModule or native ESM.

let _exports = {};
const _ready = import('./deps.js').then(function(m) {
  Object.assign(_exports, m);
  return _exports;
});

module.exports = _exports;
module.exports.ready = _ready;
