Package.describe({
  name: 'koad:io-templating',
  version: '3.0.0',
  summary: 'Templating with helpers for koad:io Meteor applications',
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
    'momentjs:moment'
  ];
  api.use(packages);
  api.imply(packages);

  api.addFiles([
    'client/styles.css',
    'client/templates.html',
    'client/helpers/00-constants.js',
    'client/helpers/01-application.js',
    'client/helpers/02-user.js',
    'client/helpers/03-roles.js',
    'client/helpers/04-status.js',
    'client/helpers/05-numbers.js',
    'client/helpers/06-dates.js',
    'client/helpers/07-strings.js',
    'client/helpers/08-arrays.js',
    'client/helpers/09-cursors.js',
    'client/helpers/10-misc.js',
    'client/helpers/11-events.js',
  ], 'client');
});
