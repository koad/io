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
  }
}

function patchSubpath(pkg, subpath, targetFile) {
  const subDir = path.join(npmDir, pkg, subpath);
  const pkgRoot = path.join(npmDir, pkg);
  const absTarget = path.join(pkgRoot, targetFile);
  const relTarget = path.relative(subDir, absTarget);
  fs.mkdirSync(subDir, { recursive: true });
  fs.writeFileSync(path.join(subDir, 'package.json'), JSON.stringify({ main: relTarget }));
}

patchMain('@ipld/dag-json', 'src/index.js');
patchMain('multiformats', 'dist/src/index.js');

patchSubpath('cborg', 'json', 'lib/json/json.js');
patchSubpath('multiformats', 'cid', 'dist/src/cid.js');
patchSubpath('multiformats', 'hashes/sha2', 'dist/src/hashes/sha2-browser.js');
patchSubpath('multiformats', 'bases/base64', 'dist/src/bases/base64.js');
