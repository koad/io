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

  // Main harness (mounts routes on WebApp)
  api.addFiles('server/harness.js', 'server');

  api.export('KoadHarness', 'server');
});
