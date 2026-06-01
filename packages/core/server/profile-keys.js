/**
 * Vanity GPG Public Key Endpoint — /<handle>.keys
 *
 * Streams ~/.<handle>/id/gpg.public.asc as text/plain.
 * Falls through if the key file doesn't exist (same pattern as avatar.js).
 *
 * Brief: 2026-06-01-core-vanity-identity-endpoints
 */

import { WebApp } from 'meteor/webapp';

const os = Npm.require('os');
const fs = Npm.require('fs');
const path = Npm.require('path');

const _keysHandleRe = /^\/([a-z][a-z0-9_-]{0,30})\.keys$/;

WebApp.handlers.use((req, res, next) => {
  if (req.method !== 'GET') return next();

  const url = req.url.split('?')[0];
  const m = _keysHandleRe.exec(url);
  if (!m) return next();

  const handle = m[1];
  const keyPath = path.join(os.homedir(), `.${handle}`, 'id', 'gpg.public.asc');

  fs.stat(keyPath, (err, stat) => {
    if (err || !stat.isFile()) return next();
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.setHeader('Content-Length', stat.size);
    fs.createReadStream(keyPath).pipe(res);
  });
});
