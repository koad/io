Package.describe({
  name: 'koad:io-session-history',
  version: '0.0.1',
  summary: 'Session archive indexer, sidecar projector, and session-watcher delivery for the koad:io daemon',
  git: '',
  documentation: null
});

Package.onUse(function(api) {

	api.use('webapp');
	api.use('meteor');

	api.addFiles([
		'server/sessions.js',
		'server/session-sidecar-projector.js',
		'server/session-watchers.js',
	], 'server');

});
