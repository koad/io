// server/health-items.js — daemon health item declarations
//
// The daemon runs the disk scanner (entities, kingdoms, bonds, keys, alerts,
// env) plus the passengers indexer. The scanner signals 'entities' itself;
// passengers is signalled here once its indexerReady stamp exists. Sibling
// library collections are counts-only (no gating) — they populate with the
// scanner and are not independently readiness-gated.
//
// Registered in Meteor.startup so every collection exists first.

Meteor.startup(() => {
  const items = [
    ['entities',    koad.library.entities,  'Entity index (disk scanner)',   'entities',  'updatedAt'],
    ['passengers',  globalThis.Passengers,  'Passenger index (fs.watch)',    'passengers', 'name'],
    ['kingdoms',    koad.library.kingdoms,  'Kingdom index (disk scanner)',  null,        'updatedAt'],
    ['bonds',       koad.library.bonds,     'Trust bonds (disk scanner)',    null,        'updatedAt'],
    ['keys',        koad.library.keys,      'Entity keys (disk scanner)',    null,        'updatedAt'],
    ['alerts',      koad.library.alerts,    'Alerts (disk scanner)',         null,        'updatedAt'],
    ['env',         koad.library.env,       'Env index (disk scanner)',      null,        'updatedAt'],
  ];

  for (const [name, collection, description, readyKey, sortField] of items) {
    if (!collection) continue;
    koad.healthRegistry.register(name, { collection, readyKey, description, sortField });
  }

  // Passengers indexer stamps globalThis.indexerReady.passengers at the end
  // of its synchronous boot scan — mirror that into koad.ready so the health
  // gate resolves. Scanner handles 'entities' itself (async scan).
  if (globalThis.indexerReady && globalThis.indexerReady.passengers) {
    koad.ready.signal('passengers');
  }
});
