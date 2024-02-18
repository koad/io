// Deny all client-side updates to user documents
if(Meteor.users) Meteor.users.deny({
  update() { return true; }
});


// koad-io application collections start with lower case
ApplicationErrors = new Mongo.Collection('errors', koad.mongo);
ApplicationEvents = new Mongo.Collection('events', koad.mongo);
ApplicationDevices = new Mongo.Collection('devices', koad.mongo);
ApplicationSessions = new Meteor.Collection('sessions', koad.mongo);
ApplicationServices = new Mongo.Collection('services', koad.mongo);
ApplicationInternals = new Mongo.Collection('internals', koad.mongo);
ApplicationProcesses = new Mongo.Collection('processes', koad.mongo);
ApplicationStatistics = new Meteor.Collection("statistics", koad.mongo);
ApplicationConsumables = new Mongo.Collection('consumables', koad.mongo);


if(Package["matb33:collection-hooks"] && Meteor.users) {
	ApplicationInternals.before.insert(function(userId, doc) {
		doc.instance = koad.instance;
		return doc.created = new Date();
	});

	ApplicationInternals.before.update(function(userId, doc) {
		doc.updatedBy = koad.instance;
		return doc.updated = new Date();
	});

	ApplicationEvents.before.insert(function(userId, doc) {
		doc.instance = koad.instance;
		return doc.created = new Date();
	});

	ApplicationEvents.before.update(function(userId, doc) {
		doc.updatedBy = koad.instance;
		return doc.updated = new Date();
	});

	ApplicationErrors.before.insert(function(userId, doc) {
		doc.instance = koad.instance;
		return doc.created = new Date();
	});

	ApplicationErrors.before.update(function(userId, doc) {
		doc.updatedBy = koad.instance;
		return doc.updated = new Date();
	});

	ApplicationDevices.before.insert(function(userId, doc) {
		doc.instance = koad.instance;
		return doc.created = new Date();
	});

	ApplicationDevices.before.update(function(userId, doc) {
		doc.updatedBy = koad.instance;
		return doc.updated = new Date();
	});

	ApplicationProcesses.before.insert(function(userId, doc) {
		doc.instance = koad.instance;
		return doc.created = new Date();
	});

	ApplicationProcesses.before.update(function(userId, doc) {
		doc.updatedBy = koad.instance;
		return doc.updated = new Date();
	});

	ApplicationStatistics.before.insert(function(userId, doc) {
		doc.instance = koad.instance;
		return doc.created = new Date();
	});

	ApplicationStatistics.before.update(function(userId, doc) {
		doc.updatedBy = koad.instance;
		return doc.updated = new Date();
	});

	ApplicationSessions.before.insert(function(userId, doc) {
		doc.instance = koad.instance;
		return doc.created = new Date();
	});

	ApplicationSessions.before.update(function(userId, doc) {
		doc.updatedBy = koad.instance;
		return doc.updated = new Date();
	});

	ApplicationServices.before.insert(function(userId, doc) {
		doc.instance = koad.instance;
		return doc.created = new Date();
	});

	ApplicationServices.before.update(function(userId, doc) {
		doc.updatedBy = koad.instance;
		return doc.updated = new Date();
	});
};

log.success('loaded koad-io/collections');
