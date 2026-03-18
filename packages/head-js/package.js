Package.describe({
  name: 'koad:io-plus-head-js',
  version: "3.6.9",
  summary: 'Head.js integration for koad:io providing browser capability detection and resource loading',
  documentation: 'README.md'
});

Package.onUse(function(api) {
  api.versionsFrom(['3.0']);
  api.use('ecmascript');
  api.mainModule('koad-io-plus-head-js.js', 'client');
});

Package.onTest(function(api) {
  api.use('ecmascript');
  api.use('tinytest');
});
