Package.describe({
  name: 'koad:io-event-logger',
  version: '0.3.0',
  summary: 'Event logging package for koad:io',
  git: '',
  documentation: null
});

Package.onUse(function(api) {
  api.use('koad:io-core');
  api.imply('koad:io-core');

  api.use('ecmascript');
  api.use('mongo');
  
  api.use('koad:io-router', {weak: true});

  api.addFiles([
    'client/logic.js',
    ], 'client');
  
  api.addFiles([
    'server/collection.js',
    'server/publications.js',
    'server/fixtures.js',
    ], 'server');
  api.export('log', 'client');
  api.export('ClientErrors', 'server');
  api.export('logEvent', 'server');
});
