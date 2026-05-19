Package.describe({
  name: 'koad:io-style-basic-bitch',
  version: '0.0.3',
  summary: '',
  git: '',
  documentation: null
});

Package.onUse(function(api) {
	api.use("templating", "client");
	api.use("tracker", "client");

	api.addFiles([
		'styles/01-cleanup.css', // should be first on the list, so it cleans things before anything.
		'styles/02-variables.css', // should be second on the list, so it is loaded before the others.
		'styles/body.css',
		'styles/cursor.css',
		'styles/bulk-scratchpad.css',
		// 'styles/kitchen-sink.css',
		'styles/forms.css',
		'styles/brand-colors.css',
		'styles/alignment.css',
		'styles/indicator-drawer.css',
		'styles/toolbar.css',
		'styles/dropdown.css',
		'styles/grid.css',
		'styles/background-effects.css',
		'styles/padding.css',
		'styles/hyperlinks.css',
		'styles/scroll-bars.css',
		'styles/editable.css',
		'styles/containers.css',
		'styles/buttons.css',
		'styles/text.css',
		'styles/login-ui.css',
		'styles/tables.css',
		'styles/icons.css',
		'debug/template.html',
		'debug/logic.js',
		'debug/style.css'
	], 'client');


});


Package.onTest(function(api) {
});
