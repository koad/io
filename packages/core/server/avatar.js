import { WebApp } from 'meteor/webapp';

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
  const avatarPath = path.join(os.homedir(), `.${handle}`, 'avatar.png');
  fs.stat(avatarPath, (err, stat) => {
    if (err || !stat.isFile()) return next();
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.setHeader('Content-Length', stat.size);
    fs.createReadStream(avatarPath).pipe(res);
  });
});
