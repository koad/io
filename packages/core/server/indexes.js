// server/indexes.js — koad.indexes namespace
//
// Single registry for all indexed collections. Each indexer sets its entry
// at startup — whether scanning disk or bridging from a named service.
//
//   koad.indexes.bonds = BondsIndex;          // local { connection: null }
//   koad.indexes.bonds = bridgedCollection;   // remote { connection: conn }
//
//   koad.indexes.fingerprints = FingerprintEntityIndex;  // set by accounts/server/fingerprint-entity-index.js
//   koad.indexes.fingerprints.lookup(fp) → { handle, basedir, kind, canonicalFingerprint }
//
// Consumers (publications, API routes, other indexers) read from
// koad.indexes.<name> without caring where the data comes from.
//
// The object itself is the inventory — Object.keys(koad.indexes) lists
// every active index in this process.

koad.indexes = {};
