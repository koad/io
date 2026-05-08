Package.describe({
  name: 'koad:io-declarations',
  version: '0.0.1',
  summary: 'VESTA-SPEC-147 v3.3 sovereign declarations indexer — watches trust/declarations/, indexes into DeclarationsIndex, 48h re-verification cycle',
  git: '',
  documentation: null
});

Package.onUse(function(api) {

	api.use('ecmascript');
	api.use('mongo');
	api.use('check');
	api.use('meteor');
	api.use('koad:io-core');
	api.use('koad:io-daemon-indexers'); // EntityScanner, koad.ready

	api.addFiles([
		'server/declarations.js',
	], 'server');

	// DeclarationsIndex is referenced by app-level files (api.js etc.) via globalThis.
	api.export('DeclarationsIndex', 'server');

});
