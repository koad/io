#!/usr/bin/env node
// Patches ESM-only npm packages to add "default" export conditions.
// Meteor's CJS require fallback needs this; the actual files are valid
// ESM that Node 22+ can require() natively once the exports map allows it.

const fs = require('fs');
const path = require('path');

const targets = ['@ipld/dag-json', 'multiformats'];

for (const pkg of targets) {
  const p = path.join(__dirname, 'src', 'node_modules', pkg, 'package.json');
  if (!fs.existsSync(p)) continue;
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));
  let patched = false;
  for (const [k, v] of Object.entries(d.exports || {})) {
    if (v && typeof v === 'object' && v.import && !v.default) {
      v.default = v.import;
      patched = true;
    }
  }
  if (patched) {
    fs.writeFileSync(p, JSON.stringify(d, null, 2) + '\n');
    console.log(`patched exports: ${pkg}`);
  }
}
