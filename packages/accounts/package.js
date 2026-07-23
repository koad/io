Package.describe({
  name: 'koad:io-accounts',
  version: '3.7.0',
  summary: 'Account management with roles and authentication for koad:io applications',
  documentation: 'README.md'
});

Package.onUse(function(api) {
	api.use('koad:io-core');
	api.use('koad:io-router');
	api.use("templating", "client");
	// api.use("matb33:collection-hooks");
  api.use("accounts-base");
  api.use("check");
  api.use("random");
	api.imply('accounts-password');

	api.imply('roles');
	api.use('roles');

	api.addFiles([
		'client/subdomains.js',
		'client/globals.js'
	], 'client');

	api.addFiles([
		'server/auth.js',
		'server/sovereign-auth.js',          // sovereign.auth.* — device authorization (uses globalThis.SovereignAuth from auth.js)
		'server/roles.js',
		'server/methods.js',
		'server/new-user-shaper.js',
		'server/on-user-login.js',
		'server/invitations.js',
		'server/oauth-methods.js',
		'server/rate-limiting.js',
		'server/fingerprint-entity-index.js',
		'server/pgp-auth.js',
		'server/sign-required.js',
		'server/identity-session-methods.js',
		'server/authorization-bridge.js',     // sovereign auth helpers — authorizeByBond, authorizeByCID, authorizeSession (VESTA-SPEC-185 v2.0 §6)
		'server/sovereign-resolve.js',        // sovereign.resolve method — pure fingerprint identity resolution (VESTA-SPEC-185 v2.0 §4.4)
		'server/user-profile-publication.js', // user.profile pub — ProfileShell user profiles
	], 'server');

  // api.export('Accounts');
  api.export('UserStatus');

  api.export('Login', 'client');
  api.export('Logout', 'client');
	api.export('ApplicationSponsors', 'server');
	api.export('SovereignAuth', 'server');

});

// Npm dependencies are intentionally app-owned. See npm-versions.json for known-good versions.

Package.onTest(function(api) {
});

