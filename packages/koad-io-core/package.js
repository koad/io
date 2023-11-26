Package.describe({
	"name": "koad:io-core",
	"version": "0.1.281",
	"summary": "The core koad-io package that all koad-io meteor apps use.  This package sets up the koad global object which is expanded upon by other koad:io packages",
	"grain": "eGq8SP8XpJ2zhFM5s53KBN",
	"git": "https://github.com/koad/io",
	"repository": {
		"type": "git",
		"url": "keybase://team/koad_io/core"
	},
	"documentation": "https://book.koad.sh/"
});

Npm.depends({
	"signale": "1.4.0",
	"ua-parser": "0.3.5",
	"os": "0.1.1",
	"pidusage": "2.0.18",
	"fibers": "5.0.0",
	"simpl-schema": "1.10.2",
	"node-machine-id": "1.1.12",
	"cron": "1.8.2",
	"systeminformation": "5.11.14",
    "bitcoinjs-lib": "6.1.3",
    "bip32": "4.0.0",
    "bip39": "3.1.0",
    "ssh2": "1.14.0"
});

Package.onUse(function(api) {
  	api.versionsFrom(["2.2", "2.6"])

	api.imply("meteor-base");
	api.imply("mongo");

	api.imply("es5-shim");
	api.imply("ecmascript");
	api.imply("shell-server");
	api.imply("check");

	api.use("random");
	api.use("mongo");
	api.use("ecmascript");
	api.use("matb33:collection-hooks", "server", {weak: true});

	api.imply("koad:io-session", "client");

	// loads first, initializes the koad object.
	api.addFiles("both/initial.js");

	// loads onto the initialized the koad object.
	api.addFiles("server/logger.js", "server");
	api.addFiles("server/upstart.js", "server");
	api.addFiles("client/upstart.js", "client");

	api.addFiles([
		"both/time-constants.js",
		"both/global-helpers.js",
		"both/router.js",
		"both/identity.js",
	]);  

	api.addFiles([
		"server/collections.js",
		"server/discovery.js",
		"server/sysinfo.js",
		"server/counters.js",
		"server/cron.js",
	], "server");  

	api.export(["SECONDS", "MINUTES", "HOURS", "DAYS", "WEEKS", "MONTHS", "YEARS"]);
	api.export(["allow", "ALLOW", "deny", "DENY"]);
	api.export(["debug","DEBUG"]);

	// Export the logger created within this package...
	api.export("log", "server");
	
	// Export the collections created within this package...
	api.export("Counters", "server");
  	api.export("ClientErrors", "server");

  	api.export("ApplicationEvents", "server");
  	api.export("ApplicationErrors", "server");
	api.export("ApplicationDevices", "server");
	api.export("ApplicationProcesses", "server");
	api.export("ApplicationStatistics", "server");
	api.export("ApplicationServices", "server");
	api.export("ApplicationSessions", "server");

	// Export the koad object created by this package...
	api.export("koad");

});
