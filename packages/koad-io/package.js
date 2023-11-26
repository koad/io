Package.describe({
  name: 'koad:io',
  version: '5.6.3',
  summary: '',
  git: '',
  documentation: null
});

Package.onUse(function(api) {
  api.versionsFrom(['2.2', '2.7'])

  api.use('ecmascript');

  api.imply("koad:io-core");
  api.use("koad:io-core");

  api.use("accounts-base");

  api.imply("standard-minifier-css");
  api.imply("standard-minifier-js");
  api.imply("mobile-experience");
  api.imply("koad:io-router");
  api.imply("koad:io-session");
  api.imply("templating");
  api.imply("jquery");
  api.imply("tracker");

  api.use("mongo");
  api.use("tracker");
  api.use("koad:io-router");
  api.use("koad:io-router-progress");
  api.use("koad:io-session");
  
  api.use('mizzao:timesync');
  api.imply('mizzao:timesync');

  api.use("matb33:collection-hooks");
  api.imply("matb33:collection-hooks");

  api.addFiles([
    'both/country-codes.js',
  ]);

  api.addFiles([
    'server/connection-tracker.js',
    'server/methods.js',
    'server/secrets.js',
    'server/manifest-middleware.js',
    'server/404-middleware.js',
  ], 'server');

  api.addFiles([
    'client/globals.js',
    'client/internals.js',
    'client/initialize-dataport.js',
    'client/route-dataport-updater.js',
    'client/power-management.js',
    'client/vitals.js',
  ], 'client');
  
  api.export("koad");
  api.export('Accounts');
  api.export('UserStatus');
  api.export('CountryCodes');
  
  api.export('ApplicationSessions');
  api.export('ApplicationInternals');
  // api.export('ApplicationEvents');

  api.export('Devices', 'server');
  api.export('Services', 'server');
  api.export('Secrets', 'server');
  api.export('Login', 'client');
  api.export('Logout', 'client');
  api.export('tick1s', 'client');
  api.export('tick1m', 'client');

  // api.export('relativeTime', 'client');

});

Package.onTest(function(api) {
  api.use('ecmascript');
  api.use('tinytest');
  api.mainModule('tests.js');
});

Npm.depends({
  "ua-parser-js": "1.0.35",
  "geoip-lite": "1.2.1",
  "web-vitals": "3.0.4",
  'path-to-regexp': '6.2.1',
  'useragent': '2.3.0'
});
