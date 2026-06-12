// Server: { connection: null } — scanner populates directly from disk.
// Client: default connection — receives data from the server's null publication.
var _local = Meteor.isServer ? { connection: null } : {};

koad.library.entities = new Mongo.Collection('entities', _local);
koad.library.kingdoms = new Mongo.Collection('kingdoms', _local);
koad.library.bonds    = new Mongo.Collection('bonds',    _local);
