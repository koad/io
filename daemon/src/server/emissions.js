// Entity emissions — in-memory notification bus
// Entities push notices/warnings/errors/requests via DDP method or REST
// Operator subscribes via DDP to see them in real time

const VALID_TYPES = ['notice', 'warning', 'error', 'request'];

const Emissions = new Mongo.Collection('Emissions', { connection: null });

Meteor.methods({
  getHostname() {
    const os = Npm.require('os');
    return os.hostname();
  },

  'entity.emit'(data) {
    check(data, {
      entity: String,
      type: String,
      body: String,
    });

    if (!VALID_TYPES.includes(data.type)) {
      throw new Meteor.Error('invalid-type', `Type must be one of: ${VALID_TYPES.join(', ')}`);
    }

    const doc = {
      entity: data.entity,
      type: data.type,
      body: data.body,
      timestamp: new Date(),
    };

    const id = Emissions.insert(doc);
    console.log(`[EMIT] ${data.entity}/${data.type}: ${data.body}`);
    return { _id: id };
  },

  'emissions.clear'(entity) {
    check(entity, Match.Optional(String));
    if (entity) {
      const count = Emissions.remove({ entity });
      return { cleared: count };
    }
    const count = Emissions.remove({});
    return { cleared: count };
  },
});

// All emissions
Meteor.publish('emissions', function () {
  return Emissions.find({}, { sort: { timestamp: -1 }, limit: 200 });
});

// Filtered by entity
Meteor.publish('emissions.entity', function (handle) {
  check(handle, String);
  return Emissions.find({ entity: handle }, { sort: { timestamp: -1 }, limit: 100 });
});

// Export for REST endpoint — see flights.js for why globalThis is needed
globalThis.EmissionsCollection = Emissions;
