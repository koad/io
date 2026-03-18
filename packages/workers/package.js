Package.describe({
  name: 'koad:io-worker-processes',
  version: '0.0.1',
  summary: '',
  git: '',
  documentation: null
});

Package.onUse(function(api) {

	api.use("mongo");
	api.use("random");
	api.use("koad:io-core");

	api.addFiles([
		'server/collections.js',
		'server/logic.js'
	], "server");

	api.export('koad');
	api.export('WorkerProcesses');
});
