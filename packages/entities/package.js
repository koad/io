Package.describe({
	"name": "koad:io-entities",
	"version": "1.1.0",
	"summary": "Entity identity endpoints — scanner, remote DDP subscriber, avatar, profile JSON, public keys, and Atom feed. Three-mode: scanner (disk), remote (DDP+proxy), off.",
	"documentation": "https://book.koad.sh/"
});

Package.onUse(function(api) {
	api.versionsFrom(["3.0", "3.4"]);

	api.use("ecmascript");
	api.use("koad:io-core");

	// Collections — both namespaces (library + indexes)
	api.addFiles([
		"both/collections.js",
	]);

	// Server files — load order matters
	api.addFiles([
		"server/config.js",         // mode detection (must be first)
		"server/origin.js",          // shared origin identity (scanner + remote both use)
		"server/remote.js",          // DDP subscriber + proxy (registers early, bails if !remote)
		"server/scanner.js",         // disk scanner (bails if !scanner)
		"server/avatar.js",          // /<handle>.png (bails if !scanner)
		"server/profile-json.js",    // /<handle>.json (works in both modes from library record)
		"server/profile-keys.js",    // /<handle>.keys (bails if !scanner)
		"server/profile-atom.js",    // /<handle>.atom (bails if !scanner)
	], "server");

	api.export("koad");

});
