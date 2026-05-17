Package.describe({
  name: 'koad:io-harness',
  version: '1.0.0',
  summary: 'Harness Bridge Protocol — bidirectional harness communication for running opencode sessions (VESTA-SPEC-191)',
  git: '',
  documentation: null
});

Package.onUse(function(api) {
  api.versionsFrom(['3.0', '3.3']);
  api.use('ecmascript');
  api.use('webapp');
  api.use('mongo');
  api.use('random');
  api.use('check');
  api.use('koad:io-core');

  api.addFiles([
    'server/harness.js',
  ], 'server');

  api.export('HarnessCommands', 'server');
});
