// client/ready.js — koad.ready() client-side coordination primitive
//
// Mirrors the server-side koad.ready API using ReactiveVar so Blaze
// templates and Tracker computations react when a named source becomes
// ready (e.g. a null publication delivering its initial dataset).
//
// API (same shape as server):
//   koad.ready.register(name)  — declare an expected source (idempotent)
//   koad.ready.signal(name)    — mark source as ready (idempotent)
//   koad.ready.await(name)     — returns a Promise that resolves when ready
//   koad.ready.isReady(name)   — reactive boolean check (Tracker-aware)
//   koad.ready.state()         — snapshot of all registered sources

(function () {
  var _vars = {};
  var _signaled = {};

  function _getOrCreate(name) {
    if (!_vars[name]) _vars[name] = new ReactiveVar(false);
    return _vars[name];
  }

  koad.ready = {
    register: function (name) {
      _getOrCreate(name);
    },

    signal: function (name) {
      if (_signaled[name]) return;
      _signaled[name] = new Date().toISOString();
      _getOrCreate(name).set(true);
    },

    isReady: function (name) {
      return _getOrCreate(name).get();
    },

    await: function (name) {
      if (_signaled[name]) return Promise.resolve();
      var rv = _getOrCreate(name);
      return new Promise(function (resolve) {
        Tracker.autorun(function (c) {
          if (rv.get()) {
            c.stop();
            resolve();
          }
        });
      });
    },

    state: function () {
      var out = {};
      for (var name in _vars) {
        out[name] = _signaled[name] || 'pending';
      }
      return out;
    },
  };
})();
