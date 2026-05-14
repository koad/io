Package.describe({
  name: 'koad:io-accounts',
  version: '3.6.9',
  summary: 'Account management with roles, invitations, and authentication for koad:io applications',
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
		'server/roles.js',
		'server/methods.js',
		'server/new-user-shaper.js',
		'server/on-user-login.js',
		'server/invitations.js',
		'server/oauth-methods.js',
		'server/rate-limiting.js',
		'server/pgp-auth.js',
		'server/sign-required.js',
		'server/identity-session-methods.js',
	], 'server');

  // api.export('Accounts');
  api.export('UserStatus');

  api.export('Login', 'client');
  api.export('Logout', 'client');
	api.export('ApplicationInvitations', 'server');
	api.export('ApplicationSponsors', 'server');
	api.export('SovereignAuth', 'server');

});

Npm.depends({
  "kbpgp": "2.1.15",
});

Package.onTest(function(api) {
});

