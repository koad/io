import { WebApp } from 'meteor/webapp';

const os = Npm.require('os');
const fs = Npm.require('fs');
const path = Npm.require('path');

const home = os.homedir();

function parseFrontmatter(content) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const fm = {};
  for (const line of m[1].split('\n')) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const val = line.slice(colon + 1).trim();
    if (key && val) fm[key] = val;
  }
  return fm;
}

function scanEntityBonds(handle) {
  const bondsDir = path.join(home, `.${handle}`, 'trust', 'bonds');
  let files;
  try {
    files = fs.readdirSync(bondsDir).filter(f => f.endsWith('.md') && !f.endsWith('.md.asc'));
  } catch (_) {
    return null;
  }
  if (files.length === 0) return null;

  const bonds = [];
  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(bondsDir, file), 'utf8');
      const fm = parseFrontmatter(content);
      const base = file.replace(/\.md$/, '');
      const hasSig = fs.existsSync(path.join(bondsDir, file + '.asc'));
      bonds.push({
        base,
        file,
        type: fm.type || null,
        from: fm.from || null,
        to: fm.to || null,
        status: fm.status || null,
        visibility: fm.visibility || null,
        created: fm.created || null,
        signed: hasSig,
      });
    } catch (_) {
      // unreadable bond file — skip
    }
  }
  return bonds.length > 0 ? bonds : null;
}

function allEntityHandles() {
  const handles = [];
  try {
    const entries = fs.readdirSync(home, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith('.')) continue;
      const h = entry.name.slice(1);
      if (!h || h.startsWith('.')) continue;
      handles.push(h);
    }
  } catch (_) {}
  return handles;
}

function parseQuery(url) {
  const q = {};
  const i = url.indexOf('?');
  if (i === -1) return q;
  for (const pair of url.slice(i + 1).split('&')) {
    const [k, v] = pair.split('=');
    if (k) q[decodeURIComponent(k)] = v ? decodeURIComponent(v) : '';
  }
  return q;
}

function pathIs(req, target) {
  const url = req.originalUrl || req.url || '';
  const i = url.indexOf('?');
  const p = i === -1 ? url : url.slice(0, i);
  return p === target || p === target + '/';
}

function jsonOk(res, payload) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.writeHead(200);
  res.end(JSON.stringify(payload));
}

function jsonErr(res, code, message) {
  res.setHeader('Content-Type', 'application/json');
  res.writeHead(code);
  res.end(JSON.stringify({ status: 'error', message }));
}

// GET /api/bonds/has?handle=<handle> — must register before /api/bonds
WebApp.handlers.use('/api/bonds/has', (req, res, next) => {
  if (req.method !== 'GET' || !pathIs(req, '/api/bonds/has')) return next();
  try {
    const q = parseQuery(req.originalUrl || req.url);
    const handle = q.handle;
    if (!handle || typeof handle !== 'string') {
      return jsonErr(res, 400, 'Missing required query param: handle');
    }
    const filterStatus = q.status || null;
    const bonds = scanEntityBonds(handle);

    let hasBond = false;
    if (bonds) {
      if (filterStatus) {
        hasBond = bonds.some(b => b.status && b.status.toLowerCase() === filterStatus.toLowerCase());
      } else {
        hasBond = true;
      }
    }

    jsonOk(res, { status: 'ok', handle, hasBond });
  } catch (err) {
    console.error('[API/bonds/has] error:', err.message);
    jsonErr(res, 500, err.message);
  }
});

// GET /api/bonds — bond list per entity from disk
// GET /api/bonds?entity=juno — filter to one entity
WebApp.handlers.use('/api/bonds', (req, res, next) => {
  if (req.method !== 'GET' || !pathIs(req, '/api/bonds')) return next();
  try {
    const q = parseQuery(req.originalUrl || req.url);
    const handles = q.entity ? [q.entity] : allEntityHandles();

    const results = [];
    for (const handle of handles) {
      const bonds = scanEntityBonds(handle);
      if (bonds) results.push({ handle, bonds });
    }
    results.sort((a, b) => a.handle.localeCompare(b.handle));

    jsonOk(res, { status: 'ok', count: results.length, bonds: results });
  } catch (err) {
    console.error('[API/bonds] error:', err.message);
    jsonErr(res, 500, err.message);
  }
});
