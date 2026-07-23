Package.describe({
	"name": "koad:io-core",
	"version": "3.7.0",
	"summary": "The core koad-io package that all koad-io meteor apps use.  This package sets up the koad global object which is expanded upon by other koad:io packages",
	"documentation": "https://book.koad.sh/"
});

// Npm dependencies are intentionally app-owned. See npm-versions.json for known-good versions.

Package.onUse(function(api) {
	api.versionsFrom(["3.0", "3.4"])

	api.imply("meteor-base");
	api.imply("mongo");

	api.imply("blaze-html-templates");
	api.imply("jquery");
	api.imply("reactive-var");
	api.imply("reactive-dict");
	api.imply("tracker");

	api.imply("standard-minifier-css");
	api.imply("standard-minifier-js");

	api.imply("es5-shim");
	api.imply("ecmascript");
	api.imply("typescript");

	api.imply("shell-server");
	api.imply("ddp-rate-limiter");

	api.imply("check");

	api.use("random");
	api.use("mongo");
	api.use("ecmascript");
	api.use("webapp");

	// api.use("mizzao:timesync");
	// api.use("matb33:collection-hooks", "server", {weak: true});
	// api.use("koad:io-local-collection", "client");

	// api.imply("koad:io-session", "client");
	// api.imply("koad:io-local-collection", "client");

	api.use('underscore');
	api.use('ejson'); // for cloning

	api.use("reactive-var");
	api.use("tracker");


	// loads first, initializes the koad object.
	api.addFiles("both/initial.js");

	// koad.identity factory — defines createKoadIdentity() global (VESTA-SPEC-149).
	// Must load after initial.js (koad global) and before server/client identity wiring.
	api.addFiles("both/identity-factory.js");

	// loads onto the initialized the koad object.
	api.addFiles("server/logger.js", "server");
	api.addFiles("server/upstart.js", "server");
	api.addFiles("server/ready.js", "server");  // koad.ready() — indexer readiness gate; must load before any indexer
	api.addFiles("server/indexes.js", "server"); // koad.indexes — collection registry; must load before any indexer
	api.addFiles("client/upstart.js", "client");
	api.addFiles("client/ready.js", "client");   // koad.ready() — reactive readiness gate (mirrors server API)
	api.addFiles("client/search.js", "client");

	api.addFiles([
		"both/utils.js",
		"both/time-constants.js",
		"both/global-helpers.js",
	]);

	api.addFiles([
		"server/collections.js",
		"server/discovery.js",
		"server/system-health.js",
		"server/sysinfo.js",
		"server/counters.js",
		"server/search.js",
	], "server");


	api.export("GlobalSearch", "server");
	api.export("SearchHistory", 'client');

	api.export(["SECONDS", "MINUTES", "HOURS", "DAYS", "WEEKS", "MONTHS", "YEARS"]);
	api.export(["allow", "ALLOW", "deny", "DENY"]);
	api.export(["debug","DEBUG"]);

	// Export the logger created within this package...
	api.export("log", "server");

	// Export the collections created within this package...
	api.export("ApplicationCounters", "server");

	api.export("ApplicationEvents", "server");
	api.export("ApplicationErrors", "server");
	api.export("ApplicationDevices", "server");
	api.export("ApplicationProcesses", "server");
	api.export("ApplicationStatistics", "server");
	api.export("ApplicationServices", "server");
	api.export("ApplicationSessions", "server");
	api.export("ApplicationConsumables", "server");
	api.export("ApplicationSupporters", "server");

	// Export the koad object created by this package...
	api.export("koad");

});


Package.onTest(function (api) {
	api.use('koad:io-core');
	api.use('tinytest');
	api.use('test-helpers');
	api.addFiles('test/utils_test.js');
});

