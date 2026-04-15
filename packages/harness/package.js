Package.describe({
  name: 'koad:io-harness',
  version: '1.0.0',
  summary: 'Entity conversation harness — serve AI entities over HTTP/SSE from any koad:io Meteor app',
  documentation: 'README.md',
});

Package.onUse(function (api) {
  api.versionsFrom(['3.0', '3.3']);

  api.use('ecmascript');
  api.use('webapp', 'server');
  api.use('random', 'server');

  // Utils (loaded first)
  api.addFiles('server/utils/safe-read.js', 'server');
  api.addFiles('server/utils/parse-env.js', 'server');

  // Core modules
  api.addFiles('server/ddp-gate.js', 'server');
  api.addFiles('server/entity-loader.js', 'server');
  api.addFiles('server/prompt-assembler.js', 'server');
  api.addFiles('server/session-store.js', 'server');
  api.addFiles('server/sse.js', 'server');

  // Pipeline
  api.addFiles('server/pipeline/input-filter.js', 'server');
  api.addFiles('server/pipeline/output-filter.js', 'server');
  api.addFiles('server/pipeline/rate-limiter.js', 'server');

  // Providers
  api.addFiles('server/providers/mock.js', 'server');
  api.addFiles('server/providers/ollama.js', 'server');
  api.addFiles('server/providers/anthropic.js', 'server');
  api.addFiles('server/providers/groq.js', 'server');
  api.addFiles('server/providers/xai.js', 'server');
  api.addFiles('server/providers/index.js', 'server');

  // OG / oembed injector (juno#90)
  api.addFiles('server/og-injector.js', 'server');

  // Main harness (mounts routes on WebApp)
  api.addFiles('server/harness.js', 'server');

  api.export('KoadHarness', 'server');
  // OG injector is a public API in phase 2: apps call
  // `KoadHarnessOgInjector.registerPattern({ path, resolve, toOg })` at boot
  // to wire `/parties/:id`, `/posts/:slug`, etc. into the OG pipeline.
  api.export('KoadHarnessOgInjector', 'server');
  // Tests reach into the entity loader's pure functions via this global.
  api.export('KoadHarnessEntityLoader', 'server', { testOnly: true });
});

Package.onTest(function (api) {
  api.versionsFrom(['3.0', '3.3']);
  api.use('ecmascript');
  api.use('tinytest');
  api.use('koad:io-harness');
  api.addFiles('test/entity-loader-test.js', 'server');
  api.addFiles('test/og-injector-test.js', 'server');
});
