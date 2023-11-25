Counters = new Meteor.Collection("counters", {idGeneration : 'MONGO', connection: null});
Counters.allow({
    insert: function (userId, doc) {
        return false;
    },
    update: function (userId, doc, fieldNames, modifier) {
        return false;
    },
    remove: function (userId, doc) {
        return false;
    }
});

// todo:
// this collection is in memory only.
// make summaries of the counters and push them to the process state periodically,. 

log.success('loaded koad-io/counters');
