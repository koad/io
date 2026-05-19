


return ;

console.log('loading js');
Meteor.disconnect();

// This Should be in both server and client in a lib folder
Lighthouse = DDP.connect('https://reset.lol/');


// posts = new Mongo.Collection('posts', Lighthouse);

// set the new DDP connection to all internal packages, which require one
Meteor.connection = Lighthouse;
Accounts.connection = Meteor.connection;
Meteor.users = new Mongo.Collection('users');
Meteor.connection.subscribe('users');

// Subscribe like this:
// Lighthouse.subscribe('mySubscription');

