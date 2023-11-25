if(DEBUG) log.info('new collection: internals');

console.log('mong', koad.mongo)
ApplicationInternals = new Mongo.Collection('internals', koad.mongo);

if(Package["matb33:collection-hooks"]) {
	ApplicationInternals.before.insert(function(userId, doc) {
		doc.instance = koad.instance;
		return doc.created = new Date();
	});

	ApplicationInternals.before.update(function(userId, doc) {
		doc.updatedBy = koad.instance;
		return doc.updated = new Date();
	});
};




if(DEBUG) log.info('new collection: events');
ApplicationEvents = new Mongo.Collection('events', koad.mongo);

if(Package["matb33:collection-hooks"]) ApplicationEvents.before.insert(function(userId, doc) {
	doc.instance = koad.instance;
	return doc.created = new Date();
});

if(Package["matb33:collection-hooks"]) ApplicationEvents.before.update(function(userId, doc) {
	doc.updatedBy = koad.instance;
	return doc.updated = new Date();
});




if(DEBUG) log.info('new collection: errors');
ApplicationErrors = new Mongo.Collection('errors', koad.mongo);

if(Package["matb33:collection-hooks"]) ApplicationErrors.before.insert(function(userId, doc) {
	doc.instance = koad.instance;
	return doc.created = new Date();
});

if(Package["matb33:collection-hooks"]) ApplicationErrors.before.update(function(userId, doc) {
	doc.updatedBy = koad.instance;
	return doc.updated = new Date();
});

// Meteor.startup(()=>{
// 	ApplicationErrors._ensureIndex({ "created": -1 });
// })




if(DEBUG) log.info('new collection: clienterrors');
ClientErrors = new Mongo.Collection('clienterrors', koad.mongo);

if(Package["matb33:collection-hooks"]) ClientErrors.before.insert(function(userId, doc) {
	doc.instance = koad.instance;
	return doc.created = new Date();
});

if(Package["matb33:collection-hooks"]) ClientErrors.before.update(function(userId, doc) {
	doc.updatedBy = koad.instance;
	return doc.updated = new Date();
});


// collection used to record devices used within the kingdom.  A single document will be used for each device, the id is found at koad.device


if(DEBUG) log.info('new collection: devices');
ApplicationDevices = new Mongo.Collection('devices', koad.mongo);

if(Package["matb33:collection-hooks"]) ApplicationDevices.before.insert(function(userId, doc) {
	doc.instance = koad.instance;
	return doc.created = new Date();
});

if(Package["matb33:collection-hooks"]) ApplicationDevices.before.update(function(userId, doc) {
	doc.updatedBy = koad.instance;
	return doc.updated = new Date();
});


// collection used to record application server state during upstart.  A single document will be used, the id is found at koad.process


if(DEBUG) log.info('new collection: processes');
ApplicationProcesses = new Mongo.Collection('processes', koad.mongo);

if(Package["matb33:collection-hooks"]) ApplicationProcesses.before.insert(function(userId, doc) {
	doc.instance = koad.instance;
	return doc.created = new Date();
});

if(Package["matb33:collection-hooks"]) ApplicationProcesses.before.update(function(userId, doc) {
	doc.updatedBy = koad.instance;
	return doc.updated = new Date();
});


// collection used collect statistics for all items within the kingdom
// TODO: explain this shit better.


if(DEBUG) log.info('new collection: statistics');
ApplicationStatistics = new Meteor.Collection("statistics", koad.mongo);

if(Package["matb33:collection-hooks"]) ApplicationStatistics.before.insert(function(userId, doc) {
	doc.instance = koad.instance;
	return doc.created = new Date();
});

if(Package["matb33:collection-hooks"]) ApplicationStatistics.before.update(function(userId, doc) {
	doc.updatedBy = koad.instance;
	return doc.updated = new Date();
});




if(DEBUG) log.info('new collection: sessions');
ApplicationSessions = new Meteor.Collection('sessions', koad.mongo);

if(Package["matb33:collection-hooks"]) ApplicationSessions.before.insert(function(userId, doc) {
	doc.instance = koad.instance;
	return doc.created = new Date();
});

if(Package["matb33:collection-hooks"]) ApplicationSessions.before.update(function(userId, doc) {
	doc.updatedBy = koad.instance;
	return doc.updated = new Date();
});


ApplicationServices = new Mongo.Collection('ApplicationServices', koad.mongo);
if(Package["matb33:collection-hooks"]) ApplicationServices.before.insert(function(userId, doc) {
	doc.instance = koad.instance;
	return doc.created = new Date();
});

if(Package["matb33:collection-hooks"]) ApplicationServices.before.update(function(userId, doc) {
	doc.updatedBy = koad.instance;
	return doc.updated = new Date();
});


log.success('loaded koad-io/collections');
