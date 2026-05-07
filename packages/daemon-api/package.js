Package.describe({
  name: 'koad:io-daemon-api',
  version: '0.0.1',
  summary: 'Daemon REST API — shared between kindergarten and control-tower',
  git: '',
  documentation: null
});

// body-parser is also declared in the app's package.json; Meteor deduplicates.
Npm.depends({ 'body-parser': '1.20.2' });

Package.onUse(function(api) {

	api.use('webapp');
	api.use('mongo');
	api.use('meteor');
	api.use('ecmascript');
	api.use('check');
	api.use('koad:io-core');
	api.use('koad:io-daemon-indexers');

	api.addFiles([
		'server/api.js',
	], 'server');

});
