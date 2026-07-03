/**
 * Vanity Identity JSON Endpoint — /<handle>.json
 *
 * Derived from the entity's library record (EntityScanner.Entities), not
 * from raw disk reads. Works in both scanner and remote mode — the library
 * is the truth. Includes source chain-of-custody, fingerprint, sigchain
 * links, and all public identity fields.
 *
 * Query params:
 *   ?full=1 — populate sigchain.entries[] with full chain entries (disk only)
 *
 * SPEC-196 §5 extension, brief: 2026-06-01-core-vanity-identity-endpoints
 */

import { WebApp } from 'meteor/webapp';

// ── Handle validation regex ──
const _profileHandleRe = /^\/([a-z][a-z0-9_-]{0,30})\.json$/;

// ── Handler ──
WebApp.handlers.use((req, res, next) => {
  if (req.method !== 'GET') return next();

  const url = req.url.split('?')[0];
  const m = _profileHandleRe.exec(url);
  if (!m) return next();

  const handle = m[1];

  // ── Look up in library record ──
  let entity = null;
  try {
    entity = EntityScanner && EntityScanner.Entities
      ? EntityScanner.Entities.findOne({ handle })
      : null;
  } catch (e) { /* collection may not be ready */ }

  if (!entity) {
    res.writeHead(404);
    return res.end('Not Found');
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

  // ── Assemble profile from library record ──
  const displayName = entity.tagline
    ? entity.tagline.replace(/^>\s*/, '').trim()
    : entity.entityMd
      ? (entity.entityMd.match(/^# (.+)$/m) || [])[1] || handle
      : handle;

  const role = entity.role || `${handle} — koad:io entity`;

  // Keys (from library record if available, else empty)
  const keys = {
    files: [],
    gpg_fingerprint: entity.fingerprint || null,
    endpoint: `/${handle}.keys`,
  };

  // Sigchain from library record
  const sigchain = {
    tip: entity.sigchainTip || null,
    length: 0,
    status: null,
    created: null,
    updated: entity.lastActivity ? new Date(entity.lastActivity).toISOString() : null,
    master_fingerprint: entity.fingerprint || null,
    entry_types: [],
    entries: [],
    genesisCid: entity.genesisCid || null,
    leafCid: entity.leafCid || null,
  };

  // Bonds (scanner populates these; remote may have them via DDP)
  const bonds = entity.bonds || [];

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
    sigchain,
    bonds,
    source: entity.source || null,
    links,
    served_at: new Date().toISOString(),
  };

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.writeHead(200);
  res.end(JSON.stringify(profile));
});
