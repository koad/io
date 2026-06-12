Package.describe({
  name: 'koad:io-merkle-tree',
  version: '1.0.0',
  summary: 'Kingdom Merkle Tree — VESTA-SPEC-169. Builds and verifies the sovereign state forest: leaf hashing, root construction, skip pointers, inclusion proofs, and Ed25519-signed roots.',
  documentation: null,
});

Package.onUse(function (api) {
  api.versionsFrom(['3.0', '3.3']);

  api.use('ecmascript');

  // Server-only — pure compute, no UI, no collections.
  api.mainModule('server/merkle-tree.js', 'server');

  api.export('KingdomMerkleTree', 'server');
});

Package.onTest(function (api) {
  api.use('ecmascript');
  api.use('tinytest');
  api.use('koad:io-merkle-tree');

  api.addFiles('test/merkle-tree-tests.js', 'server');
});
