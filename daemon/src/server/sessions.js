// Harness session telemetry — per-session Claude Code sensor state
// Indexed from ~/.<entity>/.local/state/harness/sessions/<session_id>.json
// Written by the statusline hook on every turn for rooted entities.
//
// Collection name is HarnessSessions to match the forge daemon-bridge
// which already has wiring for this name + harnesses.* publications.

const HarnessSessions = new Mongo.Collection('HarnessSessions', { connection: null });

Meteor.publish('harnesses.active', function () {
  const cutoff = new Date(Date.now() - 2 * 3600 * 1000);
  return HarnessSessions.find({ lastSeen: { $gte: cutoff } });
});

Meteor.publish('harnesses.entity', function (entity) {
  check(entity, String);
  return HarnessSessions.find({ entity });
});

Meteor.publish('harnesses.recent', function () {
  const cutoff = new Date(Date.now() - 24 * 3600 * 1000);
  return HarnessSessions.find({ lastSeen: { $gte: cutoff } });
});

globalThis.SessionsCollection = HarnessSessions;
