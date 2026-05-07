// indexer-admin-api.js — read-only admin endpoints for the /indexers dashboard
//
// GET /api/indexers           — list registered indexers with live doc counts
// GET /api/indexers/yaml      — read a .koad-io-index.yaml file's raw content
//                              ?path=<absolute-path> — must be a discovered yaml file

const { WebApp } = require('meteor/webapp');
const fs   = Npm.require('fs');
const path = Npm.require('path');
const os   = Npm.require('os');
const app  = WebApp.connectHandlers;

// ---------------------------------------------------------------------------
// GET /api/indexers — list all registered indexers + live document counts
// ---------------------------------------------------------------------------

app.use('/api/indexers', (req, res, next) => {
  // Only handle GET /api/indexers (not /api/indexers/reload or /api/indexers/yaml)
  if (req.method !== 'GET') return next();
  if (req.url !== '/' && req.url !== '') return next();

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const configs = globalThis.IndexerRegistry.load();

    const indexers = configs.map(cfg => {
      // Live doc count from the in-memory collection if it exists
      let docCount = null;
      try {
        const col = globalThis[cfg.collection];
        if (col && typeof col.find === 'function') {
          docCount = col.find().count();
        }
      } catch (_) { /* collection not yet populated */ }

      const out = {
        name:       cfg.name,
        collection: cfg.collection,
        mode:       cfg.mode || 'append-only',
        _source:    cfg._source || null,
        docCount,
      };

      // Source display — single file vs glob
      if (cfg.sourceGlob) {
        out.source = `glob:${cfg.sourceGlob.baseDir}/${cfg.sourceGlob.pattern}`;
        if (cfg.excludeGlob) {
          out.excludeGlob = `${cfg.excludeGlob.baseDir}/${cfg.excludeGlob.pattern}`;
        }
      } else {
        out.source = cfg.sourcePath || cfg.source || null;
      }

      return out;
    });

    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok', indexers }));
  } catch (err) {
    console.error('[indexer-admin-api] GET /api/indexers error:', err.message);
    res.writeHead(500);
    res.end(JSON.stringify({ status: 'error', message: err.message }));
  }
});

// ---------------------------------------------------------------------------
// GET /api/indexers/yaml?path=<absolute-path>
// Returns raw YAML content for one of the discovered .koad-io-index.yaml files.
// Rejects any path that wasn't discovered by IndexerRegistry (safety gate).
// ---------------------------------------------------------------------------

app.use('/api/indexers/yaml', (req, res, next) => {
  if (req.method !== 'GET') return next();

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Parse the ?path= query param
  const rawUrl = req.url || '';
  const qIndex = rawUrl.indexOf('?');
  const queryStr = qIndex >= 0 ? rawUrl.slice(qIndex + 1) : '';
  let requestedPath = null;
  for (const part of queryStr.split('&')) {
    if (part.startsWith('path=')) {
      requestedPath = decodeURIComponent(part.slice(5));
      break;
    }
  }

  if (!requestedPath) {
    res.writeHead(400);
    res.end(JSON.stringify({ status: 'error', message: 'path parameter required' }));
    return;
  }

  // Safety: must be an absolute path and must end in .koad-io-index.yaml
  if (!path.isAbsolute(requestedPath) || !requestedPath.endsWith('.koad-io-index.yaml')) {
    res.writeHead(403);
    res.end(JSON.stringify({ status: 'error', message: 'path must be an absolute .koad-io-index.yaml path' }));
    return;
  }

  // Safety: must be one of the files actually discovered by IndexerRegistry
  // (no directory traversal or arbitrary file reads)
  let discovered = [];
  try {
    const configs = globalThis.IndexerRegistry.load();
    const seen = new Set();
    for (const cfg of configs) {
      if (cfg._source && cfg._source !== 'settings') seen.add(cfg._source);
      if (cfg._yamlFile) seen.add(cfg._yamlFile);
    }
    discovered = Array.from(seen);
  } catch (err) {
    res.writeHead(500);
    res.end(JSON.stringify({ status: 'error', message: 'registry unavailable' }));
    return;
  }

  if (!discovered.includes(requestedPath)) {
    res.writeHead(403);
    res.end(JSON.stringify({ status: 'error', message: 'path not in discovered yaml files' }));
    return;
  }

  try {
    const content = fs.readFileSync(requestedPath, 'utf8');
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok', path: requestedPath, content }));
  } catch (err) {
    res.writeHead(500);
    res.end(JSON.stringify({ status: 'error', message: err.message }));
  }
});
