Package.describe({
	name: 'koad:io-search',
	version: '3.6.9',
	summary: 'Search UI component with local and remote search capabilities',
	git: 'https://github.com/koad/io',
	documentation: 'README.md'
});

Package.onUse(function(api) {
	api.versionsFrom(['3.0', '3.3']);

	// Dependencies
	api.use('ecmascript');
	api.use('templating@1.4.4', 'client');
	api.use('reactive-var', 'client');
	api.use('reactive-dict', 'client');
	api.use('tracker', 'client');
	api.use('underscore', 'client');
	api.use('koad:io-core', 'client');

	// Client files
	api.addFiles([
		'client/templates/search-box.html',
		'client/templates/search-box.css',
		'client/templates/search-box.js',
		'client/templates/search-results.html',
		'client/templates/search-results.css',
		'client/templates/search-results.js'
	], 'client');

	// Export nothing (provides UI templates)
});
