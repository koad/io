/**
 * Vanity Identity JSON Endpoint — /<handle>.json
 *
 * Comprehensive public identity document sourced from disk.
 * Supersedes the older /api/sovereign-profile endpoint for public use.
 *
 * Query params:
 *   ?full=1 — populate sigchain.entries[] with full chain entries
 *
 * SPEC-196 §5 extension, brief: 2026-06-01-core-vanity-identity-endpoints
 */

import { WebApp } from 'meteor/webapp';

const os = Npm.require('os');
const fs = Npm.require('fs');
const path = Npm.require('path');

const home = os.homedir();

// ── Handle validation regex (same as avatar.js) ──
const _profileHandleRe = /^\/([a-z][a-z0-9_-]{0,30})\.json$/;

// ── Frontmatter parser (from sovereign-profile.js) ──
function parseFrontmatter(content) {
  if (!content || !content.startsWith('---')) return null;

  const secondDelim = content.indexOf('---', 3);
  if (secondDelim === -1) return null;

  const fmBlock = content.substring(3, secondDelim).trim();
  const body = content.substring(secondDelim + 3).trim();

  const fm = {};
  const lines = fmBlock.split('\n');
  let currentKey = null;
  let currentList = null;

  for (const line of lines) {
    const listMatch = line.match(/^\s{2}-\s+(.+)$/);
    if (listMatch && currentKey) {
      if (!currentList) {
        currentList = [];
        fm[currentKey] = currentList;
      }
      currentList.push(listMatch[1].trim());
      continue;
    }

    currentList = null;
    const keyMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*)\s*:\s*(.*)$/);
    if (keyMatch) {
      currentKey = keyMatch[1];
      const value = keyMatch[2].trim();
      if (value === '') {
        fm[currentKey] = undefined;
      } else {
        fm[currentKey] = value;
      }
    }
  }

  for (const [k, v] of Object.entries(fm)) {
    if (v === undefined) fm[k] = [];
  }

  return { frontmatter: fm, body };
}

// ── Name/role extraction (from sovereign-profile.js) ──
function extractDisplayName(parsed, handle) {
  if (parsed?.frontmatter?.name) return parsed.frontmatter.name;
  const content = parsed?.body || '';
  const h1Match = content.match(/^# (.+)$/m);
  if (h1Match) return h1Match[1].trim();
  return handle;
}

function extractRole(parsed, handle, displayName) {
  if (parsed?.frontmatter?.role) return parsed.frontmatter.role;
  const content = parsed?.body || '';
  const iAmMatch = content.match(/(?:^|\n)\*?I am ([^.]+\.)/);
  if (iAmMatch) return iAmMatch[1].trim();
  const roleLine = content.match(/^\*?\*?Role:?\*?\*?\s*(.+)$/m);
  if (roleLine) return roleLine[1].trim();
  return `${displayName} — koad:io entity`;
}

// ── Bond scanner (from bonds.js) ──
function scanEntityBonds(handle) {
  const bondsDir = path.join(home, `.${handle}`, 'trust', 'bonds');
  let files;
  try {
    files = fs.readdirSync(bondsDir).filter(f => f.endsWith('.md') && !f.endsWith('.md.asc'));
  } catch (_) {
    return [];
  }

  const bonds = [];
  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(bondsDir, file), 'utf8');
      const fm = parseFrontmatter(content);
      const base = file.replace(/\.md$/, '');
      const hasSig = fs.existsSync(path.join(bondsDir, file + '.asc'));
      bonds.push({
        name: base,
        type: fm?.frontmatter?.type || null,
        from: fm?.frontmatter?.from || null,
        to: fm?.frontmatter?.to || null,
        status: fm?.frontmatter?.status || null,
        signed: hasSig,
      });
    } catch (_) {
      // unreadable bond — skip
    }
  }
  return bonds;
}

// ── Sigchain helpers ──
function sigchainSummary(handle) {
  const sigDir = path.join(home, `.${handle}`, 'sigchain');
  try {
    const stat = fs.statSync(sigDir);
    if (!stat.isDirectory()) return null;
  } catch (_) {
    return null;
  }

  const result = {};

  // head.cid
  const headPath = path.join(sigDir, 'head.cid');
  try {
    result.tip = fs.readFileSync(headPath, 'utf8').trim();
  } catch (_) {
    result.tip = null;
  }

  // metadata.json
  const metaPath = path.join(sigDir, 'metadata.json');
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    result.status = meta.status || null;
    result.created = meta.created || null;
    result.updated = meta.sigchainHeadUpdated || null;
    result.master_fingerprint = meta.masterFingerprint || null;
  } catch (_) {
    result.status = null;
    result.created = null;
    result.updated = null;
    result.master_fingerprint = null;
  }

  // entries — types + count
  const entriesDir = path.join(sigDir, 'entries');
  result.entry_types = [];
  result.length = 0;
  try {
    const entryFiles = fs.readdirSync(entriesDir).filter(f => f.endsWith('.json'));
    result.length = entryFiles.length;
    const types = new Set();
    for (const file of entryFiles) {
      try {
        const entry = JSON.parse(fs.readFileSync(path.join(entriesDir, file), 'utf8'));
        if (entry.type) types.add(entry.type);
      } catch (_) {}
    }
    result.entry_types = Array.from(types).sort();
  } catch (_) {}

  return result;
}

function sigchainEntries(handle) {
  const entriesDir = path.join(home, `.${handle}`, 'sigchain', 'entries');
  const entries = [];
  try {
    const entryFiles = fs.readdirSync(entriesDir).filter(f => f.endsWith('.json'));
    for (const file of entryFiles) {
      try {
        entries.push(JSON.parse(fs.readFileSync(path.join(entriesDir, file), 'utf8')));
      } catch (_) {}
    }
  } catch (_) {}
  return entries;
}

// ── Key info ──
function keyInfo(handle) {
  const idDir = path.join(home, `.${handle}`, 'id');
  const info = { files: [], gpg_fingerprint: null, endpoint: `/${handle}.keys` };

  try {
    const stat = fs.statSync(idDir);
    if (!stat.isDirectory()) return info;
  } catch (_) {
    return info;
  }

  // List public key files (never expose private keys)
  try {
    const allFiles = fs.readdirSync(idDir);
    info.files = allFiles.filter(f => {
      if (f.startsWith('.')) return false;
      if (f.endsWith('.fingerprint')) return false;
      // Exclude private keys
      if (f.includes('private') || f.includes('secret')) return false;
      return true;
    });
  } catch (_) {}

  // GPG fingerprint
  for (const fpFile of ['entity.fingerprint', 'master.fingerprint']) {
    try {
      const fp = fs.readFileSync(path.join(idDir, fpFile), 'utf8').trim();
      if (fp) {
        info.gpg_fingerprint = fp;
        break;
      }
    } catch (_) {}
  }

  return info;
}

// ── Handler ──
WebApp.handlers.use((req, res, next) => {
  if (req.method !== 'GET') return next();

  const url = req.url.split('?')[0];
  const m = _profileHandleRe.exec(url);
  if (!m) return next();

  const handle = m[1];
  const entityDir = path.join(home, `.${handle}`);

  // Entity dir must exist
  try {
    const stat = fs.statSync(entityDir);
    if (!stat.isDirectory()) return next();
  } catch (_) {
    return next();
  }

  // Parse query params
  const qi = req.url.indexOf('?');
  const q = {};
  if (qi !== -1) {
    for (const pair of req.url.slice(qi + 1).split('&')) {
      const [k, v] = pair.split('=');
      if (k) q[decodeURIComponent(k)] = v ? decodeURIComponent(v) : '';
    }
  }
  const full = q.full === '1';

  // ── Assemble profile ──

  // Name and role from ENTITY.md
  let displayName = handle;
  let role = `${handle} — koad:io entity`;
  let nameSource = null;

  const entityMdPath = path.join(entityDir, 'ENTITY.md');
  try {
    const content = fs.readFileSync(entityMdPath, 'utf8');
    const parsed = parseFrontmatter(content);
    // Pass synthetic {body} when no frontmatter so H1 extraction still works
    displayName = extractDisplayName(parsed || { body: content }, handle);
    role = extractRole(parsed || { body: content }, handle, displayName);
    nameSource = parsed?.frontmatter?.name || null;
  } catch (_) {
    // no ENTITY.md — use handle fallback
  }

  // Keys
  const keys = keyInfo(handle);

  // Sigchain
  const sigchain = sigchainSummary(handle);
  if (sigchain && full) {
    sigchain.entries = sigchainEntries(handle);
  } else if (sigchain) {
    sigchain.entries = [];
  }

  // Bonds
  const bonds = scanEntityBonds(handle);

  // Links
  const links = {
    profile: `/${handle}`,
    sigchain: `/${handle}/sigchain`,
    identity: `/${handle}/identity`,
    keys: `/${handle}.keys`,
    avatar: `/${handle}.png`,
    json: `/${handle}.json`,
  };

  const profile = {
    handle,
    name: displayName,
    role,
    avatar: `/${handle}.png`,
    keys,
    sigchain: sigchain || { tip: null, length: 0, status: null, created: null, updated: null, master_fingerprint: null, entry_types: [], entries: [] },
    bonds,
    links,
    served_at: new Date().toISOString(),
  };

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.writeHead(200);
  res.end(JSON.stringify(profile));
});
