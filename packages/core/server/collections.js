/**
 * Application Collections
 * 
 * Core Mongo collections used throughout the koad:io ecosystem.
 * Collections are global and available on both client and server.
 */

// Deny all client-side updates to user documents
if(Meteor.users) Meteor.users.deny({
  update() { return true; }
});

// koad-io application collections start with lower case
ApplicationErrors = new Mongo.Collection('errors', koad.mongo);
ApplicationEvents = new Mongo.Collection('events', koad.mongo);
ApplicationDevices = new Mongo.Collection('devices', koad.mongo);
ApplicationServices = new Mongo.Collection('services', koad.mongo);
ApplicationSessions = new Meteor.Collection('sessions', koad.mongo);
ApplicationInternals = new Mongo.Collection('internals', koad.mongo);
ApplicationProcesses = new Mongo.Collection('processes', koad.mongo);
ApplicationSupporters = new Mongo.Collection('supporters', koad.mongo);
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

	ApplicationSupporters.before.insert(function(userId, doc) {
		doc.instance = koad.instance;
		return doc.created = new Date();
	});

	ApplicationSupporters.before.update(function(userId, doc) {
		doc.updatedBy = koad.instance;
		return doc.updated = new Date();
	});
};

// TTL index: unconsumed consumables expire after 1 hour
// Application logic enforces per-document TTL; this is the MongoDB-level safety net.
Meteor.startup(async () => {
	if (koad.mongo?.connection === null) {
		log.debug('[collections] Skipping index creation (no mongo connection)');
		return;
	}
	try {
		await ApplicationConsumables.createIndexAsync(
			{ when: 1 },
			{ expireAfterSeconds: 3600, name: 'consumables_ttl' }
		);
	} catch (error) {
		log.error('[collections] Failed to create ApplicationConsumables TTL index:', error.message);
	}
});

// Kingdoms collection — one record per kingdom the daemon participates in
// Schema per VESTA-SPEC-115: kingdom as sovereign participation unit
// _id is the kingdom slug (e.g. 'koad-io') — CID will be added when sigchains are established
Kingdoms = new Mongo.Collection('Kingdoms', { connection: null });

// CrossKingdomBonds collection — bonds that cross kingdom boundaries
// Schema per VESTA-SPEC-115 §7.2: cross-kingdom trust relationships
// Detection: bond's issuer and recipient belong to different kingdoms per kingdoms.json
CrossKingdomBonds = new Mongo.Collection('CrossKingdomBonds', { connection: null });

// Note: Kingdoms and CrossKingdomBonds use { connection: null } (always minimongo).
// createIndexAsync on minimongo throws, so no startup index block for these collections.

log.success('loaded koad-io-core/collections');
