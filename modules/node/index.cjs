// index.cjs — CJS wrapper for @koad-io/node
// Allows require('@koad-io/node') from CommonJS callers (Meteor's CJS resolver,
// older Node scripts, Jest with default transforms, etc.)
//
// Dynamic import is used so the ESM module graph still resolves correctly.

let _exports;

async function load() {
  if (!_exports) {
    _exports = await import('./index.js');
  }
  return _exports;
}

// Synchronous-compatible pattern: expose a .ready() promise and top-level
// named exports via module.exports after the promise resolves.
// For fully synchronous callers that can't await, they should migrate to ESM.
module.exports = {
  ready: load(),
  // Eagerly expose the promise for callers that do: require('@koad-io/node').ready.then(...)
};

// After load resolves, patch module.exports in-place so cached require() calls
// that destructure after await also get the right values.
load().then(function(m) {
  Object.assign(module.exports, m);
});
