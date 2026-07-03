// both/collections.js — Entity collection backing stores.
//
// Two namespaces, populated by different sources:
//
//   koad.library.{entities,kingdoms,bonds,keys,alerts,env,sessions}
//     Disk truth. Populated by the scanner (server-side, {connection:null}).
//     Only the daemon runs the scanner.
//
//   koad.indexes.{entities,kingdoms,bonds,keys,alerts,env}
//     Derived truth. Populated by DDP subscribe in remote mode.
//     Production apps, musium, websites use these.
//
// Both namespaces use the same Mongo collection names and schemas.
// Consumers read from whichever namespace their mode populates.
//
// Server: { connection: null } — local, not DDP-connected (we sync manually).
// Client: default connection — receives data from server publications.

var _local = Meteor.isServer ? { connection: null } : {};

// Disk truth — scanner populates these
koad.library.entities = new Mongo.Collection('entities', _local);
koad.library.kingdoms = new Mongo.Collection('kingdoms', _local);
koad.library.bonds    = new Mongo.Collection('bonds',    _local);
koad.library.keys     = new Mongo.Collection('keys',     _local);
koad.library.alerts   = new Mongo.Collection('alerts',   _local);
koad.library.env      = new Mongo.Collection('env',      _local);
