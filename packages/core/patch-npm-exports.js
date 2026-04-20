// patch-npm-exports.js — Add `main` fields to ESM-only packages in core's npm dir.
//
// Run after Meteor installs npm deps (i.e. after `meteor npm install` in this package dir,
// or automatically on first build). Re-run whenever Npm.depends() versions change.
//
// Packages patched here are in core's Npm.depends():
//   @ipld/dag-json  — exports-only, no `main`
//   multiformats    — exports-only, no `main`; subpath imports also need stubs
//   @noble/ed25519  — already has `main: index.js`, no patch needed
//
// Pattern: patchMain sets pkgJson.main if absent.
//          patchSubpath writes a stub package.json in the subpath dir so
//          Meteor's CJS resolver can follow `require('multiformats/cid')` etc.

const fs = require('fs');
const path = require('path');

const npmDir = path.join(__dirname, '.npm', 'package', 'node_modules');

function patchMain(pkg, mainFile) {
  const pkgJsonPath = path.join(npmDir, pkg, 'package.json');
  if (!fs.existsSync(pkgJsonPath)) return;
  const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
  if (!pkgJson.main) {
    pkgJson.main = mainFile;
    fs.writeFileSync(pkgJsonPath, JSON.stringify(pkgJson, null, 2));
    console.log('[core/patch-npm-exports] patched main:', pkg, '->', mainFile);
  }
}

function patchSubpath(pkg, subpath, targetFile) {
  const subDir = path.join(npmDir, pkg, subpath);
  const pkgRoot = path.join(npmDir, pkg);
  const absTarget = path.join(pkgRoot, targetFile);
  const relTarget = path.relative(subDir, absTarget);
  fs.mkdirSync(subDir, { recursive: true });
  fs.writeFileSync(path.join(subDir, 'package.json'), JSON.stringify({ main: relTarget }));
  console.log('[core/patch-npm-exports] patched subpath:', pkg + '/' + subpath);
}

// @ipld/dag-json — exports-only manifest, src/index.js is the CJS entry
patchMain('@ipld/dag-json', 'src/index.js');

// multiformats — exports-only manifest; dist/src/index.js is the CJS entry
patchMain('multiformats', 'dist/src/index.js');

// multiformats subpath imports used by profile-builder.js and deps.js
patchSubpath('cborg',        'json',          'lib/json/json.js');
patchSubpath('multiformats', 'cid',           'dist/src/cid.js');
patchSubpath('multiformats', 'hashes/sha2',   'dist/src/hashes/sha2-browser.js');
patchSubpath('multiformats', 'bases/base64',  'dist/src/bases/base64.js');
