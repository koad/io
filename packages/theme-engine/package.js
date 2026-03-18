Package.describe({
  name: 'koad:io-theme-engine',
  version: '3.6.9',
  summary: 'Theme engine for koad:io Meteor applications',
  git: 'https://github.com/koad/io-theme-engine',
  documentation: 'README.md'
});

Package.onUse(function(api) {
	api.versionsFrom(['3.0'])

	api.use("koad:io-core", "client");
	api.use("templating", "client");
	api.use("tracker", "client");
	api.use("reactive-var", "client");

	api.addFiles([
		'styles/01-normalize.css',
		'styles/02-variables.css',
		'styles/body.css',
		'styles/media-queries.css',
	], 'client');

	api.addFiles([
		'logic.js',
	], 'client');
});
