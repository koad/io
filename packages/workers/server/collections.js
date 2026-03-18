WorkerProcesses = new Mongo.Collection('workers');

WorkerProcesses.allow({
  insert(userId, doc) {
    // The user must be logged in and the document must be owned by the user.
    return false;
  },

  update(userId, doc, fields, modifier) {
    // Can only remove your own documents.
    if(userId) return true;
    return false;
  },

  remove(userId, doc) {
    return false;
  },

  fetch: ['owner']
});


// Create indexes for efficient queries
Meteor.startup(function() {
  WorkerProcesses.createIndex({ service: 1, instance: 1 }, { unique: true });
  WorkerProcesses.createIndex({ lastHeartbeat: 1 });
  WorkerProcesses.createIndex({ claimedBy: 1 });
  WorkerProcesses.createIndex({ enabled: 1, insane: 1 });
});

