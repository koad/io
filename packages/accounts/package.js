Package.describe({
  name: 'koad:io-accounts',
  version: '3.6.9',
  summary: '',
  git: '',
  documentation: null
});

Package.onUse(function(api) {
	api.use('koad:io-core');
	api.use('koad:io-router');
	api.use("templating", "client");
	// api.use("matb33:collection-hooks");
  api.use("accounts-base");
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
		'server/rate-limiting.js',
		'server/database-indexes.js',
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

Npm.depends({
	"node-fetch": "2.6.7",
	"body-parser": "1.20.2"
});
