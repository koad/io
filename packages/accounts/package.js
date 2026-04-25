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
		'server/roles.js',
		'server/methods.js',
		'server/new-user-shaper.js',
		'server/on-user-login.js',
		'server/invitations.js',
		'server/oauth-methods.js',
		'server/rate-limiting.js',
	], 'server');

  // api.export('Accounts');
  api.export('UserStatus');

  api.export('Login', 'client');
  api.export('Logout', 'client');
	api.export('ApplicationInvitations', 'server');
	api.export('ApplicationSponsors', 'server');

});

Package.onTest(function(api) {
});

// node-fetch and body-parser were removed — neither is imported anywhere in the accounts package.
// Meteor 3.x (Node 18) has native fetch. If fetch is needed, use it directly.

