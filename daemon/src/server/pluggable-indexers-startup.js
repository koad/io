// pluggable-indexers-startup.js — boot the pluggable indexer subsystem
//
// Runs after Meteor startup. Calls IndexerRegistry.load() (discovers all
// .koad-io-index.yaml files + Meteor.settings.indexers) then starts a
// JsonlProjector for each declared indexer.
//
// Hot reload endpoint: POST /api/indexers/reload
// Re-scans configs, stops removed indexers, starts new ones, leaves running unchanged.

const { WebApp } = require('meteor/webapp');
const app = WebApp.connectHandlers;

Meteor.startup(() => {
  // Allow a beat for Meteor to finish wiring up before we start watchers
  Meteor.setTimeout(() => {
    console.log('[pluggable-indexers] loading indexer registry...');

    let configs = [];
    try {
      configs = globalThis.IndexerRegistry.load();
    } catch (err) {
      console.error('[pluggable-indexers] IndexerRegistry.load() failed:', err.message);
      return;
    }

    for (const cfg of configs) {
      try {
        globalThis.JsonlProjector.start(cfg);
      } catch (err) {
        console.error(`[pluggable-indexers] failed to start indexer ${cfg.name}:`, err.message);
      }
    }

    console.log(`[pluggable-indexers] startup complete — ${configs.length} indexer(s) active`);
  }, 500);
});

// ---------------------------------------------------------------------------
// POST /api/indexers/reload — hot reload without daemon restart
// ---------------------------------------------------------------------------

app.use('/api/indexers/reload', (req, res, next) => {
  if (req.method !== 'POST') return next();

  res.setHeader('Content-Type', 'application/json');

  try {
    const newConfigs = globalThis.IndexerRegistry.load();
    globalThis.JsonlProjector.reload(newConfigs);

    res.writeHead(200);
    res.end(JSON.stringify({
      status: 'ok',
      reloaded: newConfigs.length,
      indexers: newConfigs.map(c => c.name),
    }));
  } catch (err) {
    console.error('[pluggable-indexers] reload error:', err.message);
    res.writeHead(500);
    res.end(JSON.stringify({ status: 'error', message: err.message }));
  }
});
