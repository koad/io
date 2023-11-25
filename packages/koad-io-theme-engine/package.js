Package.describe({
  name: 'koad:io-theme-engine',
  version: '0.0.1',
  summary: '',
  git: '',
  documentation: null
});

Package.onUse(function(api) {
	api.use("koad:io-core", "client");
	api.use("templating", "client");
	api.use("tracker", "client");
	api.use("reactive-var", "client");

	api.addFiles([
		'styles/01-normalize.css', // should be first on the list, so it cleans things before anything.
		'styles/02-variables.css', // should be second on the list, so it is loaded before the others.
		'styles/body.css',
		'styles/media-queries.css',
	], 'client');

	api.addFiles([		
		'logic.js',
	], 'client');

});


Package.onTest(function(api) {
});
