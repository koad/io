// server/ready.js — koad.ready() coordination primitive
//
// Gates publications and other consumers on indexer readiness so a subscriber
// connecting during a daemon hot-reload cannot receive `removed`/`changed`
// messages for documents it never received `added` for.
//
// API:
//   koad.ready.register(name)  — declare an expected indexer (idempotent)
//   koad.ready.signal(name)    — mark indexer as ready; resolves any waiters (idempotent)
//   koad.ready.await(name)     — returns a Promise that resolves immediately if
//                                already signaled, otherwise waits until signal()
//   koad.ready.state()         — returns {[name]: ISO8601|'pending'} snapshot
//
// Usage in an indexer:
//   koad.ready.register('entities');
//   // ... scan ...
//   koad.ready.signal('entities');
//
// Usage in a publication:
//   Meteor.publish('entities', async function () {
//     await koad.ready.await('entities');
//     return Entities.find();
//   });
//
// The primitive is single-fire per server lifetime: once signaled, a name
// stays ready until the process restarts. Re-registering or re-signaling the
// same name is silently ignored (idempotent both ways).
//
// The globalThis.indexerReady timestamp map is preserved alongside for
// backwards-compatibility with /api/health and any other readers.

(function () {
  // Map<string, { promise: Promise<void>, resolve: () => void }>
  const _waiters = new Map();
  // Set<string> of names that have been signaled
  const _signaled = new Set();

  function _getOrCreate(name) {
    if (_waiters.has(name)) return _waiters.get(name);
    let resolve;
    const promise = new Promise(function (res) { resolve = res; });
    _waiters.set(name, { promise, resolve });
    return _waiters.get(name);
  }

  koad.ready = {
    /**
     * Declare that this indexer name will eventually call signal().
     * Idempotent — safe to call multiple times.
     */
    register: function (name) {
      if (!_signaled.has(name)) {
        _getOrCreate(name); // pre-create the waiter slot
      }
    },

    /**
     * Mark the named indexer as ready. Resolves all current waiters.
     * Also stamps globalThis.indexerReady[name] for /api/health readers.
     * Idempotent — calling more than once is a no-op.
     */
    signal: function (name) {
      if (_signaled.has(name)) return; // already signaled
      const iso = new Date().toISOString();

      // Preserve the legacy timestamp map so /api/health continues to work.
      if (!globalThis.indexerReady) globalThis.indexerReady = {};
      globalThis.indexerReady[name] = iso;

      _signaled.add(name);
      const entry = _getOrCreate(name);
      entry.resolve();
      log.success('[koad.ready] signaled: ' + name + ' at ' + iso);
    },

    /**
     * Returns a Promise that resolves immediately if name is already signaled,
     * otherwise waits until signal(name) is called.
     */
    await: function (name) {
      if (_signaled.has(name)) return Promise.resolve();
      return _getOrCreate(name).promise;
    },

    /**
     * Snapshot of current readiness state.
     * Returns { [name]: ISO8601 } for signaled indexers,
     * { [name]: 'pending' } for registered-but-not-yet-signaled.
     */
    state: function () {
      const out = {};
      for (const [name] of _waiters) {
        out[name] = globalThis.indexerReady && globalThis.indexerReady[name]
          ? globalThis.indexerReady[name]
          : 'pending';
      }
      // Also include any signaled names not in _waiters (signal before register)
      for (const name of _signaled) {
        if (!(name in out)) {
          out[name] = globalThis.indexerReady[name] || new Date().toISOString();
        }
      }
      return out;
    },
  };

  log.success('loaded koad-io-core/server/ready');
})();
