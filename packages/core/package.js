Package.describe({
	"name": "koad:io-core",
	"version": "3.6.9",
	"summary": "The core koad-io package that all koad-io meteor apps use.  This package sets up the koad global object which is expanded upon by other koad:io packages",
	"documentation": "https://book.koad.sh/"
});

Npm.depends({
	"signale": "1.4.0",
	"ua-parser": "0.3.5",
	"os": "0.1.1",
	"pidusage": "2.0.18",
	"simpl-schema": "1.10.2",
	"node-machine-id": "1.1.12",
	"cron": "1.8.2",
	"systeminformation": "5.11.14",
	// "bitcoinjs-lib": "6.1.3",
	// "@scure/bip32": "1.3.2",
	"@scure/bip39": "1.2.1", // https://github.com/paulmillr/scure-bip39
	// "ethereum-cryptography": "2.1.2",
	"ssh2": "1.14.0",
	"kbpgp": "2.1.15", // Keybase PGP. Reverted from 2.1.17 — Meteor build-cache wedge on bump (rename ENOENT during ipfs-core dep cascade). SPEC-148 §6 pin-agreement violation pending fix.
	"ipfs-core": "0.18.1", // IPFS implementation for distributed storage
	"ipfs-http-client": "60.0.1" // IPFS HTTP client

	// ── Shared crypto/IPFS deps ──
	// Moved to daemon/src/package.json (app-level) so Meteor's client bundler
	// can resolve bare specifiers. Also live in ~/.koad-io/modules/node/.
	// Npm.depends() can't serve the client bundler for ESM-only packages.
});

Package.onUse(function(api) {
	api.versionsFrom(["3.0", "3.3"])

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

	// api.imply("hot-module-replacement@0.5.4");
	// api.imply("blaze-hot");

	// api.imply("check");

	api.use("random");
	api.use("mongo");
	api.use("ecmascript");

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

	// loads onto the initialized the koad object.
	api.addFiles("server/logger.js", "server");
	api.addFiles("server/upstart.js", "server");
	api.addFiles("client/upstart.js", "client");
	api.addFiles("client/search.js", "client");

	api.addFiles([
		"both/utils.js",
		"both/time-constants.js",
		"both/global-helpers.js",
		"both/router.js",
		"both/identity-factory.js",  // createKoadIdentity() — consumed by server/identity.js and client/identity.js
	]);

	api.addFiles([
		"server/collections.js",
		"server/discovery.js",
		"server/identity.js",
		"server/identity-init.js",
		"server/sysinfo.js",
		"server/counters.js",
		"server/search.js",
		"server/cron.js",
	], "server");

	api.addFiles([
		"client/identity.js",
	], "client");

	// Eagerly load shared crypto/IPFS deps on the client.
	// mainModule establishes the ESM import tree; addFiles above load as legacy scripts.
	// profile-builder.js, ipfs-client.js, and stream.js all read from koad.deps.
	api.mainModule("client/deps.js", "client");


	api.export("GlobalSearch", "server");
	api.export("SearchHistory", 'client');

	api.export(["SECONDS", "MINUTES", "HOURS", "DAYS", "WEEKS", "MONTHS", "YEARS"]);
	api.export(["allow", "ALLOW", "deny", "DENY"]);
	api.export(["debug","DEBUG"]);

	// Export the logger created within this package...
	api.export("log", "server");

	// Export the collections created within this package...
	api.export("Counters", "server");

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

	// Export crypto symbols populated by client/deps.js.
	// IPLD primitives (dagJson*, CID, sha256, base64) are server-only —
	// they're not consumed by client code today; see client/deps.js note.
	// koad.deps.pgp lazy-loads the kbpgp browser bundle on first call.
	api.export(["ed"], "client");
	api.export(["clearsign", "verify"], "client");

});


Package.onTest(function (api) {
	api.use('koad:io-core');
	api.use('tinytest');
	api.use('test-helpers');
	api.addFiles('test/utils_test.js');
});

