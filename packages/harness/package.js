Package.describe({
  name: 'koad:io-harness',
  version: '1.1.0',
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
  api.addFiles('server/pipeline/feedback-extractor.js', 'server');
  api.addFiles('server/pipeline/rate-limiter.js', 'server');

  // Providers
  api.addFiles('server/providers/mock.js', 'server');
  api.addFiles('server/providers/ollama.js', 'server');
  api.addFiles('server/providers/anthropic.js', 'server');
  api.addFiles('server/providers/groq.js', 'server');
  api.addFiles('server/providers/xai.js', 'server');
  // VESTA-SPEC-133: claude-code provider (shells to `claude --print`)
  api.addFiles('server/providers/claude-code.js', 'server');
  api.addFiles('server/providers/index.js', 'server');

  // Access control (VESTA-SPEC-133)
  api.addFiles('server/budget.js', 'server');        // Headroom gate
  api.addFiles('server/access-gate.js', 'server');   // Three-gate stack

  // VESTA-SPEC-134: Relational Memory Protocol — Phase 0 (bond types + collection)
  // Bond type registry must load before any collection that may be validated.
  api.addFiles('server/bond-types.js', 'server');
  api.addFiles('server/collections/user-memories.js', 'server');

  // VESTA-SPEC-134: Relational Memory Protocol — Phase 1 (client-side crypto primitives)
  // Browser-only: WebCrypto KEK derivation, blob encryption, IndexedDB KEK storage.
  // argon2-browser (Npm.depends) provides Argon2id via WebAssembly in the browser.
  api.addFiles('client/crypto/kek-derive.js', 'client');
  api.addFiles('client/crypto/blob-crypto.js', 'client');
  api.addFiles('client/crypto/kek-storage.js', 'client');

  // OG / oembed injector (juno#90)
  api.addFiles('server/og-injector.js', 'server');

  // Main harness (mounts routes on WebApp)
  api.addFiles('server/harness.js', 'server');

  api.export('KoadHarness', 'server');
  // Feedback extractor — hosting app calls KoadHarnessFeedbackExtractor.register(callback)
  // to wire its Feedback collection into the harness capture pipeline (VESTA-SPEC-132).
  api.export('KoadHarnessFeedbackExtractor', 'server');
  // OG injector is a public API in phase 2: apps call
  // `KoadHarnessOgInjector.registerPattern({ path, resolve, toOg })` at boot
  // to wire `/parties/:id`, `/posts/:slug`, etc. into the OG pipeline.
  api.export('KoadHarnessOgInjector', 'server');
  // Tests reach into the entity loader's pure functions via this global.
  api.export('KoadHarnessEntityLoader', 'server', { testOnly: true });
  // VESTA-SPEC-133: access gate + budget exported for hosting-app quota debit wiring
  api.export('KoadHarnessAccessGate', 'server');
  api.export('KoadHarnessBudget', 'server');
  // VESTA-SPEC-134: bond type registry + UserMemories collection
  api.export('KoadHarnessBondTypes', 'server');
  api.export('UserMemories', 'server');
  // VESTA-SPEC-134 Phase 1: client-side crypto exports (browser only)
  api.export('KoadKEKStorage', 'client');
});

Package.onTest(function (api) {
  api.versionsFrom(['3.0', '3.3']);
  api.use('ecmascript');
  api.use('tinytest');
  api.use('koad:io-harness');
  api.addFiles('test/entity-loader-test.js', 'server');
  api.addFiles('test/og-injector-test.js', 'server');
  api.addFiles('test/feedback-extractor-test.js', 'server');
  // VESTA-SPEC-134 Phase 0 tests
  api.addFiles('test/bond-types-test.js', 'server');
});
