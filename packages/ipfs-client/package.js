Package.describe({
  name: 'koad:io-ipfs-client',
  version: '0.1.0',
  summary: 'In-browser IPFS node via Helia HTTP. Resolves, verifies, and caches sigchain CIDs locally using OPFS blockstore. No DHT — delegated HTTP routing only.',
  documentation: 'README.md'
});

// Client-side npm deps are bundled by Meteor's build system via dynamic import.
// Server-side deps are declared here for daemon pinning (Phase 2).
Npm.depends({
  '@helia/http': '3.1.3',
  '@helia/verified-fetch': '7.2.7',
  'blockstore-opfs': '0.1.0',
  'blockstore-idb': '3.0.2',
  'multiformats': '13.4.2',
  '@ipld/dag-json': '10.2.7'
});

Package.onUse(function(api) {
  api.versionsFrom(['3.0', '3.3']);

  api.use('koad:io-core');
  api.use('ecmascript');

  // Client: the in-browser Helia node + service worker registration
  api.addFiles([
    'client/ipfs-client.js',
    'client/service-worker-registration.js'
  ], 'client');

  // Server: stub for Phase 2 pinning service
  api.addFiles([
    'server/ipfs-server.js'
  ], 'server');

  // Client exports — attach to koad global and export standalone symbols
  api.export('IPFSClient', 'client');

  // Server exports — shape only for now
  api.export('IPFSServer', 'server');
});


Package.onTest(function(api) {
  api.use('koad:io-ipfs-client');
  api.use('tinytest');
  api.use('test-helpers');
  api.addFiles('test/ipfs-client-tests.js', 'client');
});
