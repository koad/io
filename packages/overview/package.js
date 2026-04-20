Package.describe({
  name: 'koad:io-overview',
  version: '0.1.0',
  summary: 'Kingdom overview dashboard — entity grid, flights table, bond graph, activity panel.',
  documentation: 'README.md',
});

Package.onUse(function (api) {
  api.versionsFrom(['3.0', '3.3']);

  api.use([
    'meteor',
    'templating',
    'reactive-var',
    'tracker',
    'mongo',
    'ecmascript',
  ], 'client');

  api.addFiles([
    'client/helpers/time.js',
    'client/helpers/color.js',
    'client/templates.html',
    'client/logic.js',
    'client/styles.css',
  ], 'client');

  // Expose package-level setting helpers to the host app
  api.export('KoadOverview', 'client');
});
