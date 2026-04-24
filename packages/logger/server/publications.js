import { Meteor } from 'meteor/meteor';
// Mongo import removed — unused (all collections come from koad:io-core via imply)
import os from 'os';

// NOTE: Counters is minimongo ({connection: null}) — cannot be published via DDP.
// This publication was a no-op (would return a minimongo cursor, not a real collection).
// Removed. If you need a counter view, publish from a real Mongo collection instead.
// Meteor.publish('counters', ...) — removed 2026-04-24

ApplicationEvents.allow({
  insert() { return false; },
  update() { return false; },
  remove() { return false; }
});

const logEvent = {
  info(method, msg, verbose, route) {
    logEvent._log('INFO', method, msg, 'info', 'fa fa-info-circle', route);
  },
  check(method, msg, verbose, route) {
    logEvent._log('CHECK', method, msg, 'muted', 'fa fa-question-circle', route);
  },
  system(method, msg, verbose, route, evidence) {
    logEvent._log('SYSTEM', method, msg, 'primary', 'fa fa-check-circle', route, evidence);
  },
  success(method, msg, verbose, route) {
    logEvent._log('SUCCESS', method, msg, 'success', 'fa fa-thumbs-o-up', route);
  },
  warning(method, msg, verbose, route) {
    logEvent._log('WARNING', method, msg, 'warning', 'fa fa-minus-circle', route);
  },
  error(method, msg, verbose, route, errorData) {
    logEvent._log('ERROR', method, msg, 'danger', 'fa fa-warning', route, errorData);
  },
  // Meteor 3: server-side callers write directly to ClientErrors — do not
  // use Meteor.call('logEvent') from server context (Fiber-based, broken in M3).
  async _log(type, method, msg, cls, icon, route, dump) {
    const event = {
      message: msg || 'no message',
      type,
      method,
      class: cls,
      icon,
      route: route || 'server://',
      dump: dump || false,
      connection: 'server://',
      user: 'localhost',
      date: new Date(),
      nodeVer: process.version,
      subType: 'n/a'
    };

    const counterIndex = `el_${type}`;
    const existingCounter = await Counters.findOneAsync({ _id: counterIndex });
    if (!existingCounter) {
      await Counters.insertAsync({ _id: counterIndex, created: new Date(), current: 1 });
    } else {
      await Counters.updateAsync({ _id: counterIndex }, { $inc: { current: 1 } });
    }

    await ClientErrors.insertAsync(event);
  }
};

// Meteor 3: bare `this` at module top level is undefined in Reify — use globalThis.
globalThis.logEvent = logEvent;

koad.log = logEvent;

Meteor.methods({
  clientLog: async function(data) {
    logEvent.info('CLIENT::LOG', data.message, true, data.pathname);
    
    if (this.userId) {
      await Meteor.users.updateAsync(
        { _id: this.userId },
        { $inc: { 'counters.errors.info': 1 } }
      );
    }
    
    if (this.connection?.id) {
      await ApplicationSessions.updateAsync(
        { _id: this.connection.id },
        { $inc: { 'errors.info': 1 } }
      );
    }
    
    await Counters.updateAsync(
      { _id: 'Errors' },
      { $inc: { 'client.info': 1 } }
    );
  },

  uncaughtError: async function(data) {
    logEvent.error('CLIENT::UNCAUGHT', data.message, true, data.route?.path, data);

    if (this.userId) {
      await Meteor.users.updateAsync(
        { _id: this.userId },
        { $inc: { 'counters.errors.uncaught': 1 } }
      );
    }

    if (this.connection?.id) {
      await ApplicationSessions.updateAsync(
        { _id: this.connection.id },
        { $inc: { 'errors.uncaught': 1 } }
      );
    }

    await Counters.updateAsync(
      { _id: 'Errors' },
      { $inc: { 'client.uncaught': 1 } }
    );
  },

  caughtError: async function(data) {
    logEvent.error('CLIENT::CAUGHT', data.message, true, data.route?.path, data);
    
    if (this.userId) {
      await Meteor.users.updateAsync(
        { _id: this.userId },
        { $inc: { 'counters.errors.caught': 1 } }
      );
    }
    
    if (this.connection?.id) {
      await ApplicationSessions.updateAsync(
        { _id: this.connection.id },
        { $inc: { 'errors.caught': 1 } }
      );
    }
    
    await Counters.updateAsync(
      { _id: 'Errors' },
      { $inc: { 'client.caught': 1 } }
    );
  },

  purgeApplicationEvents: async function() {
    if (!this.userId) {
      throw new Meteor.Error(400, 'You must be logged in. [invalid-opts]');
    }

    const loggedInUser = await Meteor.userAsync();
    if (!loggedInUser || !(await Roles.userIsInRoleAsync(loggedInUser, ['super-admin']))) {
      throw new Meteor.Error(498, 'Access denied, you must be a super-admin. [not-authorized]');
    }

    console.log(`Purging event log, triggered by: ${loggedInUser.username}`);
    logEvent.info('SERVER::METHOD', `Purging event log [sire: ${loggedInUser.username}]`);

    const purgeOldEvents = async (type, daysOld) => {
      const targetDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
      const query = type === 'ERROR'
        ? { type: 'ERROR', created: { $lt: targetDate } }
        : { type: { $ne: 'ERROR' }, created: { $lt: targetDate } };

      // Meteor 3: cursor.toArray() doesn't exist — use fetchAsync()
      const oldEvents = await ApplicationEvents.find(query).fetchAsync();
      let counter = 0;

      for (const doc of oldEvents) {
        await ApplicationEvents.removeAsync(doc._id);
        counter++;
      }

      logEvent.info('SERVER::METHOD', `Successfully purged ${counter} ${type} events older than ${targetDate}`);
      return counter;
    };

    await purgeOldEvents('non-error', 7);
    await purgeOldEvents('error', 14);
  },

  logEvent: async function(event) {
    if (!event) return;

    if (this.connection) {
      event.connection = this.connection.id;
      event.clientAddress = this.connection.clientAddress;
      const user = await Meteor.userAsync();
      if (user) {
        event.user = Meteor.userId();
        if (user.username) event.user += `::${user.username}`;
      } else {
        event.user = this.connection.clientAddress;
      }
    } else {
      event.connection = 'server://';
      event.user = 'localhost';
    }

    if (!event.message) event.message = 'A corrupt message has been sent to the event logger';
    if (!event.subType) event.subType = 'n/a';

    event.date = new Date();
    event.nodeVer = process.version;

    const counterIndex = `el_${event.type}`;
    const existingCounter = await Counters.findOneAsync({ _id: counterIndex });

    if (!existingCounter) {
      await Counters.insertAsync({
        _id: counterIndex,
        created: new Date(),
        current: 1
      });
    } else {
      await Counters.updateAsync(
        { _id: counterIndex },
        { $inc: { current: 1 } }
      );
    }

    await ClientErrors.insertAsync(event);
  }
});

Meteor.publish(null, function () {
  return ApplicationStatistics.find({}, {
    fields: {
      total_count: true,
      list_count: true,
      update_count: true,
      delete_count: true,
      get_count: true,
      insert_count: true
    }
  });
});

Meteor.startup(async () => {
  const ident = Meteor.settings?.public?.ident?.instance || 'koad:io-unknown';
  const ingress = Meteor.settings?.public?.ident?.ingress || 'unknown';

  await ApplicationEvents.insertAsync({
    created: new Date(),
    message: 'Upstart initiated',
    type: 'SYSTEM',
    method: 'UPSTART',
    class: 'primary',
    icon: 'fa fa-check-circle',
    ingress,
    ident,
    label: process.env.KOAD_IO_LABEL,
    service: process.env.KOAD_IO_TYPE,
    instance: process.env.KOAD_IO_INSTANCE,
    dump: false,
    user: os.userInfo().username,
    host: os.hostname()
  });
});
