// server/indexes.js — koad.indexes namespace
//
// Single registry for all indexed collections. Each indexer sets its entry
// at startup — whether scanning disk or bridging from a named service.
//
//   koad.indexes.bonds = BondsIndex;          // local { connection: null }
//   koad.indexes.bonds = bridgedCollection;   // remote { connection: conn }
//
// Consumers (publications, API routes, other indexers) read from
// koad.indexes.bonds without caring where the data comes from.
//
// The object itself is the inventory — Object.keys(koad.indexes) lists
// every active index in this process.

koad.indexes = {};
