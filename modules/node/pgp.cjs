// pgp.cjs — CJS entry for @koad-io/node/pgp
//
// kbpgp is CommonJS; pgp.js imports it via createRequire so the ESM module
// is safe to dynamic-import from a CJS context. Expose a .ready promise;
// callers that need sync access should use the ESM entry (pgp.js).

let _exports = {};
const _ready = import('./pgp.js').then(function(m) {
  Object.assign(_exports, m);
  return _exports;
});

module.exports = _exports;
module.exports.ready = _ready;
