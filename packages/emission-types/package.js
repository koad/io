Package.describe({
  name: 'koad:io-emission-types',
  version: '0.0.1',
  summary: 'Per-entity emission type declaration registry — watches ~/.<entity>/emissions/types.yaml, validates emissions, exposes REST endpoints',
  git: '',
  documentation: null
});

Package.onUse(function(api) {

	api.use('webapp');
	api.use('meteor');

	api.addFiles([
		'server/emission-type-registry.js',
	], 'server');

});
