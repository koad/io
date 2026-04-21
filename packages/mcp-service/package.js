// mcp-service — VESTA-SPEC-139 Kingdom Tool Substrate for AI Harnesses
// Exposes an MCP endpoint at http://10.10.10.10:28282/mcp using HTTP+SSE transport.
//
// Two layers of tools:
//   Layer 1: Entity tool re-exposure (VESTA-SPEC-137 cascade)
//   Layer 2: Daemon state tools (12 typed tools per §4.2)
//
// Authentication via harness session bearer token (HarnessSessions lookup).
// Bond-gated scope per tool per §5.2.

Package.describe({
  name: 'mcp-service',
  version: '1.0.0',
  summary: 'MCP service — kingdom tool substrate for AI harnesses (VESTA-SPEC-139)',
  git: '',
  documentation: 'README.md',
});

Package.onUse(function (api) {
  api.versionsFrom('3.0');
  api.use('meteor');
  api.use('ecmascript');
  api.use('mongo');
  api.use('check');
  api.use('webapp');

  // Load order: auth → session → tool-loader → daemon-tools → transport → main
  api.addFiles('server/auth.js',         'server');
  api.addFiles('server/session.js',      'server');
  api.addFiles('server/tool-loader.js',  'server');
  api.addFiles('server/daemon-tools.js', 'server');
  api.addFiles('server/transport.js',    'server');
  api.addFiles('server/main.js',         'server');
});

Npm.depends({
  '@modelcontextprotocol/sdk': '1.9.0',
});
