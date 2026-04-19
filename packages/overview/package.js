Package.describe({
  name: 'koad:io-overview',
  version: '0.1.0',
  summary: 'Kingdom overview dashboard — entity grid, flights table, bond graph, activity panel.',
  documentation: 'README.md',
});

Package.onUse(function (api) {
  api.versionsFrom('2.8');

  api.use([
    'meteor',
    'templating',
    'reactive-var',
    'tracker',
    'mongo',
  ], 'client');

  api.addFiles([
    'client/helpers/time.js',
    'client/helpers/color.js',
    'client/overview.html',
    'client/overview.js',
  ], 'client');

  // Expose package-level setting helpers to the host app
  api.export('KoadOverview', 'client');
});
