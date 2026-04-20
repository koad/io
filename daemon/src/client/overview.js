import { Meteor } from 'meteor/meteor';

// Daemon-specific setup for the koad:io-overview package.
//
// Collections are declared below — they're owned here (daemon side) because the
// daemon is the canonical data source. The package (koad:io-overview) reads
// globalThis.<CollectionName> so it sees them without an explicit import.
//
// The forge reads the same collection names via daemon-bridge.js mirror.

globalThis.Entities = new Mongo.Collection('Entities');
globalThis.BondsIndex = new Mongo.Collection('BondsIndex');
globalThis.KeysIndex = new Mongo.Collection('KeysIndex');
globalThis.TicklerIndex = new Mongo.Collection('TicklerIndex');
globalThis.Emissions = new Mongo.Collection('Emissions');
globalThis.Flights = new Mongo.Collection('Flights');
globalThis.HarnessSessions = new Mongo.Collection('HarnessSessions');
globalThis.Kingdoms = new Mongo.Collection('Kingdoms');
globalThis.CrossKingdomBonds = new Mongo.Collection('CrossKingdomBonds');
globalThis.EnvIndex = new Mongo.Collection('EnvIndex');

// Passengers and Alerts are declared in application-logic.js
// (accessed via globalThis.Passengers, globalThis.Alerts in the package)

// Subscribe to all collections the overview template needs.
Meteor.startup(function () {
  Meteor.subscribe('entities');
  Meteor.subscribe('passengers');
  Meteor.subscribe('bonds');
  Meteor.subscribe('keys');
  Meteor.subscribe('tickler');
  Meteor.subscribe('emissions');
  Meteor.subscribe('flights.active');
  Meteor.subscribe('flights.recent');
  Meteor.subscribe('harnesses.active');
  Meteor.subscribe('harnesses.recent');
  Meteor.subscribe('alerts');
  Meteor.subscribe('kingdoms.all');
  Meteor.subscribe('crossKingdomBonds');
  Meteor.subscribe('env');
});

// Configure profile URL for daemon context — links out to the public site.
if (typeof KoadOverview !== 'undefined') {
  KoadOverview.configure({ profileBaseUrl: 'https://kingofalldata.com' });
}
