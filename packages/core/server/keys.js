import { WebApp } from 'meteor/webapp';

const os = Npm.require('os');
const fs = Npm.require('fs');
const path = Npm.require('path');

// GET /api/keys — key presence per entity (filenames only, never contents)
// GET /api/keys?entity=juno — filter to one entity
WebApp.handlers.use('/api/keys', async (req, res, next) => {
  if (req.method !== 'GET') return next();

  const url = req.originalUrl || req.url || '';
  const qi = url.indexOf('?');
  const p = qi === -1 ? url : url.slice(0, qi);
  if (p !== '/api/keys' && p !== '/api/keys/') return next();

  try {
    const q = {};
    if (qi !== -1) {
      for (const pair of url.slice(qi + 1).split('&')) {
        const [k, v] = pair.split('=');
        if (k) q[decodeURIComponent(k)] = v ? decodeURIComponent(v) : '';
      }
    }

    const home = os.homedir();
    const results = [];

    // If entity filter given, only check that one
    const handles = q.entity ? [q.entity] : null;

    if (handles) {
      for (const handle of handles) {
        const idDir = path.join(home, `.${handle}`, 'id');
        try {
          const files = fs.readdirSync(idDir).filter(f => !f.startsWith('.'));
          results.push({ handle, keys: files });
        } catch (_) {
          // entity dir or id/ doesn't exist — skip
        }
      }
    } else {
      // Scan all entity dirs
      const entries = fs.readdirSync(home, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || !entry.name.startsWith('.')) continue;
        const handle = entry.name.slice(1);
        if (!handle || handle.startsWith('.')) continue;
        const idDir = path.join(home, entry.name, 'id');
        try {
          const stat = fs.statSync(idDir);
          if (!stat.isDirectory()) continue;
          const files = fs.readdirSync(idDir).filter(f => !f.startsWith('.'));
          if (files.length > 0) {
            results.push({ handle, keys: files });
          }
        } catch (_) {
          // no id/ dir — skip
        }
      }
      results.sort((a, b) => a.handle.localeCompare(b.handle));
    }

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok', count: results.length, keys: results }));
  } catch (err) {
    console.error('[API/keys] error:', err.message);
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(500);
    res.end(JSON.stringify({ status: 'error', message: err.message }));
  }
});
