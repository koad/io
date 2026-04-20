// Flight telemetry — sanitized projection of entity flight state
// Full flight logs (dispatch prompts, transcripts) stay on disk in ~/.juno/control/flights/
// This collection holds only what's useful for the operator dashboard:
//   entity, brief slug, summary, status, elapsed, model, stats

const VALID_STATUSES = ['flying', 'landed', 'stale'];

const Flights = new Mongo.Collection('Flights', { connection: null });

Meteor.methods({
  'flight.open'(doc) {
    check(doc, {
      _id: String,
      entity: String,
      briefSlug: Match.Optional(String),
      briefSummary: Match.Optional(String),
      host: Match.Optional(String),
      model: Match.Optional(String),
      started: Match.Optional(Date),
    });

    const now = new Date();
    const record = {
      _id: doc._id,
      entity: doc.entity,
      briefSlug: doc.briefSlug || '',
      briefSummary: doc.briefSummary || '',
      status: 'flying',
      host: doc.host || '',
      model: doc.model || '',
      started: doc.started || now,
      ended: null,
      elapsed: null,
      completionSummary: null,
      stats: {
        toolCalls: null,
        contextTokens: null,
        inputTokens: null,
        outputTokens: null,
        cost: null,
      },
    };

    Flights.upsert({ _id: doc._id }, { $set: record });
    console.log(`[FLIGHT] open: ${doc.entity}/${doc.briefSlug || doc._id}`);
    return { _id: doc._id };
  },

  'flight.close'(flightId, update) {
    check(flightId, String);
    check(update, {
      ended: Match.Optional(Date),
      elapsed: Match.Optional(Number),
      completionSummary: Match.Optional(String),
      stats: Match.Optional({
        toolCalls: Match.OneOf(Number, null),
        contextTokens: Match.OneOf(Number, null),
        inputTokens: Match.OneOf(Number, null),
        outputTokens: Match.OneOf(Number, null),
        cost: Match.OneOf(Number, null),
      }),
    });

    const now = new Date();
    const set = {
      status: 'landed',
      ended: update.ended || now,
    };

    if (update.elapsed != null) set.elapsed = update.elapsed;
    if (update.completionSummary != null) set.completionSummary = update.completionSummary.slice(0, 300);
    if (update.stats != null) set.stats = update.stats;

    const count = Flights.update({ _id: flightId }, { $set: set });
    if (count === 0) {
      console.log(`[FLIGHT] close: no record for ${flightId} — inserting stub`);
      Flights.upsert({ _id: flightId }, {
        $set: {
          _id: flightId,
          entity: 'unknown',
          briefSlug: '',
          briefSummary: '',
          status: 'landed',
          host: '',
          model: '',
          started: now,
          ...set,
          stats: update.stats || { toolCalls: null, contextTokens: null, inputTokens: null, outputTokens: null, cost: null },
        },
      });
    }
    console.log(`[FLIGHT] close: ${flightId}`);
    return { _id: flightId };
  },

  'flight.stale'(flightId) {
    check(flightId, String);
    Flights.update({ _id: flightId }, { $set: { status: 'stale' } });
    console.log(`[FLIGHT] stale: ${flightId}`);
    return { _id: flightId };
  },
});

// Minimongo ({ connection: null }) cannot observe cursors with sort+limit
// (requires ordered observe / addedBefore). Use date-range selectors
// instead — Minimongo handles those fine. Client sorts in its own Minimongo.

Meteor.publish('flights.active', function () {
  return Flights.find({ status: 'flying' });
});

Meteor.publish('flights.entity', function (entity) {
  check(entity, String);
  return Flights.find({ entity });
});

Meteor.publish('flights.recent', function () {
  const cutoff = new Date(Date.now() - 24 * 3600 * 1000);
  return Flights.find({ $or: [
    { status: 'flying' },
    { started: { $gte: cutoff } },
  ]});
});

// Export for REST endpoint — attach to globalThis so sibling files see it
// without ES-module imports. Implicit globals (`FlightsCollection = Flights`)
// work under sloppy mode but throw ReferenceError under strict/module mode,
// which is what Meteor's dev runtime enforces.
globalThis.FlightsCollection = Flights;
