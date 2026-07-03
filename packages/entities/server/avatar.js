import { WebApp } from 'meteor/webapp';

// Only register disk-based endpoints in scanner mode.
// In remote mode, the proxy middleware (server/remote.js) handles these.
if (!EntityPackage || !EntityPackage.isScanner) return;

const os = Npm.require('os');
const fs = Npm.require('fs');
const path = Npm.require('path');

// /<handle>.png → ~/.<handle>/avatar.png
const _avatarHandleRe = /^\/([a-z][a-z0-9_-]{0,30})\.png$/;

WebApp.handlers.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  const m = _avatarHandleRe.exec(req.url.split('?')[0]);
  if (!m) return next();
  const handle = m[1];
  if (!EntityPackage.serves(handle)) {
    res.writeHead(404);
    return res.end('Not Found');
  }
  const avatarPath = path.join(os.homedir(), `.${handle}`, 'avatar.png');
  log.debug('avatarPath:', avatarPath)
  fs.stat(avatarPath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404);
      return res.end('Not Found');
    }
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.setHeader('Content-Length', stat.size);
    fs.createReadStream(avatarPath).pipe(res);
  });
});
