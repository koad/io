import { Meteor } from 'meteor/meteor';
import { Template } from 'meteor/templating';
import { ReactiveVar } from 'meteor/reactive-var';

// Client-side collection declarations (server uses { connection: null })
Entities = new Mongo.Collection('Entities');
// Passengers is already declared in application-logic.js
EnvIndex = new Mongo.Collection('EnvIndex');
BondsIndex = new Mongo.Collection('BondsIndex');
KeysIndex = new Mongo.Collection('KeysIndex');
TicklerIndex = new Mongo.Collection('TicklerIndex');
Emissions = new Mongo.Collection('Emissions');
Flights = new Mongo.Collection('Flights');

// Hostname reactive var — fetched once
const _hostname = new ReactiveVar('...');
Meteor.call('getHostname', function (err, result) {
  if (!err && result) _hostname.set(result);
});

Template.KingdomOverview.onCreated(function () {
  this.subscribe('entities');
  this.subscribe('passengers');
  this.subscribe('bonds');
  this.subscribe('keys');
  this.subscribe('tickler');
  this.subscribe('emissions');
  this.subscribe('flights.active');
  this.subscribe('flights.recent', 20);
});

Template.KingdomOverview.helpers({
  hostname() {
    return _hostname.get();
  },

  entities() {
    return Entities.find({}, { sort: { handle: 1 } }).map(function (entity) {
      const passenger = Passengers.findOne({ handle: entity.handle });
      const keysDoc = KeysIndex.findOne({ handle: entity.handle });
      const bondsDoc = BondsIndex.findOne({ handle: entity.handle });
      const ticklerDoc = TicklerIndex.findOne({ handle: entity.handle });

      const outfit = passenger && passenger.outfit;
      const hue = outfit ? outfit.hue : 0;
      const sat = outfit ? outfit.saturation : 0;
      const bri = outfit ? outfit.brightness : 30;

      const activeFlight = Flights.findOne({ entity: entity.handle, status: 'flying' });
      const result = {
        handle: entity.handle,
        avatarImage: passenger ? passenger.image : null,
        firstLetter: entity.handle.charAt(0).toUpperCase(),
        accentColor: 'hsl(' + hue + ', ' + sat + '%, ' + Math.min(bri + 20, 60) + '%)',
        keyCount: keysDoc ? keysDoc.count : 0,
        bondCount: bondsDoc ? bondsDoc.count : 0,
        tickleCount: ticklerDoc ? ticklerDoc.count : 0,
      };

      if (activeFlight) {
        result.activeFlight = true;
        result.flightBrief = activeFlight.briefSlug || '';
        result.flightSummary = activeFlight.briefSummary || '';
        result.flightElapsed = _elapsed(activeFlight.started);
        result.flightModel = activeFlight.model || '';
      }

      return result;
    });
  },

  recentFlights() {
    return Flights.find({}, { sort: { started: -1 }, limit: 20 }).map(function (flight) {
      const passenger = Passengers.findOne({ handle: flight.entity });
      const hue = passenger && passenger.outfit ? passenger.outfit.hue : 200;
      return {
        _id: flight._id,
        entity: flight.entity,
        entityColor: 'hsl(' + hue + ', 60%, 65%)',
        briefSlug: flight.briefSlug || '',
        briefSummary: flight.briefSummary || '',
        status: flight.status,
        model: flight.model || '',
        isFlying: flight.status === 'flying',
        relativeTime: _relativeTime(flight.started),
        elapsed: flight.status === 'flying' ? _elapsed(flight.started) : _formatElapsed(flight.elapsed),
        completionSummary: flight.completionSummary || '',
      };
    });
  },

  emissions() {
    return Emissions.find({}, { sort: { timestamp: -1 }, limit: 100 }).map(function (em) {
      // Derive entity color from Passengers outfit
      const passenger = Passengers.findOne({ handle: em.entity });
      const hue = passenger && passenger.outfit ? passenger.outfit.hue : 200;

      return {
        entity: em.entity,
        type: em.type,
        body: em.body,
        entityColor: 'hsl(' + hue + ', 60%, 65%)',
        relativeTime: _relativeTime(em.timestamp),
      };
    });
  },
});

// Simple relative time formatter
function _relativeTime(date) {
  if (!date) return '';
  const now = new Date();
  const diff = Math.floor((now - date) / 1000);
  if (diff < 5) return 'just now';
  if (diff < 60) return diff + 's ago';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  return Math.floor(diff / 86400) + 'd ago';
}

// Live elapsed time from a start date (for active flights)
function _elapsed(started) {
  if (!started) return '';
  const diff = Math.floor((new Date() - new Date(started)) / 1000);
  if (diff < 60) return diff + 's';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ' + (diff % 60) + 's';
  return Math.floor(diff / 3600) + 'h ' + Math.floor((diff % 3600) / 60) + 'm';
}

// Format a stored elapsed number (seconds) for landed flights
function _formatElapsed(secs) {
  if (secs == null) return '';
  if (secs < 60) return secs + 's';
  if (secs < 3600) return Math.floor(secs / 60) + 'm ' + (secs % 60) + 's';
  return Math.floor(secs / 3600) + 'h ' + Math.floor((secs % 3600) / 60) + 'm';
}
