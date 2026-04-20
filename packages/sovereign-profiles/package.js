Package.describe({
  name: 'koad:io-sovereign-profiles',
  version: '0.2.0',
  summary: 'Sovereign profile management via SPEC-111 sigchain entries. Create, sign, authenticate, and publish profiles. Viewer/verifier components for any koad:io app.',
  documentation: 'README.md'
});

// npm deps: multiformats, @noble/ed25519, @ipld/dag-json are centralized in koad:io-core.
// No Npm.depends() needed here — core is an api.use() dependency.

Package.onUse(function(api) {
  api.versionsFrom(['3.0', '3.3']);

  api.use('koad:io-core');
  api.use('koad:io-ipfs-client');
  api.use('ecmascript');
  api.use('blaze-html-templates');
  api.use('templating');

  // Weak dependency on sigchain-discovery for chain broadcast.
  // sovereign-profiles works standalone (render, sign, verify) without it.
  // Chain broadcast via publishToChain() is a no-op unless sigchain-discovery is present.
  api.use('ecoincore:sigchain-discovery', 'server', { weak: true });

  // Client files — deps now come from koad:io-core's client/deps.js via koad.deps global.
  // profile-builder loads first (defines SovereignProfile); profile-viewer extends it.
  api.addFiles([
    'client/profile-builder.js',
    'client/profile-viewer.js',
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
    'client/templates/kingdoms-overview.html',
    'client/templates/kingdoms-overview.js',
    'client/templates/key-passphrase-modal.html',
    'client/templates/key-passphrase-modal.js',
    'client/templates/key-management.html',
    'client/templates/key-management.js',
    'client/templates/key-import-form.html',
    'client/templates/key-import-form.js',
    'client/templates/key-generate-form.html',
    'client/templates/key-generate-form.js',
  ], 'client');

  // Server-side: keystore reader, auth flow, profile server methods
  // Load order: keystore first (auth depends on it), then auth, then profile-server
  api.addFiles([
    'server/keystore.js',      // file-based entity keystore reader (SovereignProfileKeystore)
    'server/auth.js',          // challenge-response auth (SovereignAuth)
    'server/profile-server.js', // server-side profile API (fromEntityDir, verify, pin, publishToChain)
  ], 'server');

  // Client exports — SovereignProfile is the primary API surface.
  // Attaches to koad.sovereign.profile per brief; also exported standalone.
  api.export('SovereignProfile', 'client');

  // Server exports
  api.export('SovereignProfile', 'server');
  api.export('SovereignProfileKeystore', 'server');
  api.export('SovereignAuth', 'server');
});


Package.onTest(function(api) {
  api.use('koad:io-sovereign-profiles');
  api.use('tinytest');
  api.use('test-helpers');
  api.use('ecmascript');
  api.addFiles('test/sovereign-profiles-tests.js', 'client');
  api.addFiles('test/sovereign-profiles-server-tests.js', 'server');
});
