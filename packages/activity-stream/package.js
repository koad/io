// SPDX-License-Identifier: AGPL-3.0-or-later

Package.describe({
  name: 'koad:io-activity-stream',
  version: '0.1.0',
  summary: 'Activity stream renderer consuming SPEC-111 sigchain entries. Accepts N streams, merges chronologically. Single component for profile pages, kingdom timeline, and sponsor dashboards.',
  documentation: 'README.md'
});

// npm deps: multiformats, @noble/ed25519, @ipld/dag-json are centralized in koad:io-core.
// stream.js delegates crypto ops to IPFSClient and koad.deps (via core).
// No direct Npm.depends() needed here.

Package.onUse(function(api) {
  api.versionsFrom(['3.0', '3.3']);

  api.use('koad:io-core');
  api.use('koad:io-ipfs-client');
  api.use('koad:io-sovereign-profiles');
  api.use('ecmascript');
  api.use('blaze-html-templates');
  api.use('templating');
  api.use('reactive-var');
  api.use('tracker');

  // Core stream logic — client
  api.addFiles([
    'client/stream.js',
    'client/entry-renderers.js',
  ], 'client');

  // Blaze templates
  api.addFiles([
    'client/templates/activity-stream.html',
    'client/templates/activity-stream.js',
    'client/templates/activity-stream.css',
    'client/templates/activity-entry.html',
    'client/templates/activity-entry.js',
  ], 'client');

  // Server-side stream walking (SSR / API)
  api.addFiles([
    'server/stream-server.js',
  ], 'server');

  // Client exports — ActivityStream is the primary API surface.
  api.export('ActivityStream', 'client');

  // Server exports
  api.export('ActivityStreamServer', 'server');
});

Package.onTest(function(api) {
  api.use('koad:io-activity-stream');
  api.use('tinytest');
  api.use('test-helpers');
  api.addFiles('test/activity-stream-tests.js', 'client');
});
