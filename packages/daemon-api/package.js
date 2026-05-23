Package.describe({
  name: 'koad:io-daemon-api',
  version: '0.0.1',
  summary: 'Daemon REST API — shared between kindergarten and control-tower',
  documentation: null,
});

Package.onUse(function (api) {
  api.versionsFrom('3.0');
  api.use(['webapp', 'mongo', 'meteor', 'ecmascript', 'check']);
  api.use('koad:io-core');
  api.use('koad:io-daemon-indexers');
  api.addFiles('server/api.js', 'server');
  api.addFiles('server/channel-api.js', 'server');
  api.addFiles('server/goals-projects-api.js', 'server');
});
