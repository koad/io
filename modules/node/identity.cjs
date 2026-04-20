// identity.cjs — CJS wrapper for @koad-io/node/identity
module.exports = { ready: import('./identity.js') };
import('./identity.js').then(function(m) { Object.assign(module.exports, m); });
