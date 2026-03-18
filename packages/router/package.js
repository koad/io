Package.describe({
  name: 'koad:io-router',
  summary: 'Routing specifically designed for koad:io',
  version: '3.3.0',
});

Npm.depends({
  'body-parser': '1.12.4'
});

Package.onUse(function (api) {
  api.versionsFrom(['3.0.2', '3.3']);
  // meteor dependencies
  api.use('koad:io-core');
  api.use('webapp', 'server');

  // for cloning
  api.use('ejson');

  // for dynamic scoping with environment variables
  api.use('meteor');

  // so our default_layout gets compiled
  api.use('templating');
  api.use('blaze');

  // some utils
  api.use('underscore');
  api.use('tracker'); // for Deps

  api.use('ui');
  api.use('jquery');
  api.use('reactive-var');
  api.use('random');

  api.use('appcache', {weak: true});

  api.addFiles('lib/version_conflict_errors.js');
  api.addFiles('lib/core.js');

  // templating
  api.addFiles('lib/dynamic_template.html');
  api.addFiles('lib/dynamic_template.js');
  api.addFiles('lib/blaze_overrides.js');

  // add default layout for error pages
  api.addFiles('lib/layout/templates.html');
  api.addFiles('lib/layout/logic.js');


  // client and server side url utilities and compiling
  api.addFiles('lib/compiler.js');
  api.addFiles('lib/url.js');

  // middleware
  api.addFiles('lib/middleware_handler.js');
  api.addFiles('lib/middleware_stack.js');

  api.addFiles('lib/location/utils.js', 'client');
  api.addFiles('lib/location/state.js', 'client');
  api.addFiles('lib/location/location.js', 'client');

  // for RouteController which inherits from this
  api.addFiles('lib/wait_list.js', 'client');
  api.addFiles('lib/controller.js');
  api.addFiles('lib/controller_server.js', 'server');
  api.addFiles('lib/controller_client.js', 'client');

  api.addFiles('lib/current_options.js');
  api.addFiles('lib/http_methods.js');
  api.addFiles('lib/route_controller.js');
  api.addFiles('lib/route_controller_server.js', 'server');
  api.addFiles('lib/route_controller_client.js', 'client');
  api.addFiles('lib/route.js');
  api.addFiles('lib/router.js');
  api.addFiles('lib/hooks.js');
  api.addFiles('lib/helpers.js');
  api.addFiles('lib/router_client.js', 'client');
  api.addFiles('lib/body_parser_server.js', 'server');
  api.addFiles('lib/router_server.js', 'server');
  api.addFiles('lib/plugins.js');
  api.addFiles('lib/global_router.js');
  api.addFiles('lib/templates.html');

  // progress bar
  api.addFiles('lib/progress.html', 'client');
  api.addFiles('lib/progress.js', 'client');
  api.addFiles('lib/progress.css', 'client');

  // symbol exports
  api.export('Handler', {testOnly: true});
  api.export(['urlToHashStyle', 'urlFromHashStyle'], 'client', {testOnly: true});

  api.export('Iron');
  api.export('Router');
  api.export('RouteController');
});


Package.onTest(function (api) {
  api.versionsFrom('3.0.2');

  api.use('koad:io-router');
  api.use('tinytest');
  api.use('test-helpers');

  api.addFiles('test/helpers.js');
  api.addFiles('test/route_test.js');
  api.addFiles('test/router_test.js');
  api.addFiles('test/route_controller_test.js');

  api.use('templating');
  api.use('blaze');
  api.use('deps');

  api.addFiles('test/layout_test.html', 'client');
  api.addFiles('test/layout_test.js', 'client');

  api.addFiles('test/dynamic_template_test.html', 'client');
  api.addFiles('test/dynamic_template_test.js', 'client');

  api.addFiles('test/handler_test.js');
  api.addFiles('test/middleware_stack_test.js');

  api.addFiles('test/url_test.js', ['client', 'server']);

  api.addFiles('test/location_test.js', 'client');

  api.addFiles('test/controller_test.html', 'client');
  api.addFiles('test/wait_list_test.js', 'client');
  api.addFiles('test/controller_test.js', 'client');

});


