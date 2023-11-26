// Create our in-memory-only secrets collection.
if(!Meteor.secrets) Meteor.secrets = new Mongo.Collection('Secrets', {connection: null});

// Give authorized users access to secrets data by scope
// TODO: get the roles of the user, and publish those roles's secrets
Meteor.publish('secrets', function (scope) {
  check(scope, String);

  if (Roles.userIsInRole(this.userId, ['view-secrets','super-admin'], scope)) {
    return Meteor.secrets.find({scope: scope});
  } else {
    // user not authorized. do not publish secrets
    this.stop();
    return;
  };

});

log.success('loaded koad-io/secrets.js');
