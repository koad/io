// deps.cjs — CJS wrapper for @koad-io/node/deps
module.exports = { ready: import('./deps.js') };
import('./deps.js').then(function(m) { Object.assign(module.exports, m); });
