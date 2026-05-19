Package.describe({
  name: 'koad:io-navigation-basic-bitch',
  version: '0.0.1',
  summary: '',
  git: '',
  documentation: null
});

Package.onUse(function(api) {
	api.use("templating", "client");
	api.use("koad:io-router");
	api.use("koad:io-session");

	api.addFiles([
		'client/templates.html',
		'client/styles.css',
		'client/logic.js'
	], 'client');

});

Package.onTest(function(api) {
});
