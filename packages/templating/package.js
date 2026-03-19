Package.describe({
  name: 'koad:io-templating',
  version: '3.6.9',
  summary: 'Reactive layout/window manager for Meteor + Blaze, with helpers',
  documentation: 'README.md'
});

Package.onUse(function(api) {
  api.versionsFrom(['3.0'])

  var packages = [
    'ecmascript',
    'underscore',
    'meteor-base',
    'blaze-html-templates',
    'reactive-var',
    'mizzao:timesync',
    'momentjs:moment',
    'koad:io-session'
  ];
  api.use(packages);
  api.imply(packages);

  api.addFiles([
    'client/helpers/templates.html',
    'client/helpers/constants.js',
    'client/helpers/application.js',
    'client/helpers/user.js',
    'client/helpers/roles.js',
    'client/helpers/status.js',
    'client/helpers/numbers.js',
    'client/helpers/dates.js',
    'client/helpers/strings.js',
    'client/helpers/arrays.js',
    'client/helpers/cursors.js',
    'client/helpers/misc.js',
    'client/helpers/events.js',

    'client/layout/templates.html',
    'client/layout/logic.js',
    'client/layout/styles.css',

    'client/layout/engine.js',
    'client/layout/gestures.js',
    'client/layout/history.js',

  ], 'client');


  api.export('ApplicationLayout');


});
