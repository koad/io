Package.describe({
	"name": "koad:io-entities",
	"version": "1.0.0",
	"summary": "Entity identity endpoints — avatar, profile JSON, public keys, and Atom feed served from ~/.<handle>/",
	"documentation": "https://book.koad.sh/"
});

Package.onUse(function(api) {
	api.versionsFrom(["3.0", "3.4"]);

	api.use("ecmascript");
	api.use("koad:io-core");

	api.addFiles([
		"both/collections.js",
	]);

	api.addFiles([
		"server/avatar.js",
		"server/profile-json.js",
		"server/profile-keys.js",
		"server/profile-atom.js",
		"server/scanner.js",
	], "server");

	api.export("koad");

});
