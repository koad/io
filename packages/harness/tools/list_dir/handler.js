const fs   = require('fs');
const path = require('path');

module.exports = async function list_dir(params, context) {
  const entityDir = path.join(context.entityBaseDir || process.env.HOME || '/home/koad', `.${context.entity}`);
  const rel       = params.path || '.';
  const target    = path.resolve(entityDir, rel);

  if (!target.startsWith(entityDir + path.sep) && target !== entityDir) {
    throw new Error('path outside entity directory');
  }

  if (!fs.existsSync(target)) {
    return { error: 'directory not found', path: rel };
  }

  const stat = fs.statSync(target);
  if (!stat.isDirectory()) {
    return { error: 'path is a file, use read_file', path: rel };
  }

  try {
    const entries = fs.readdirSync(target, { withFileTypes: true });
    return entries.map(e => ({
      name: e.name,
      type: e.isDirectory() ? 'dir' : 'file',
    }));
  } catch (e) {
    return { error: e.message };
  }
};
