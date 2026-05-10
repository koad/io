Meteor.methods({
  'system.health'() {
    return koad.system.health();
  },
  'system.loadavg'() {
    return koad.system.loadavg();
  },
  'system.memory'() {
    return koad.system.memory();
  },
});
