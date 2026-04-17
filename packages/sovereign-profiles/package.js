Package.describe({
  name: 'koad:io-sovereign-profiles',
  version: '0.1.0',
  summary: 'Sovereign profile management via SPEC-111 sigchain entries. Editor/signer components for Passenger; viewer/verifier components for any koad:io app.',
  documentation: 'README.md'
});

// npm deps:
//   multiformats — CIDv1 computation (dag-json codec, sha2-256)
//   @noble/ed25519 — Ed25519 signing and verification
//   @ipld/dag-json — canonical dag-json serialization per SPEC-111 §3.1
Npm.depends({
  'multiformats': '13.3.0',
  '@noble/ed25519': '2.1.0',
  '@ipld/dag-json': '10.2.2'
});

Package.onUse(function(api) {
  api.versionsFrom(['3.0', '3.3']);

  api.use('koad:io-core');
  api.use('koad:io-ipfs-client');
  api.use('ecmascript');
  api.use('blaze-html-templates');
  api.use('templating');

  // Core profile logic — both sides consume
  api.addFiles([
    'client/profile-builder.js',  // create/update/sign/publish (passenger)
    'client/profile-viewer.js',   // resolve/verify/render (any app)
  ], 'client');

  // Blaze templates + component stylesheet (all templates share one CSS file)
  api.addFiles([
    'client/templates/sovereign-profiles.css',
    'client/templates/profile-editor.html',
    'client/templates/profile-editor.js',
    'client/templates/profile-card.html',
    'client/templates/profile-card.js',
    'client/templates/profile-full.html',
    'client/templates/profile-full.js',
    'client/templates/key-passphrase-modal.html',
    'client/templates/key-passphrase-modal.js',
    'client/templates/key-management.html',
    'client/templates/key-management.js',
    'client/templates/key-import-form.html',
    'client/templates/key-import-form.js',
    'client/templates/key-generate-form.html',
    'client/templates/key-generate-form.js',
  ], 'client');

  // Server-side verification + pinning stubs
  api.addFiles([
    'server/profile-server.js',
  ], 'server');

  // Client exports — SovereignProfile is the primary API surface.
  // Attaches to koad.sovereign.profile per brief; also exported standalone.
  api.export('SovereignProfile', 'client');

  // Server exports
  api.export('SovereignProfile', 'server');
});


Package.onTest(function(api) {
  api.use('koad:io-sovereign-profiles');
  api.use('tinytest');
  api.use('test-helpers');
  api.addFiles('test/sovereign-profiles-tests.js', 'client');
});
